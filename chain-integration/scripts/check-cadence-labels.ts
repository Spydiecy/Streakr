/**
 * Does every live BTC/ETH market on the venue map to a Streakr window label?
 *
 * Written to confirm a specific bug: the app matched `intervalSec` against
 * exact cadence seconds, but the indexer derives a series' interval as
 * `expiry − tradingStart` and trading opens a second or two late, so a 1d
 * series is routinely indexed as 86398 rather than 86400. Those rows labelled
 * as `null`, got dropped from the window list, and the 4h/1d chips appeared to
 * vanish at random.
 *
 * Prints the raw interval next to both the old exact match and the new
 * nearest-rung snap, so the difference is visible rather than asserted.
 *
 *   npx tsx scripts/check-cadence-labels.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");

const WINDOW_SECONDS: Record<string, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** The old behaviour: exact equality. */
function labelExact(intervalSec: number): string | null {
  for (const [label, secs] of Object.entries(WINDOW_SECONDS)) {
    if (secs === intervalSec) return label;
  }
  return null;
}

/** The new behaviour: snap to the nearest rung within a scaled tolerance. */
function labelSnapped(intervalSec: number): string | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  let best: { label: string; secs: number; delta: number } | null = null;
  for (const [label, secs] of Object.entries(WINDOW_SECONDS)) {
    const delta = Math.abs(secs - intervalSec);
    if (!best || delta < best.delta) best = { label, secs, delta };
  }
  if (!best) return null;
  return best.delta <= Math.max(10, best.secs * 0.01) ? best.label : null;
}

async function main() {
  const ctx = createExchange({ withSigner: false });
  const venueId = process.env.VENUE_ID as `0x${string}`;

  const rows = await ctx.exchange.client.listBinaryMarkets({
    venueId,
    status: "Trading",
    limit: 60,
  });

  const mine = rows.filter((r: any) => r.asset === "BTC" || r.asset === "ETH");
  console.log(`live BTC/ETH Trading rows on venue: ${mine.length}\n`);

  console.log(
    ["asset".padEnd(6), "intervalSec".padEnd(12), "sdkLabel".padEnd(9), "exact".padEnd(7), "snapped"].join(" "),
  );
  console.log("-".repeat(52));

  let fixed = 0;
  const byWindow = new Map<string, number>();

  for (const r of mine as any[]) {
    const indexed = Number(r.intervalSec ?? 0);
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId);
    const derived = Number(onchain.expiry) - Number(r.tradingStart ?? 0);
    const interval = indexed > 0 ? indexed : derived;

    const ex = labelExact(interval);
    const sn = labelSnapped(interval);
    if (!ex && sn) fixed++;
    if (sn) byWindow.set(sn, (byWindow.get(sn) ?? 0) + 1);

    console.log(
      [
        String(r.asset).padEnd(6),
        String(interval).padEnd(12),
        String(r.interval ?? "-").padEnd(9),
        String(ex ?? "NULL").padEnd(7),
        String(sn ?? "NULL"),
      ].join(" "),
    );
  }

  console.log(`\nrows the exact match dropped but snapping recovers: ${fixed}`);
  console.log("windows available after snapping:", Object.fromEntries(byWindow));

  await shutdown(ctx);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
