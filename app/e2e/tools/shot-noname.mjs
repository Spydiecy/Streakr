// Profile screenshot for the case that actually shows in the wild: no display
// name typed at onboarding, so the name falls back to the shortened address.
// That fallback is why the address used to appear twice on this screen.
//
//   node e2e/tools/shot-noname.mjs <url> <out.png>
import { open, wait, tap, text } from "../lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const out = process.argv[3] ?? "/tmp/profile-noname.png";

const { browser, page } = await open({ url });

// Deliberately skip typing a display name.
await tap(page, "Use the demo wallet");
await wait(14_000);

await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
    if (e.closest('[aria-hidden="true"]')) return false;
    const r = e.getBoundingClientRect();
    return Math.round(r.width) === 44 && Math.round(r.height) === 44;
  });
  btns[btns.length - 1]?.click();
});
await wait(8000);

const t = await text(page);
console.log(t.replace(/\n+/g, " | ").slice(0, 260));

// How many times does an address-looking string appear?
const addrs = t.match(/0x[0-9a-fA-F]{4,}[….]{1,3}[0-9a-fA-F]{4,}/g) ?? [];
console.log(`\naddress-shaped strings on screen: ${addrs.length} -> ${JSON.stringify(addrs)}`);
console.log(`copy control present: ${await page.evaluate(() =>
  !!Array.from(document.querySelectorAll("[aria-label]")).find((e) =>
    /Copy wallet address|Address copied/.test(e.getAttribute("aria-label"))))}`);
console.log(`"tap to copy" text gone: ${!/tap to copy/i.test(t)}`);

await page.screenshot({ path: out });
console.log("wrote", out);
await browser.close();
