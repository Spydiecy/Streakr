import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");
const VENUE = process.env.VENUE_ID as `0x${string}`;

async function main() {
  const ctx = createExchange({ withSigner: false });
  const rows = await ctx.exchange.client.listBinaryMarkets({ venueId: VENUE, status: "Trading", limit: 3 });
  console.log(`\n${rows.length} row(s). Shape of row[0]:\n`);
  console.log(JSON.stringify(rows[0], (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  console.log("\n--- can we read a book without loadMarkets? ---");
  const r = rows[0] as any;
  const oc = await ctx.exchange.client.getMarketOnchain(r.marketId);
  console.log("onchain keys:", Object.keys(oc).join(", "));
  try {
    const book = await ctx.exchange.client.getBinaryOrderBook({
      pool: oc.pool, yesId: oc.yesId, noId: oc.noId,
    } as any);
    console.log("getBinaryOrderBook OK:", JSON.stringify(book, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400));
  } catch (e) {
    console.log("getBinaryOrderBook failed:", (e as Error).message.slice(0, 200));
  }
  await shutdown(ctx);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
