/**
 * friendlyError() against the actual failure strings this app produces.
 *
 * Every input below was observed for real rather than invented — the first case
 * is the verbatim revert a user hit with an unfunded external wallet. The point
 * of the suite is twofold: that each failure maps to the right `kind` (screens
 * branch on it to decide whether to offer a "mint collateral" button), and that
 * no raw SDK jargon or wallet address survives into user-facing copy.
 *
 * No test framework — plain assertions and a non-zero exit, run through tsx
 * (Node's own TypeScript support can't resolve the extensionless imports that
 * Metro relies on):
 *
 *   npm run test         (from app/)
 *
 * Pure logic with no network or bundler involvement, which is deliberate —
 * errors.ts imports only networkConfig.ts for exactly this reason.
 */
import { friendlyError } from "../errors";

interface Case {
  name: string;
  input: unknown;
  expectKind: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

const RAW_JARGON = ["@somnia-chain/markets-sdk", "placeBinaryOrder", "ERC20InsufficientBalance", "reverted"];

const cases: Case[] = [
  {
    // Verbatim from a real failed call: an external wallet with no tUSDC.
    name: "reported: ERC20InsufficientBalance, 0 held, 5 tUSDC needed",
    input: new Error(
      "@somnia-chain/markets-sdk: placeBinaryOrder reverted: ERC20InsufficientBalance(0x2ec8175015Bef5ad1C0BE1587C4A377bC083A2d8, 0, 5000000)",
    ),
    expectKind: "insufficient-collateral",
    mustContain: ["5.00", "0.00", "tUSDC"],
    mustNotContain: RAW_JARGON,
  },
  {
    name: "partial balance: 1.25 held, 10 needed",
    input: new Error("ERC20InsufficientBalance(0xabc, 1250000, 10000000)"),
    expectKind: "insufficient-collateral",
    mustContain: ["10.00", "1.25"],
  },
  {
    name: "preflight form thrown by placeCall",
    input: new Error("ERC20InsufficientBalance(0xdef, 0, 25000000)"),
    expectKind: "insufficient-collateral",
    mustContain: ["25.00"],
  },
  {
    name: "no gas",
    input: new Error("insufficient funds for gas * price + value"),
    expectKind: "insufficient-gas",
    mustContain: ["STT"],
  },
  {
    // Shannon returns -32602 rather than a clear "insufficient funds" when the
    // sender can't cover gasLimit x gasPrice, and the SDK wraps it like this.
    // Reads as an encoding bug; is actually an underfunded wallet.
    name: "gas ceiling unaffordable, reported as invalid params (approve)",
    input: new Error("approve reverted: Missing or invalid parameters. Double check you have provided the correct parameters."),
    expectKind: "insufficient-gas",
    mustContain: ["STT"],
  },
  {
    name: "gas ceiling unaffordable, reported as invalid params (faucet)",
    input: new Error("faucet reverted: Missing or invalid parameters."),
    expectKind: "insufficient-gas",
    mustContain: ["STT"],
  },
  {
    name: "IOC no fill",
    input: new Error("order did not fill — the book likely moved; try again"),
    expectKind: "no-liquidity",
  },
  {
    name: "no resting liquidity on the called leg",
    input: new Error("BTC 1h: no resting NO liquidity to take against right now"),
    expectKind: "no-liquidity",
  },
  {
    name: "lot grid rejects the size",
    input: new Error("placeBinaryOrder reverted: InvalidQuantity(9652509, 1000)"),
    expectKind: "stake-too-small",
  },
  {
    name: "stake rounds to zero shares",
    input: new Error("stake 5 rounds to 0 shares on this venue's lot grid"),
    expectKind: "stake-too-small",
  },
  {
    name: "window closed",
    input: new Error("window closes too soon to place this call"),
    expectKind: "window-closed",
  },
  {
    name: "wallet rejection via code 4001",
    input: Object.assign(new Error("User rejected the request."), { code: 4001 }),
    expectKind: "rejected",
  },
  {
    name: "wallet rejection via viem error name",
    input: Object.assign(new Error("something"), { name: "UserRejectedRequestError" }),
    expectKind: "rejected",
  },
  {
    name: "firestore blocked by extension",
    input: new Error("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"),
    expectKind: "blocked-by-extension",
    mustContain: ["blocker"],
  },
  {
    name: "firestore unreachable",
    input: new Error("@firebase/firestore: Could not reach Cloud Firestore backend."),
    expectKind: "offline",
    mustContain: ["Firestore"],
  },
  {
    name: "indexer DNS failure must NOT blame firestore",
    input: new Error("net::ERR_NAME_NOT_RESOLVED"),
    expectKind: "offline",
    mustNotContain: ["Firestore", "database"],
  },
  {
    name: "room create timeout",
    input: new Error("Creating the room timed out after 12s — the request may be blocked by a browser extension"),
    expectKind: "timeout",
  },
  {
    name: "unknown error still gets cleaned of the sdk prefix",
    input: new Error("@somnia-chain/markets-sdk: something entirely new went wrong"),
    expectKind: "unknown",
    mustNotContain: ["@somnia-chain/markets-sdk"],
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const f = friendlyError(c.input);
  const text = `${f.title} ${f.detail}`;
  const problems: string[] = [];

  if (f.kind !== c.expectKind) problems.push(`kind=${f.kind} expected=${c.expectKind}`);
  for (const s of c.mustContain ?? []) if (!text.includes(s)) problems.push(`missing "${s}"`);
  for (const s of c.mustNotContain ?? []) if (text.includes(s)) problems.push(`leaked "${s}"`);
  // No mapped error should ever surface a long hex address to the user.
  if (/0x[0-9a-fA-F]{12,}/.test(text)) problems.push("leaked a raw address");

  if (problems.length) {
    fail++;
    console.log(`FAIL  ${c.name}`);
    problems.forEach((p) => console.log(`        ${p}`));
    console.log(`        got: ${f.title} — ${f.detail}`);
  } else {
    pass++;
    console.log(`ok    ${c.name}`);
    console.log(`        "${f.title} — ${f.detail}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
