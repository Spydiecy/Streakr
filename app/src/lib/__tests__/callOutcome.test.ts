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
import { callOutcomeLine } from "../callOutcome";

type Case = {
  name: string;
  input: Parameters<typeof callOutcomeLine>[0];
  expect: string;
};

const cases: Case[] = [
  {
    name: "won an UP call -> closed Up",
    input: { status: "won", direction: "up", stakeUsdso: 5, payout: 7.55 },
    expect: "Closed Up — you called it · +7.55 tUSDC",
  },
  {
    name: "won a DOWN call -> closed Down",
    input: { status: "won", direction: "down", stakeUsdso: 5, payout: 250 },
    expect: "Closed Down — you called it · +250.00 tUSDC",
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
    name: "win with no payout recorded omits the amount",
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
