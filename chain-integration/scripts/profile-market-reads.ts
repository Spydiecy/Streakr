// Where does the time go when Streakr's Room screen loads a market?
//
// Compares the two ways to discover live binary markets:
//   A) exchange.loadMarkets()          — pulls the whole registry (all venues)
//   B) client.listBinaryMarkets(...)   — targeted indexer query
//
// plus the per-market on-chain + order-book reads.
//
//   npx tsx scripts/profile-market-reads.ts

import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");

const VENUE = process.env.VENUE_ID as `0x${string}`;
const t = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = Date.now();
  try {
    const v = await fn();
    console.log(`  ${label.padEnd(44)} ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    return v;
  } catch (e) {
    console.log(`  ${label.padEnd(44)} FAILED after ${((Date.now() - t0) / 1000).toFixed(2)}s — ${(e as Error).message.slice(0, 80)}`);
    throw e;
  }
};

async function main() {
  const ctx = createExchange({ withSigner: false });
  console.log("\n--- discovery ---");

  const all = await t("A) loadMarkets(true)  [full registry]", () => ctx.exchange.loadMarkets(true));
  const total = Object.keys(all).length;
  console.log(`     -> ${total} markets in registry`);

  const binaries = await t("B) listBinaryMarkets({venueId, Trading})", () =>
    ctx.exchange.client.listBinaryMarkets({ venueId: VENUE, status: "Trading", limit: 50 }),
  );
  console.log(`     -> ${binaries.length} live binary market(s) on our venue`);

  await t("A2) loadMarkets(false) [cached]", () => ctx.exchange.loadMarkets(false));

  console.log("\n--- per-market reads (first live market) ---");
  const first = binaries[0];
  if (first) {
    await t("getMarketOnchain(marketId)", () =>
      ctx.exchange.client.getMarketOnchain(first.marketId as `0x${string}`),
    );
    const sym = `${first.asset}-0-...`;
    console.log(`     (market: ${sym} interval=${first.intervalSec}s)`);
  }

  console.log("\n--- parallel on-chain status for all live markets ---");
  await t(`getMarketOnchain x${binaries.length} in parallel`, () =>
    Promise.all(binaries.map((b) => ctx.exchange.client.getMarketOnchain(b.marketId as `0x${string}`))),
  );

  await shutdown(ctx);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
