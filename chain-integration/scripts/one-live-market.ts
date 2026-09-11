/** Print one currently-trading market id for the shortest cadence. Used by
 *  backend/lambda/scripts/verify-nudge-fix.mjs, which needs a live pointer. */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });
const { createExchange, shutdown } = await import("@dreamdex-bot-kit/ec-core");
const ctx = createExchange({ withSigner: false });
const rows = (await ctx.exchange.client.listBinaryMarkets({
  venueId: process.env.VENUE_ID as `0x${string}`, status: "Trading", limit: 60,
} as never)) as any[];
const now = Math.floor(Date.now() / 1000);
let best: any = null;
for (const r of rows) {
  const oc = await ctx.exchange.client.getMarketOnchain(r.marketId).catch(() => null);
  if (!oc || oc.isResolved || oc.isVoided) continue;
  const left = Number(oc.expiry) - now;
  if (left <= 30) continue;
  if (!best || left < best.left) best = { id: r.marketId, left, asset: r.asset, interval: r.interval };
}
console.log(best ? `${best.id} ${best.asset} ${best.interval} ${best.left}s` : "none");
await shutdown(ctx);
process.exit(0);
