// Capture the screenshots used in the submission write-up.
//
// One sign-in, several screens. Each sign-in consumes a faucet grant from a shared
// treasury, so taking six shots with six separate runs is six wallets funded for
// nothing — this reuses one session and navigates instead.
//
// Also captures the Telegram Mini App variant, since that's a different render path
// (no wallet-extension option, full-height sheet) and worth showing as its own
// surface rather than claimed in prose.
//
//   node e2e/tools/capture.mjs [url] [outDir]
import { open, wait, signIn, tap, typeInto, text } from "../lib.mjs";

const url = process.argv[2] ?? "https://streakr-opal.vercel.app";
const outDir = process.argv[3] ?? "docs/screenshots";

const TELEGRAM_STUB = `
  var __webApp = {
    initData: "query_id=SHOT", version: "7.0", platform: "android",
    colorScheme: "dark", viewportHeight: 900,
    ready: function(){}, expand: function(){},
    setHeaderColor: function(){}, setBackgroundColor: function(){},
    openLink: function(){},
  };
  var __stub = {};
  Object.defineProperty(__stub, "WebApp", { get: function(){ return __webApp; }, set: function(){}, configurable: false });
  Object.defineProperty(window, "Telegram", { get: function(){ return __stub; }, set: function(){}, configurable: false });
`;

const shots = [];
const shoot = async (page, name, note) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  shots.push({ name, note });
  console.log(`  ${path}  — ${note}`);
};

// ---------------------------------------------------------------- normal web
{
  const { browser, page } = await open({ url, width: 430, height: 940 });

  await shoot(page, "01-onboarding", "landing: real on-chain calls, capped downside");

  await signIn(page, "Spy");
  console.log("signed in, waiting for the faucet grant…");
  await wait(22_000);
  await shoot(page, "02-rooms", "room list with live market chips");

  // The Telegram-linked demo room has real settled history in it.
  if (/test/.test(await text(page))) {
    await tap(page, "test");
    for (let i = 0; i < 20; i++) {
      await wait(2000);
      const t = await text(page);
      if (/LIVE|No live/.test(t) && !/Reading live/.test(t)) break;
    }
    // Shortest cadence: countdown, book and payouts all visible at once.
    await tap(page, "5m");
    for (let i = 0; i < 15; i++) {
      await wait(2000);
      const t = await text(page);
      if (/LIVE/.test(t) && !/Reading live/.test(t)) break;
    }
    await shoot(page, "03-room", "THE money shot: countdown, payouts, sparkline, AI take");

    // Scroll to the shared feed and the room board.
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("div")).find(
        (e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 100,
      );
      (el ?? document.scrollingElement)?.scrollBy?.(0, 700);
      window.scrollBy(0, 700);
    });
    await wait(1500);
    await shoot(page, "04-room-feed", "shared feed + room leaderboard");

    // Open the call sheet over the room — the confirm-in-place decision.
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(1200);
    const tapped = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll("*")).filter((e) => {
        if (e.closest('[aria-hidden="true"]')) return false;
        if (!/(^|\n)UP(\n|$)/.test((e.innerText || "").trim())) return false;
        const r = e.getBoundingClientRect();
        return r.height >= 40 && r.width >= 80;
      });
      c.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      c[0]?.click();
      return !!c[0];
    });
    if (tapped) {
      await wait(5000);
      await shoot(page, "05-call-sheet", "confirm in place: payout, max loss, capped risk");
      await tap(page, "Cancel");
      await wait(2000);
    }
  }

  await browser.close();
}

// ------------------------------------------------------- Telegram Mini App
{
  const { browser, page } = await open({ url, width: 430, height: 900, evaluateOnNewDocument: TELEGRAM_STUB });
  await wait(3000);
  await shoot(page, "06-telegram-miniapp", "same URL inside Telegram: demo wallet leads, no dead-end connector");
  await browser.close();
}

console.log(`\n${shots.length} screenshot(s) written to ${outDir}/`);
