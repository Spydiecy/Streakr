// An unfunded wallet must be told so BEFORE signing, in plain language.
//
// The failure this guards against: the call screen used to surface the raw
// revert —
//
//   @somnia-chain/markets-sdk: placeBinaryOrder reverted:
//   ERC20InsufficientBalance(0x2ec81750…, 0, 5000000)
//
// — after the user had already approved a signature and paid gas to find out.
// Now the balance is read up front and the shortfall is stated in tUSDC with a
// button that funds the wallet.
//
// The unit-level mapping is covered by `npm run test`
// (src/lib/__tests__/errors.test.ts). This checks the wiring: that the gate
// renders, and that no SDK jargon or raw address survives into the UI.
//
//   node e2e/errpath.mjs [url]
import { open, wait, signIn, createRoom, tapBigButton, text, flat, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const { browser, page, problems } = await open({ url });

// Anything here reaching the screen is a leak. "0x" is excluded because the
// truncated signing address is shown deliberately; long hex runs are not.
const JARGON = [
  "@somnia-chain/markets-sdk",
  "placeBinaryOrder",
  "ERC20InsufficientBalance",
  "reverted",
  "InvalidQuantity",
  "ImmediateOrCancel",
];

await signIn(page, "ErrProbe");
await createRoom(page, `ErrProbe${Math.floor(Math.random() * 900 + 100)}`);

console.log("=== tap UP → call confirmation ===");
console.log("  tapped call button:", await tapBigButton(page, "UP"));
await wait(16_000);

const body = await text(page);
console.log(await flat(page));

console.log("\n=== jargon check ===");
const leaks = JARGON.filter((j) => body.includes(j));
if (/0x[0-9a-fA-F]{12,}/.test(body)) leaks.push("a raw address");
console.log(leaks.length ? leaks.map((l) => `  *** LEAKED: ${l}`).join("\n") : "  no raw jargon on screen");

console.log("\n=== funding gate ===");
const shortfall = /Not enough tUSDC/.test(body);
const fundBtn = /Fund this wallet/.test(body);
const funded = /Stake[\s\S]*Sign & Submit Call/.test(body) && !shortfall;
console.log(`  shortfall stated: ${shortfall}`);
console.log(`  fund button:      ${fundBtn}`);
console.log(`  wallet is funded: ${funded}`);

// Either the wallet already has collateral (the faucet did its job at
// onboarding) or the gate is shown. Silently offering to sign with an empty
// wallet is the failure mode.
const ok = funded || (shortfall && fundBtn);
console.log(`\n  >>> ${ok ? "ok — no silent dead end" : "*** BUG: neither funded nor gated ***"}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(ok && leaks.length === 0 && failed === 0 ? 0 : 1);
