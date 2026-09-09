/**
 * On-chain truth for how long each live BTC/ETH window actually has left, and
 * how Streakr's Countdown would format it.
 *
 * Written to check a specific report: "the 1d window isn't showing the correct
 * time". The app's countdown reads `onchain.expiry`, so this prints the same
 * source next to the formatted output — if they agree, the display is right and
 * the fault was elsewhere (it was: a stale market from a lost race).
 *
 *   npx tsx scripts/check-window-timing.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");

const WINDOW_SECONDS: Record<string, number> = {
  "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
};

function labelSnapped(intervalSec: number): string | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;
  let best: { label: string; secs: number; delta: number } | null = null;
  for (const [label, secs] of Object.entries(WINDOW_SECONDS)) {
    const delta = Math.abs(secs - intervalSec);
    if (!best || delta < best.delta) best = { label, secs, delta };
  }
  return best && best.delta <= Math.max(10, best.secs * 0.01) ? best.label : null;
}

/** Mirrors app/src/components/Countdown.tsx exactly. */
function formatCountdown(secondsLeft: number): string {
  const hrs = Math.floor(secondsLeft / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  const secs = secondsLeft % 60;
  return hrs >= 1
    ? `${hrs}h ${String(mins).padStart(2, "0")}m`
    : `${mins}:${String(secs).padStart(2, "0")}`;
}

async function main() {
  const ctx = createExchange({ withSigner: false });
  const rows = await ctx.exchange.client.listBinaryMarkets({
    venueId: process.env.VENUE_ID as `0x${string}`,
    status: "Trading",
    limit: 60,
  });

  const now = Math.floor(Date.now() / 1000);
  const out: any[] = [];

  for (const r of rows as any[]) {
    if (r.asset !== "BTC" && r.asset !== "ETH") continue;
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId);
    if (onchain.status !== 1) continue;

    const indexed = Number(r.intervalSec ?? 0);
    const derived = Number(onchain.expiry) - Number(r.tradingStart ?? 0);
    const intervalSec = indexed > 0 ? indexed : derived;
    const win = labelSnapped(intervalSec);
    if (!win) continue;

    const secondsLeft = Number(onchain.expiry) - now;
    out.push({
      asset: r.asset,
      win,
      intervalSec,
      expiry: Number(onchain.expiry),
      secondsLeft,
      display: formatCountdown(Math.max(0, secondsLeft)),
      // Sanity: time left can never exceed the window length.
      sane: secondsLeft <= intervalSec + 5 && secondsLeft > 0,
    });
  }

  out.sort((a, b) => (a.asset + a.win).localeCompare(b.asset + b.win));

  console.log(
    ["asset".padEnd(6), "win".padEnd(5), "intervalSec".padEnd(12), "secsLeft".padEnd(9), "shows".padEnd(9), "sane"].join(" "),
  );
  console.log("-".repeat(56));
  for (const r of out) {
    console.log(
      [
        r.asset.padEnd(6),
        r.win.padEnd(5),
        String(r.intervalSec).padEnd(12),
        String(r.secondsLeft).padEnd(9),
        r.display.padEnd(9),
        r.sane ? "ok" : "*** IMPOSSIBLE ***",
      ].join(" "),
    );
  }

  const bad = out.filter((r) => !r.sane);
  console.log(`\n${out.length} live labelled window(s), ${bad.length} with impossible time remaining`);

  // Same-expiry check: several cadences genuinely roll on aligned boundaries, so
  // two windows showing the same minutes-past is expected, not a bug.
  const byExpiry = new Map<number, string[]>();
  for (const r of out) {
    byExpiry.set(r.expiry, [...(byExpiry.get(r.expiry) ?? []), `${r.asset} ${r.win}`]);
  }
  const shared = [...byExpiry.entries()].filter(([, v]) => v.length > 1);
  if (shared.length) {
    console.log("\nwindows sharing an expiry (aligned rolls — expected):");
    for (const [exp, v] of shared) console.log(`  ${exp}  ${v.join(", ")}`);
  }

  await shutdown(ctx);
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
