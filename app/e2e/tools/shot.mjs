// Screenshot a screen for eyeballing layout.
//
//   node e2e/tools/shot.mjs <url> <out.png> [profile|room] [0xprivateKey]
import { open, wait, signIn, tap, text } from "../lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const out = process.argv[3] ?? "/tmp/shot.png";
const where = process.argv[4] ?? "profile";
const pk = process.argv[5];

const { browser, page } = await open({ url });
if (pk) {
  await page.evaluate((k) => localStorage.setItem("streakr.wallet.privateKey", k), pk);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(3500);
}

await signIn(page, "ShotProbe");
await wait(6000);

if (where === "profile") {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("*")).filter((e) => {
      if (e.closest('[aria-hidden="true"]')) return false;
      const r = e.getBoundingClientRect();
      return Math.round(r.width) === 44 && Math.round(r.height) === 44;
    });
    btns[btns.length - 1]?.click();
  });
  await wait(7000);
} else {
  await tap(page, "test");
  await wait(9000);
}

console.log((await text(page)).replace(/\n+/g, " | ").slice(0, 300));
await page.screenshot({ path: out, fullPage: false });
console.log("wrote", out);
await browser.close();
