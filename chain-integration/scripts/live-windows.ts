// Quick read-only listing of the venue's live windows: asset, cadence, and
// time remaining. Useful for answering "is there a BTC 1h window right now?"
// without waiting on the full ec-doctor report.
//
//   npx tsx scripts/live-windows.ts

import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, activeMarkets, marketOnchain, shutdown } = await import("@dreamdex-bot-kit/ec-core");

const LABEL: Record<number, string> = {
  900: "15m", 3600: "1h", 14400: "4h", 86400: "1d", 604800: "1w",
};

async function main() {
  const ctx = createExchange({ withSigner: false });
  const markets = await activeMarkets(ctx, { max: 50 });
  const now = Math.floor(Date.now() / 1000);

  const rows = await Promise.all(
    markets.map(async (m) => {
      const info = m.info as any;
      const oc = await marketOnchain(ctx, m).catch(() => null);
      const interval = Number(info.intervalSec ?? 0);
      return {
        asset: info.asset,
        cadence: LABEL[interval] ?? `${interval}s`,
        status: oc?.status,
        minsLeft: oc ? Math.round((Number(oc.expiry) - now) / 60) : null,
        symbol: m.symbol,
      };
    }),
  );

  console.log(`\n${rows.length} live market(s) on the venue:\n`);
  for (const r of rows) {
    console.log(
      `  ${String(r.asset).padEnd(4)} ${r.cadence.padEnd(5)} status=${r.status} ttl=${r.minsLeft}m  ${r.symbol}`,
    );
  }
  const streakrUsable = rows.filter((r) => r.cadence === "15m" || r.cadence === "1h");
  console.log(
    `\nStreakr offers 15m + 1h. Currently usable: ${
      streakrUsable.length ? streakrUsable.map((r) => `${r.asset} ${r.cadence}`).join(", ") : "NONE"
    }\n`,
  );
  await shutdown(ctx);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
