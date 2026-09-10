// The same URL has to work as a Telegram Mini App AND as a normal website.
//
// Telegram Mini Apps are just an HTTPS page in Telegram's WebView, so this is one
// deployment serving two surfaces. The risk is that making it Telegram-aware
// changes the browser behaviour, so this checks BOTH:
//
//   as a Mini App  — full height claimed, demo wallet is the primary action, and
//                    no wallet-extension option is offered (none can work there)
//   as a browser   — untouched: Connect Wallet primary, demo wallet secondary
//
// Telegram is simulated by installing a `window.Telegram.WebApp` stub before any
// app code runs, which is exactly what the real client provides. `platform` must
// be a real value — the injected script defines the namespace on ordinary pages
// too, so `isTelegramMiniApp()` requires platform or initData to avoid treating a
// browser visit as a Mini App.
//
//   node e2e/telegram.mjs [url]
import { open, wait, text, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) fails++;
};

/**
 * Stub Telegram's WebApp API and record which methods the app calls.
 *
 * Locked with a no-op setter on purpose. `telegram-web-app.js` is served on every
 * page and assigns its own `window.Telegram.WebApp` on load, which silently
 * replaced a plain stub — the app then saw the real object reporting
 * `platform: "unknown"` and correctly decided it wasn't in Telegram, so every
 * assertion here failed while the code was fine. Ignoring the write keeps the
 * stub in place without the real script throwing.
 */
const TELEGRAM_STUB = `
  window.__tgCalls = [];
  var __webApp = {
    initData: "query_id=TEST&user=%7B%22id%22%3A1%7D",
    version: "7.0",
    platform: "android",
    colorScheme: "dark",
    viewportHeight: 640,
    ready: function () { window.__tgCalls.push("ready"); },
    expand: function () { window.__tgCalls.push("expand"); },
    setHeaderColor: function (c) { window.__tgCalls.push("setHeaderColor:" + c); },
    setBackgroundColor: function (c) { window.__tgCalls.push("setBackgroundColor:" + c); },
    openLink: function (u) { window.__tgCalls.push("openLink:" + u); },
  };
  var __stub = {};
  // BOTH have to resist writes. The real script assigns window.Telegram (ignored
  // by the outer setter) and then sets Telegram.WebApp on whatever object it got
  // back — which is this stub — so leaving WebApp writable let it swap the API
  // out from under us.
  Object.defineProperty(__stub, "WebApp", {
    get: function () { return __webApp; },
    set: function () {},
    configurable: false,
  });
  Object.defineProperty(window, "Telegram", {
    get: function () { return __stub; },
    set: function () {},
    configurable: false,
  });
`;

// ------------------------------------------------------------ as a Mini App
console.log("=== opened as a Telegram Mini App ===");
{
  const { browser, page, problems } = await open({ url, evaluateOnNewDocument: TELEGRAM_STUB });
  await wait(2500);

  const t = await text(page);
  const calls = await page.evaluate(() => window.__tgCalls ?? []);
  console.log(`  Telegram API calls: ${JSON.stringify(calls)}`);

  // Without ready()/expand() a Mini App opens as a half-height sheet, which puts
  // the call buttons below the fold.
  check("ready() called", calls.includes("ready"));
  check("expand() called", calls.includes("expand"));
  check("header colour matched to the app", calls.some((c) => c.startsWith("setHeaderColor:#0a0b0c")));

  check("demo wallet is the primary action", /Create Demo Wallet/i.test(t));
  // The whole point: no extension exists in that WebView, so offering one is a
  // dead end the user cannot recover from.
  check("no 'Connect Wallet' offered", !/Connect Wallet/i.test(t));
  check("absence of extensions explained", /aren't available inside Telegram/i.test(t));
  check("only one wallet route shown", !/Use the demo wallet/i.test(t));
  check("keychain copy not shown on web build", !/device's keychain/i.test(t));

  fails += reportProblems(problems);
  await browser.close();
}

// ------------------------------------------------------------- as a browser
console.log("\n=== opened as a normal website (must be unchanged) ===");
{
  const { browser, page, problems } = await open({ url });
  await wait(2500);

  const t = await text(page);
  // telegram-web-app.js is loaded on every page, so the namespace exists here
  // too. It must NOT be treated as a Mini App.
  const ns = await page.evaluate(() => ({
    scriptPresent: !!document.querySelector('script[src*="telegram-web-app.js"]'),
    hasNamespace: typeof window.Telegram?.WebApp === "object",
    platform: window.Telegram?.WebApp?.platform ?? null,
  }));
  console.log(`  script present: ${ns.scriptPresent}   namespace: ${ns.hasNamespace}   platform: ${ns.platform}`);

  check("Telegram script served", ns.scriptPresent);
  check("Connect Wallet still primary", /Connect Wallet/i.test(t));
  check("demo wallet still offered as the alternative", /Use the demo wallet/i.test(t));
  check("Telegram-only copy absent", !/Create Demo Wallet/i.test(t));
  check("not misdetected as a Mini App", !/aren't available inside Telegram/i.test(t));

  fails += reportProblems(problems);
  await browser.close();
}

// ------------------------------------------- the real production launch path
//
// The stub above proves the app's own logic. This proves the thing the app
// depends on: Telegram launches a Mini App with its parameters in the URL
// fragment, and the real telegram-web-app.js reads them from there. If that
// stopped being true, detection would never fire in production no matter how
// correct the app is.
console.log("\n=== real telegram-web-app.js, Telegram-style launch hash ===");
{
  const hash = "#tgWebAppPlatform=android&tgWebAppVersion=7.0&tgWebAppThemeParams=%7B%7D";
  const { browser, page, problems } = await open({ url: url + hash });
  await wait(2500);

  const real = await page.evaluate(() => ({
    platform: window.Telegram?.WebApp?.platform ?? null,
    version: window.Telegram?.WebApp?.version ?? null,
    hasExpand: typeof window.Telegram?.WebApp?.expand === "function",
    hasOpenLink: typeof window.Telegram?.WebApp?.openLink === "function",
  }));
  console.log(`  platform=${real.platform}  version=${real.version}  expand=${real.hasExpand}  openLink=${real.hasOpenLink}`);

  check("real script picks up the platform from the launch hash", real.platform === "android");
  check("expand() exists on the real API", real.hasExpand);
  check("openLink() exists on the real API", real.hasOpenLink);

  const t = await text(page);
  check("app treats a real launch as a Mini App", /Create Demo Wallet/i.test(t));

  fails += reportProblems(problems);
  await browser.close();
}

console.log(`\n>>> ${fails === 0 ? "ok — one URL, both surfaces correct" : `${fails} problem(s)`}`);
process.exit(fails === 0 ? 0 : 1);
