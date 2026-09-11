/**
 * Every cadence the venue is actually running right now, unfiltered.
 *
 * The app only shows windows it has a label for, so anything the venue runs at a
 * cadence outside that list is dropped silently — the market exists and is
 * tradable, and the UI simply never mentions it. This script answers "what is
 * really out there" without the app's allowlist in the way, which is the only way
 * to tell "the venue doesn't run it" apart from "we filter it out".
 *
 *   npx tsx scripts/list-cadences.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");

// The app's rungs, for reporting which rows it would keep.
const APP_RUNGS: Record<string, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
};

/** Mirrors labelWindow() in app/src/lib/eventContracts.ts. */
function appLabel(intervalSec: number): string | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  let best: { label: string; secs: number; delta: number } | null = null;
  for (const [label, secs] of Object.entries(APP_RUNGS)) {
    const delta = Math.abs(secs - intervalSec);
    if (!best || delta < best.delta) best = { label, secs, delta };
  }
  if (!best) return null;
  const tolerance = Math.max(10, best.secs * 0.01);
  return best.delta <= tolerance ? best.label : null;
}

const pretty = (s: number) =>
  s % 86400 === 0 ? `${s / 86400}d` : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`;

async function main() {
  const ctx = createExchange({ withSigner: false });
  const venueId = process.env.VENUE_ID as `0x${string}`;
  console.log("venue:", venueId, "\n");

  const rows = (await ctx.exchange.client.listBinaryMarkets({
    venueId,
    status: "Trading",
    limit: 200,
  } as never)) as any[];

  console.log(`live "Trading" rows: ${rows.length}\n`);

  const seen = new Map<number, { count: number; assets: Set<string>; sample: string }>();

  for (const r of rows) {
    // expiry − tradingStart is authoritative; the indexer's intervalSec is
    // occasionally absent on a freshly-rolled row.
    const indexed = Number(r.intervalSec ?? 0);
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId).catch(() => null);
    const derived = onchain ? Number(onchain.expiry) - Number(r.tradingStart ?? 0) : 0;
    const secs = indexed > 0 ? indexed : derived;
    if (secs <= 0) continue;

    const e = seen.get(secs) ?? { count: 0, assets: new Set<string>(), sample: r.marketId };
    e.count++;
    e.assets.add(r.asset);
    seen.set(secs, e);
  }

  console.log("cadence    seconds   markets  assets        indexer label   app shows it as");
  console.log("─────────────────────────────────────────────────────────────────────────────");
  for (const [secs, e] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const label = appLabel(secs);
    const row = rows.find((r) => Number(r.intervalSec ?? 0) === secs);
    console.log(
      `${pretty(secs).padEnd(10)} ${String(secs).padEnd(9)} ${String(e.count).padEnd(8)} ` +
        `${[...e.assets].join(",").padEnd(13)} ${String(row?.interval ?? "-").padEnd(15)} ` +
        `${label ?? "*** DROPPED — no label ***"}`,
    );
  }

  const dropped = [...seen.entries()].filter(([s]) => appLabel(s) === null);
  console.log(
    `\n${dropped.length === 0
      ? "every live cadence has a label — nothing is being hidden"
      : `${dropped.length} cadence(s) tradable but invisible in the app: ${dropped.map(([s]) => pretty(s)).join(", ")}`}`,
  );

  await shutdown(ctx);
}

main().then(() => process.exit(0), (e) => { console.error(e.stack ?? e.message ?? e); process.exit(1); });
