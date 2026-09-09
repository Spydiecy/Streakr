// Shared helpers for the browser checks. See README.md for the two gotchas
// these exist to work around (aria-hidden screens, and icon glyphs being text).
import puppeteer from "puppeteer-core";

export const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open({ url, width = 430, height = 950 }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  const problems = [];
  page.on("pageerror", (e) => problems.push(`PAGEERROR ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console ${m.text().slice(0, 240)}`);
  });
  page.on("requestfailed", (r) =>
    problems.push(`REQFAIL ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`),
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
  await wait(3500);
  return { browser, page, problems };
}

/** Visible text of the topmost screen, newlines flattened for one-line logging. */
export const text = (page) =>
  page.evaluate(() => (document.body.innerText || "").trim());

export const flat = async (page) => (await text(page)).replace(/\n+/g, " | ");

/**
 * Click the element whose visible text matches `label`, preferring an exact
 * match and the shallowest subtree. Skips anything inside an aria-hidden
 * (backgrounded) screen.
 */
export function tap(page, label) {
  return page.evaluate((label) => {
    const all = Array.from(document.querySelectorAll("*")).filter((e) => {
      if (e.closest('[aria-hidden="true"]')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    });
    let c = all.filter((e) => (e.innerText || "").trim() === label);
    if (!c.length) c = all.filter((e) => (e.innerText || "").trim().includes(label));
    if (!c.length) return false;
    c.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    c[0].scrollIntoView({ block: "center" });
    c[0].click();
    return true;
  }, label);
}

/**
 * Click a tall labelled button. Needed for UP/DOWN: the order-book column also
 * renders the text "UP", and it's the deeper leaf, so a text-only match hits the
 * label. The icon inside the real button is an Ionicons glyph — itself text —
 * so the button's innerText is "\uF10C\nUP" rather than "UP".
 */
export function tapBigButton(page, label, minHeight = 40, minWidth = 80) {
  return page.evaluate(
    ({ label, minHeight, minWidth }) => {
      const c = Array.from(document.querySelectorAll("*")).filter((e) => {
        if (e.closest('[aria-hidden="true"]')) return false;
        if (!new RegExp(`(^|\\n)${label}$`).test((e.innerText || "").trim())) return false;
        const r = e.getBoundingClientRect();
        return r.height >= minHeight && r.width >= minWidth;
      });
      if (!c.length) return false;
      c.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      c[0].scrollIntoView({ block: "center" });
      c[0].click();
      return true;
    },
    { label, minHeight, minWidth },
  );
}

export async function typeInto(page, placeholderFragment, value) {
  const found = await page.evaluate((frag) => {
    const i = Array.from(document.querySelectorAll("input,textarea")).find((x) =>
      (x.placeholder || "").toLowerCase().includes(frag.toLowerCase()),
    );
    if (!i) return false;
    i.focus();
    return true;
  }, placeholderFragment);
  if (!found) return false;
  await page.keyboard.type(value, { delay: 25 });
  return true;
}

/** Onboarding → funded demo wallet → room list. */
export async function signIn(page, displayName = "Probe") {
  await typeInto(page, "Display name", displayName);
  const ok = await tap(page, "Use the demo wallet");
  await wait(12_000);
  return ok;
}

/** Create a room and land on its screen. */
export async function createRoom(page, name) {
  await tap(page, "New Room");
  await wait(2500);
  await typeInto(page, "Room name", name);
  await wait(500);
  await tap(page, "Create room");
  // Poll until the market read actually RESOLVES, rather than until the loading
  // text appears — the first read is a couple of indexer round-trips plus a
  // per-market on-chain snapshot and takes several seconds.
  for (let i = 0; i < 20; i++) {
    await wait(2000);
    const t = await text(page);
    if (/LIVE|Locked|No live/.test(t)) return true;
  }
  return false;
}

/** The market card's fields, read from the visible screen only. */
export function marketCard(page) {
  return page.evaluate(() => {
    const visible = (el) => !el.closest('[aria-hidden="true"]');
    const leaves = Array.from(document.querySelectorAll("div,span")).filter(
      (el) => !el.childElementCount && visible(el),
    );

    const label =
      leaves.map((e) => e.textContent.trim()).find((t) =>
        /^(BTC|ETH) (15m|1h|4h|1d|1w)$/.test(t),
      ) ?? null;

    let big = null;
    for (const el of leaves) {
      const t = el.textContent.trim();
      if (!/^(BTC|ETH)$/.test(t)) continue;
      if (Math.round(parseFloat(getComputedStyle(el).fontSize)) >= 28) {
        big = t;
        break;
      }
    }

    const body = document.body.innerText || "";
    const state = /Reading live/.test(body)
      ? "loading"
      : /No live/.test(body)
        ? "no-window"
        : label
          ? "market"
          : "other";
    const quotes = (
      body.match(/(?:^|\n)(?:UP|Up)\n([\d.—]+)[\s\S]*?(?:DOWN|Down)\n([\d.—]+)/) || []
    ).slice(1);
    // Capture the WHOLE countdown: a regex that stops at the minutes silently
    // drops the "17h " prefix and makes every window look near expiry.
    const left = (body.match(/(?:^|\n)([0-9]+[hm]?[: ][0-9]+[hm]?)\nleft/) || [])[1] ?? null;

    return { state, big, label, quotes, left };
  });
}

/** Window chips currently rendered, e.g. ["15m","1h","4h","1d"]. */
export function windowChips(page) {
  return page.evaluate(() => {
    const out = new Set();
    for (const el of Array.from(document.querySelectorAll("div,span"))) {
      if (el.childElementCount || el.closest('[aria-hidden="true"]')) continue;
      const t = el.textContent.trim();
      if (!/^(15m|1h|4h|1d|1w)$/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.add(t);
    }
    return [...out];
  });
}

export function reportProblems(problems) {
  console.log("\n--- console / network errors ---");
  console.log(problems.length ? [...new Set(problems)].join("\n") : "(none)");
  return problems.length;
}
