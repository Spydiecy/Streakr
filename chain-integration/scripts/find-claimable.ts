/**
 * Any unredeemed winning positions held by the signer?
 *
 * A resolved market does not pay out on its own — the winning tokens sit in the
 * wallet until burned for the collateral behind them. This finds those, which is
 * both a check that the app's new claim step is needed and a way to exercise it.
 *
 *   npx tsx scripts/find-claimable.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, shutdown, toHuman } = await import("@dreamdex-bot-kit/ec-core");

async function main() {
  const ctx = createExchange({ withSigner: true });
  const addr = ctx.exchange.walletAddress!;
  console.log("signer:", addr);

  // Recently settled markets on our venue.
  const rows = await ctx.exchange.client.listPastBinaryMarkets({
    venueId: process.env.VENUE_ID as `0x${string}`,
    limit: 40,
  } as never);
  console.log("settled markets scanned:", (rows as any[]).length);

  let found = 0;
  for (const r of rows as any[]) {
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId).catch(() => null);
    if (!onchain || !(onchain.isResolved || onchain.isVoided)) continue;
    const [yes, no] = await Promise.all([
      ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: addr, id: onchain.yesId }),
      ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: addr, id: onchain.noId }),
    ]);
    if (yes === 0n && no === 0n) continue;
    const win = onchain.isVoided ? "voided" : onchain.winningOutcome === 0 ? "YES" : "NO";
    console.log(`\n${r.symbol ?? r.asset} ${r.interval ?? ""}  marketId=${r.marketId}`);
    console.log(`  winning outcome: ${win}`);
    console.log(`  held YES: ${toHuman(yes, onchain.decimals)}   held NO: ${toHuman(no, onchain.decimals)}`);
    const claimable = onchain.isVoided ? yes + no : onchain.winningOutcome === 0 ? yes : no;
    if (claimable > 0n) {
      console.log(`  -> CLAIMABLE: ${toHuman(claimable, onchain.decimals)} tokens`);
      found++;
    }
  }
  console.log(`\n${found} position(s) with claimable value`);
  await shutdown(ctx);
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
