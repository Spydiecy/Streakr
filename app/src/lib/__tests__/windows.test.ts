/**
 * labelWindow() / availableWindows() — which window chips the room offers.
 *
 * This is tested because every bug it has had was SILENT. A cadence the venue is
 * genuinely running, with real liquidity, becomes `null` and is then dropped —
 * the market never appears, nothing errors, and nothing in the UI hints that it
 * existed. It has happened twice:
 *
 *   1. An exact `===` match returned null for series indexed a second or two off
 *      (899s for a 15m), so the 4h/1d chips vanished and reappeared at random.
 *   2. There was no 300s rung at all, so every 5m market was invisible — while
 *      being the cadence the venue ran MOST of (4 live markets vs 2 each for
 *      15m/1h/4h/1d, measured with chain-integration/scripts/list-cadences.ts).
 *
 * Both were found by looking at the chain, not by using the app. Hence a table.
 *
 *   npm run test         (from app/)
 */
import { labelWindow, availableWindows, WINDOW_SECONDS, WINDOW_ORDER } from "../windows";
import type { WindowLength } from "../types";

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

type Case = { secs: number; expect: WindowLength | null; why: string };

const cases: Case[] = [
  // Exact rungs.
  { secs: 300, expect: "5m", why: "the venue runs 5m and it must be labelled" },
  { secs: 900, expect: "15m", why: "exact 15m" },
  { secs: 3600, expect: "1h", why: "exact 1h" },
  { secs: 14400, expect: "4h", why: "exact 4h" },
  { secs: 86400, expect: "1d", why: "exact 1d" },
  { secs: 604800, expect: "1w", why: "exact 1w" },

  // Trading opening a moment late — the real-world case that broke chips.
  { secs: 299, expect: "5m", why: "5m opened a second late" },
  { secs: 298, expect: "5m", why: "5m opened two seconds late" },
  { secs: 899, expect: "15m", why: "the ETH series actually seen indexed at 899s" },
  { secs: 898, expect: "15m", why: "15m, two seconds of drift" },
  { secs: 86399, expect: "1d", why: "1d off by one second" },
  { secs: 86398, expect: "1d", why: "1d off by two seconds" },
  // 1% of a day is 864s, so a whole 10 minutes of drift still labels 1d.
  { secs: 85536, expect: "1d", why: "1d at the edge of its 1% tolerance" },

  // Neighbours must never merge — mislabelling means the countdown and the
  // settlement time disagree, which is worse than dropping the market.
  { secs: 600, expect: null, why: "10m is between rungs and has no label" },
  { secs: 1800, expect: null, why: "30m is between 15m and 1h" },
  { secs: 7200, expect: null, why: "2h is between 1h and 4h" },
  { secs: 43200, expect: null, why: "12h is between 4h and 1d" },

  // Degenerate input: a freshly-rolled row can report no interval at all.
  { secs: 0, expect: null, why: "missing interval" },
  { secs: -1, expect: null, why: "negative interval" },
  { secs: NaN, expect: null, why: "NaN interval" },
  { secs: Infinity, expect: null, why: "non-finite interval" },
];

for (const c of cases) {
  const got = labelWindow(c.secs);
  check(
    `${String(c.secs).padStart(7)}s -> ${got ?? "null"}  (${c.why})`,
    got === c.expect,
    got === c.expect ? "" : `expected ${c.expect ?? "null"}, got ${got ?? "null"}`,
  );
}

// The regression that prompted this file: 5m must be a known rung AND come first,
// since the chips read left-to-right and the soonest cadence should lead.
check("5m is a known rung", WINDOW_SECONDS["5m"] === 300, `got ${WINDOW_SECONDS["5m"]}`);
check("5m sorts first in the chip order", WINDOW_ORDER[0] === "5m", `got ${WINDOW_ORDER[0]}`);
check(
  "every rung has a label and every label a rung",
  WINDOW_ORDER.every((w) => typeof WINDOW_SECONDS[w] === "number") &&
    Object.keys(WINDOW_SECONDS).length === WINDOW_ORDER.length,
  `${Object.keys(WINDOW_SECONDS).length} rungs vs ${WINDOW_ORDER.length} ordered`,
);

// No two rungs may sit within each other's tolerance, or one cadence would
// silently label as its neighbour. Checks the invariant rather than the pairs, so
// adding a rung later can't quietly break it.
{
  const secs = WINDOW_ORDER.map((w) => WINDOW_SECONDS[w]).sort((a, b) => a - b);
  let tooClose: string | null = null;
  for (let i = 1; i < secs.length; i++) {
    const gap = secs[i] - secs[i - 1];
    const tol = Math.max(10, secs[i - 1] * 0.01) + Math.max(10, secs[i] * 0.01);
    if (gap <= tol) tooClose = `${secs[i - 1]}s and ${secs[i]}s are ${gap}s apart, tolerances sum to ${tol}s`;
  }
  check("no two rungs overlap within tolerance", tooClose === null, tooClose ?? "");
}

// availableWindows reads what's live and returns it in display order, so a room
// only ever offers a chip the venue is actually running.
{
  const markets = [
    { symbol: "BTC", window: "1h" as WindowLength },
    { symbol: "BTC", window: "5m" as WindowLength },
    { symbol: "BTC", window: null },
    { symbol: "ETH", window: "1d" as WindowLength },
  ];
  const btc = availableWindows(markets, "BTC");
  check(
    "available windows are ordered, not insertion-ordered",
    JSON.stringify(btc) === JSON.stringify(["5m", "1h"]),
    `got ${JSON.stringify(btc)}`,
  );
  check(
    "an unlabelled market contributes no chip",
    !btc.includes(null as unknown as WindowLength),
    `got ${JSON.stringify(btc)}`,
  );
  check(
    "windows are per asset",
    JSON.stringify(availableWindows(markets, "ETH")) === JSON.stringify(["1d"]),
    `got ${JSON.stringify(availableWindows(markets, "ETH"))}`,
  );
  check("no live markets means no chips", availableWindows([], "BTC").length === 0);
  check(
    "duplicate markets on one cadence yield one chip",
    JSON.stringify(
      availableWindows(
        [
          { symbol: "BTC", window: "5m" as WindowLength },
          { symbol: "BTC", window: "5m" as WindowLength },
        ],
        "BTC",
      ),
    ) === JSON.stringify(["5m"]),
  );
}

console.log(`\n${pass} passed, ${fail} failed  (cadence labelling)`);
process.exit(fail === 0 ? 0 : 1);
