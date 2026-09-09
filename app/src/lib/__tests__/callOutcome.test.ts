/**
 * callOutcomeLine() — the sentence under each row of call history.
 *
 * Worth testing rather than eyeballing because the winning leg is DERIVED, not
 * stored: a win means the window closed the way it was called, a loss means the
 * opposite. Get that inversion backwards and the app confidently tells the user
 * the market did something it didn't.
 *
 *   npm run test         (from app/)
 */
import { callOutcomeLine, callResultAmount } from "../callOutcome";

type Case = {
  name: string;
  input: Parameters<typeof callOutcomeLine>[0];
  expect: string;
};

const cases: Case[] = [
  {
    // payout is GROSS, so profit is payout - stake. Stating both stops the
    // gross figure reading as profit.
    name: "won an UP call states gross and profit separately",
    input: { status: "won", direction: "up", stakeUsdso: 5, payout: 7.55 },
    expect: "Closed Up — won 7.55 tUSDC (+2.55 profit)",
  },
  {
    name: "won a DOWN call on a long-shot price",
    input: { status: "won", direction: "down", stakeUsdso: 5, payout: 250 },
    expect: "Closed Down — won 250.00 tUSDC (+245.00 profit)",
  },
  {
    name: "lost an UP call -> market closed DOWN",
    input: { status: "lost", direction: "up", stakeUsdso: 5 },
    expect: "Closed Down — you called Up · −5.00 tUSDC",
  },
  {
    name: "lost a DOWN call -> market closed UP",
    input: { status: "lost", direction: "down", stakeUsdso: 10 },
    expect: "Closed Up — you called Down · −10.00 tUSDC",
  },
  {
    // Never fall back to the stake here. That fallback is precisely what showed
    // "+5.00" on a $5 call that actually returned ~$21, making a win look like
    // break-even.
    name: "win with no payout recorded omits the amount entirely",
    input: { status: "won", direction: "up", stakeUsdso: 5 },
    expect: "Closed Up — you called it",
  },
  {
    name: "void is not a loss",
    input: { status: "void", direction: "up", stakeUsdso: 5 },
    expect: "Market voided — stake refunded, streak untouched",
  },
  {
    name: "pending",
    input: { status: "pending", direction: "down", stakeUsdso: 25 },
    expect: "Waiting for the window to settle on-chain",
  },
];

let pass = 0;
let fail = 0;

const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`ok    ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

for (const c of cases) {
  const got = callOutcomeLine(c.input);
  if (got === c.expect) {
    pass++;
    console.log(`ok    ${c.name}\n        "${got}"`);
  } else {
    fail++;
    console.log(`FAIL  ${c.name}\n        expected: "${c.expect}"\n        got:      "${got}"`);
  }
}

// The inversion is the whole point — assert it explicitly rather than trusting
// the table above to have covered it.
const lostUp = callOutcomeLine({ status: "lost", direction: "up", stakeUsdso: 5 });
if (!lostUp.startsWith("Closed Down")) {
  fail++;
  console.log(`FAIL  a lost UP call must report the market closing DOWN, got: "${lostUp}"`);
}

// A win must never report an amount equal to the stake, which is what the
// stake-as-share-count settlement bug produced.
const winLine = callOutcomeLine({ status: "won", direction: "up", stakeUsdso: 5, payout: 21.1 });
if (!winLine.includes("21.10") || !winLine.includes("+16.10")) {
  fail++;
  console.log(`FAIL  a win must state gross and profit, got: "${winLine}"`);
}

// ── callResultAmount, the compact form used in the room feed ────────────────
const amounts: [string, Parameters<typeof callResultAmount>[0], string | null][] = [
  ["won shows profit", { status: "won", stakeUsdso: 5, payout: 21.1 }, "+16.10"],
  ["won without payout shows nothing", { status: "won", stakeUsdso: 5 }, null],
  ["lost shows the stake", { status: "lost", stakeUsdso: 5 }, "−5.00"],
  ["void shows refunded", { status: "void", stakeUsdso: 5 }, "refunded"],
  ["pending shows nothing", { status: "pending", stakeUsdso: 5 }, null],
];
for (const [name, input, want] of amounts) {
  const got = callResultAmount(input);
  check(`callResultAmount: ${name}`, got === want, `got ${JSON.stringify(got)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
