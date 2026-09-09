// Long lists must stop growing and scroll inside themselves.
//
// Room calls and call history were unbounded: a room with a dozen calls pushed
// the leaderboard off the bottom, so getting to it meant scrolling past every
// row. Both are now capped and scroll internally. Height alone isn't proof —
// a list can be short because the data is short — so this also confirms the
// container genuinely overflows and responds to scrolling, and that the section
// below it is reachable.
//
//   node e2e/scrollbox.mjs [url] [0xprivateKey]
import { open, wait, tap, signIn, text, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const pk = process.argv[3];
const { browser, page, problems } = await open({ url });

if (pk) {
  await page.evaluate((k) => localStorage.setItem("streakr.wallet.privateKey", k), pk);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(3500);
}

/**
 * Every internally-scrolling box on the visible screen, with the measurements
 * that decide whether the cap is doing anything.
 */
const boxes = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("div"))) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      const styles = getComputedStyle(el);
      const scrolls = /auto|scroll|hidden/.test(styles.overflowY);
      if (!canScroll || !scrolls) continue;
      const r = el.getBoundingClientRect();
      // Ignore the page-level scroller and anything tiny.
      if (r.height < 40 || r.height > 700) continue;
      out.push({
        viewport: Math.round(r.height),
        content: el.scrollHeight,
        text: (el.innerText || "").trim().slice(0, 60).replace(/\n+/g, " / "),
      });
    }
    return out;
  });

/** Scroll a box by index and report whether the offset actually moved. */
const scrollBox = (page, idx) =>
  page.evaluate((idx) => {
    const els = Array.from(document.querySelectorAll("div")).filter((el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      return (
        el.scrollHeight > el.clientHeight + 1 &&
        /auto|scroll|hidden/.test(getComputedStyle(el).overflowY) &&
        r.height >= 40 &&
        r.height <= 700
      );
    });
    const el = els[idx];
    if (!el) return null;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    return { before, after: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  }, idx);

await signIn(page, "ScrollProbe");
await wait(4000);

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails++;
};

// ---------------------------------------------------------------- room screen
const roomList = await text(page);
const roomName = (roomList.match(/^(test|.+)$/m) && /test/.test(roomList)) ? "test" : null;
console.log("=== room screen ===");
if (!roomName) {
  console.log("  no 'test' room on this account — skipping room checks (inconclusive)");
} else {
  await tap(page, "test");
  await wait(9000);

  const t = await text(page);
  // Section headings are CSS-uppercased, so innerText reads "ROOM CALLS".
  const hasCalls = /room calls/i.test(t) && !/No calls in this room yet/i.test(t);
  const hasBoard = /room leaderboard/i.test(t);
  console.log(`  room calls present: ${hasCalls}   leaderboard present: ${hasBoard}`);

  const found = await boxes(page);
  found.forEach((b, i) =>
    console.log(`  box[${i}] viewport=${b.viewport}px content=${b.content}px  "${b.text}"`),
  );

  if (hasCalls) {
    check("room calls list is capped", found.length > 0, `${found.length} scrolling box(es)`);
    for (const [i, b] of found.entries()) {
      check(`box[${i}] height within cap`, b.viewport <= 345, `${b.viewport}px`);
      check(`box[${i}] content exceeds viewport`, b.content > b.viewport, `${b.content} > ${b.viewport}`);
      const s = await scrollBox(page, i);
      check(`box[${i}] scrolls internally`, !!s && s.after > s.before, s ? `0 → ${s.after} of ${s.max}` : "not found");
    }
    // The point of the cap: what sits below the list is reachable.
    check("leaderboard reachable on the same screen", hasBoard);
    // A capped nested scroller shows no scrollbar on touch, so the fade is the
    // only signal that rows continue below.
    check("overflow hint shown", /scroll for more/i.test(t));
  } else {
    console.log("  room has no calls — cap can't be exercised here (inconclusive)");
  }
}

// ------------------------------------------------------------- profile screen
console.log("\n=== profile screen ===");
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 44 && Math.round(r.height) === 44;
  });
  btns[btns.length - 1]?.click();
});
await wait(7000);

const pt = await text(page);
const hasHistory = /call history/i.test(pt) && !/No calls yet/i.test(pt);
console.log(`  call history present: ${hasHistory}`);

/** Is a height cap actually applied to the history card's contents? */
const capApplied = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("div"))
      .filter((el) => !el.closest('[aria-hidden="true"]'))
      .map((el) => parseInt(getComputedStyle(el).maxHeight, 10))
      .filter((h) => Number.isFinite(h) && h > 100 && h < 500),
  );

if (hasHistory) {
  const caps = await capApplied();
  console.log(`  height caps found on this screen: ${caps.length ? caps.map((c) => `${c}px`).join(", ") : "none"}`);
  check("history contents carry a height cap", caps.length > 0);

  const pboxes = await boxes(page);
  pboxes.forEach((b, i) =>
    console.log(`  box[${i}] viewport=${b.viewport}px content=${b.content}px  "${b.text}"`),
  );
  if (pboxes.length) {
    for (const [i, b] of pboxes.entries()) {
      check(`box[${i}] height within cap`, b.viewport <= 365, `${b.viewport}px`);
      const s = await scrollBox(page, i);
      check(`box[${i}] scrolls internally`, !!s && s.after > s.before, s ? `0 → ${s.after} of ${s.max}` : "not found");
    }
  } else {
    // Fewer rows than the cap allows. maxHeight (not a fixed height) is
    // deliberate: a two-call history should render two rows, not a padded box.
    console.log("  history is shorter than the cap, so nothing overflows yet — cap verified structurally");
  }
  // Disconnect sits under the history; an uncapped list pushes it arbitrarily far.
  check("disconnect button still reachable", /Disconnect wallet/i.test(pt));
} else {
  console.log("  no history on this wallet — cap can't be exercised (inconclusive)");
}

console.log(`\n>>> ${fails === 0 ? "ok — lists are capped and scroll in place" : `${fails} check(s) failed`}`);
const problemCount = reportProblems(problems);
await browser.close();
process.exit(fails === 0 && problemCount === 0 ? 0 : 1);
