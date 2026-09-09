/**
 * Dump the full order book for every live BTC/ETH window.
 *
 * Written to answer "why does DOWN show a 2% chance on a 15-minute coin flip?".
 * The displayed percentage is the best ASK, so this prints every resting level to
 * show whether that price reflects a real market or a single stale order sitting
 * far from fair value.
 *
 *   npx tsx scripts/inspect-book.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");

const LADDER: Record<string, number> = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
const label = (s: number) => Object.entries(LADDER).find(([, v]) => Math.abs(v - s) <= Math.max(10, v * 0.01))?.[0] ?? null;

async function main() {
  const ctx = createExchange({ withSigner: false });
  const rows = await ctx.exchange.client.listBinaryMarkets({
    venueId: process.env.VENUE_ID as `0x${string}`,
    status: "Trading",
    limit: 60,
  });

  for (const r of rows as any[]) {
    if (r.asset !== "BTC" && r.asset !== "ETH") continue;
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId);
    if (onchain.status !== 1) continue;
    const win = label(Number(r.intervalSec ?? 0));
    if (!win) continue;

    const book = await ctx.exchange.client.getBinaryOrderBook(onchain.pool).catch(() => null);
    if (!book) continue;
    const one = 10 ** onchain.decimals;
    const fmt = (side: any[]) =>
      side.length === 0 ? "(empty)" : side.slice(0, 4).map((l) => `${(Number(l.price) / one).toFixed(3)}x${(Number(l.quantity ?? l.size ?? 0) / one).toFixed(1)}`).join(" ");

    const secs = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
    console.log(`\n${r.asset} ${win}  (${Math.floor(secs / 60)}m ${secs % 60}s left)`);
    console.log(`  YES bids: ${fmt(book.yesBids)}`);
    console.log(`  YES asks: ${fmt(book.yesAsks)}`);
    console.log(`  NO  bids: ${fmt(book.noBids)}`);
    console.log(`  NO  asks: ${fmt(book.noAsks)}`);

    const ya = book.yesAsks[0] ? Number(book.yesAsks[0].price) / one : null;
    const na = book.noAsks[0] ? Number(book.noAsks[0].price) / one : null;
    console.log(`  -> UP shows ${ya === null ? "—" : Math.round(ya * 100) + "%"}, DOWN shows ${na === null ? "—" : Math.round(na * 100) + "%"}`);
    if (ya !== null && na !== null) {
      console.log(`  -> the two asks sum to ${((ya + na) * 100).toFixed(0)}% (100% would be a tight two-sided market)`);
    }
    const levels = book.yesAsks.length + book.noAsks.length + book.yesBids.length + book.noBids.length;
    console.log(`  -> ${levels} resting level(s) in total across all four sides`);
  }

  await shutdown(ctx);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
