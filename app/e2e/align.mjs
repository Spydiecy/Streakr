// Measures rendered geometry to find alignment defects, rather than eyeballing
// screenshots.
//
// Two classes of bug, both of which shipped before:
//   - a child forced off its parent's centre line by an unconditional
//     `alignSelf`, which is how the wallet pill ended up left of centre in a
//     centred card and top-aligned inside rows
//   - horizontal overflow, which react-native-web hides rather than scrolling
//
//   node e2e/align.mjs [url] [width]
import { open, wait, tap, signIn, createRoom, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const width = Number(process.argv[3] ?? 430);
const { browser, page, problems } = await open({ url, width });

const audit = () =>
  page.evaluate(() => {
    const out = { offCentre: [], overflow: [] };
    const vis = (el) => {
      if (el.closest('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        r.width > 2 && r.height > 2 && cs.visibility !== "hidden" &&
        cs.display !== "none" && Number(cs.opacity) > 0.05
      );
    };
    const els = Array.from(document.querySelectorAll("div,span")).filter(vis);

    // Children of a centred column that don't sit on the parent's centre line.
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.alignItems !== "center" || cs.flexDirection !== "column") continue;
      const pr = el.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      if (Math.abs(padL - padR) > 1) continue; // asymmetric padding shifts centre legitimately
      const pcx = pr.left + pr.width / 2;
      for (const kid of Array.from(el.children).filter(vis)) {
        const kcs = getComputedStyle(kid);
        if (kcs.position === "absolute") continue;
        const kr = kid.getBoundingClientRect();
        if (kr.width >= pr.width - padL - padR - 2) continue; // full-width, nothing to centre
        const off = kr.left + kr.width / 2 - pcx;
        if (Math.abs(off) > 1.5) {
          out.offCentre.push({
            child: (kid.innerText || "").trim().slice(0, 26),
            offBy: +off.toFixed(1),
            alignSelf: kcs.alignSelf,
          });
        }
      }
    }

    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      out.overflow.push({ scrollW: de.scrollWidth, clientW: de.clientWidth });
    }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2 || r.left < -2) {
        out.overflow.push({
          text: (el.innerText || "").trim().slice(0, 20),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    return out;
  });

let total = 0;
const report = async (screen) => {
  const a = await audit();
  const n = a.offCentre.length + a.overflow.length;
  total += n;
  console.log(`\n### ${screen} @${width}w  ${n === 0 ? "CLEAN" : `${n} issue(s)`}`);
  a.offCentre.forEach((c) =>
    console.log(`  [off-centre] "${c.child}" by ${c.offBy}px (alignSelf=${c.alignSelf})`),
  );
  a.overflow.forEach((o) => console.log(`  [overflow] ${JSON.stringify(o)}`));
};

await report("onboarding");
await signIn(page, "AlignProbe");
await report("room list");

await createRoom(page, `AlignAudit${Math.floor(Math.random() * 900 + 100)}`);
await report("room");

// Profile is where the reported centring bug lived.
await page.evaluate(() => {
  const back = Array.from(document.querySelectorAll("*")).find((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 40 && Math.round(r.height) === 40 && r.top < 120 && r.left < 120;
  });
  back?.click();
});
await wait(6000);
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 44 && Math.round(r.height) === 44;
  });
  btns[btns.length - 1]?.click();
});
await wait(5000);
await report("profile");

const failed = reportProblems(problems);
console.log(`\n${total} alignment issue(s) total`);
await browser.close();
process.exit(total === 0 && failed === 0 ? 0 : 1);
