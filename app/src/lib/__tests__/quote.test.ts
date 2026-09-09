/**
 * askFor() / quoteFor() — which leg a direction buys, and what it returns.
 *
 * This exists because of a real bug: the room card displayed the DOWN price as
 * `1 − yesBid` while placeCall executed against `noAsks[0]`. Those are different
 * numbers, so the quote shown was not the quote paid. Pinning the leg selection
 * in a test is the cheapest way to stop that drifting apart again.
 *
 * The payout asymmetry that prompted the report is also asserted here: a winning
 * outcome token redeems for 1 collateral, so buying at 0.20 pays ~5x while
 * buying at 0.82 pays ~1.22x. That is correct, not a bug — the test records it as
 * intended behaviour.
 *
 *   npm run test         (from app/)
 */
import { askFor, quoteFor, type BookSide } from "../quote";

const market = (b: BookSide): BookSide => b;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`ok    ${name}${detail ? `\n        ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

// The exact numbers from the reported screenshot.
const m = market({ yesBid: 0.79, yesAsk: 0.821, noBid: 0.17, noAsk: 0.204 });

check("UP buys the YES leg at yesAsk", askFor(m, "up") === 0.821, `got ${askFor(m, "up")}`);
check("DOWN buys the NO leg at noAsk", askFor(m, "down") === 0.204, `got ${askFor(m, "down")}`);

// The specific regression: DOWN must NOT be 1 - yesBid.
check(
  "DOWN is not derived as 1 - yesBid",
  askFor(m, "down") !== 1 - (m.yesBid ?? 0),
  `noAsk=${m.noAsk} vs 1-yesBid=${(1 - (m.yesBid ?? 0)).toFixed(3)} — these differ, and only noAsk is payable`,
);

const up = quoteFor(m, "up", 5)!;
const down = quoteFor(m, "down", 5)!;

check("UP on a $5 stake pays ~6.09", Math.abs(up.payout - 6.09) < 0.01, `payout ${up.payout.toFixed(2)}`);
check("DOWN on a $5 stake pays ~24.51", Math.abs(down.payout - 24.51) < 0.01, `payout ${down.payout.toFixed(2)}`);
check("profit excludes the stake", Math.abs(up.profit - (up.payout - 5)) < 1e-9);
check("multiple is the reciprocal of price", Math.abs(down.multiple - 1 / 0.204) < 1e-9, `${down.multiple.toFixed(2)}x`);

// The asymmetry the user asked about, asserted as intended.
check(
  "the cheaper side pays more (intended, not a bug)",
  down.payout > up.payout && down.price < up.price,
  `0.204 -> ${down.payout.toFixed(2)} beats 0.821 -> ${up.payout.toFixed(2)}`,
);

// Missing liquidity must be reported as absent, never as a free or infinite bet.
const oneSided = market({ yesAsk: 0.5, noAsk: undefined });
check("no ask on a leg yields no quote", quoteFor(oneSided, "down", 5) === null);
check("a quote still exists for the priced leg", quoteFor(oneSided, "up", 5) !== null);
check("a zero price yields no quote", quoteFor(market({ noAsk: 0 }), "down", 5) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
