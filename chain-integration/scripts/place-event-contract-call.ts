/**
 * place-event-contract-call.ts — Streakr's "make a real call" primitive.
 *
 * Wraps DreamDEX's Event Contracts (@somnia-chain/markets-sdk via ec-core) to
 * do exactly what a Streakr user does when they tap Up/Down in a Room: submit
 * one real, wallet-signed, testnet-collateralized taker order on the live
 * on-chain market, sized to a USDso (tUSDC on testnet) stake.
 *
 * Inputs (env):
 *   SYMBOL       BTC | ETH                              (required)
 *   DIRECTION    up | down                               (required)
 *   WINDOW       15m | 1h  (also accepts 4h/1d/1w if the venue is running one)
 *   STAKE_USDSO  stake in collateral units, e.g. 5        (default 5)
 *   MAX_SLIPPAGE how far past the touch we're willing to cross, in probability
 *                (default 0.02)
 *
 * What it does:
 *   1. Loads the venue's active binary (Up/Down) markets, scoped by VENUE_ID.
 *   2. Picks the live market for SYMBOL whose interval matches WINDOW. If the
 *      venue isn't currently running that exact cadence, it says so explicitly
 *      and lists what IS live — it does not silently substitute a market.
 *   3. Gates on the AUTHORITATIVE on-chain status (Trading), never the indexer.
 *   4. Reads the YES book, converts DIRECTION to an outcome leg (Up = YES,
 *      Down = NO — a Down price is 1 - YES), and sizes an IOC order in shares
 *      from STAKE_USDSO / price so the wallet risks ~STAKE_USDSO of collateral.
 *   5. Sends the order through ec-core's placeLimit (tick/lot-safe, avoids the
 *      float-price bug on 18-decimal venues) with type "ioc" — takes what
 *      crosses now, cancels any unfilled remainder. This is the real
 *      wallet-signed transaction; nothing here is simulated.
 *   6. Prints the resulting order id, tx hash, fill size/price, and the
 *      marketId — the position id Streakr stores on the `calls` record and
 *      hands to watch-settlement.ts.
 *
 * Usage:
 *   SYMBOL=BTC DIRECTION=up WINDOW=1h STAKE_USDSO=5 npx tsx scripts/place-event-contract-call.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const {
  createExchange,
  loadConfig,
  shutdown,
  activeMarkets,
  marketOnchain,
  isTradable,
  outcomeSymbols,
  quantize,
  clampProbability,
  assertProbability,
  placeLimit,
} = await import("@dreamdex-bot-kit/ec-core");
import { isBinaryMarket } from "@somnia-chain/markets-sdk";

const WINDOW_SECONDS: Record<string, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
};

function parseArgs() {
  const symbol = (process.env.SYMBOL ?? "").toUpperCase();
  const direction = (process.env.DIRECTION ?? "").toLowerCase();
  const window = (process.env.WINDOW ?? "").toLowerCase();
  const stakeUsdso = Number(process.env.STAKE_USDSO ?? "5");
  const maxSlippage = Number(process.env.MAX_SLIPPAGE ?? "0.02");

  if (symbol !== "BTC" && symbol !== "ETH") {
    throw new Error(`SYMBOL must be "BTC" or "ETH", got "${process.env.SYMBOL}"`);
  }
  if (direction !== "up" && direction !== "down") {
    throw new Error(`DIRECTION must be "up" or "down", got "${process.env.DIRECTION}"`);
  }
  if (!WINDOW_SECONDS[window]) {
    throw new Error(
      `WINDOW must be one of ${Object.keys(WINDOW_SECONDS).join(", ")}, got "${process.env.WINDOW}"`,
    );
  }
  if (!(stakeUsdso > 0)) throw new Error(`STAKE_USDSO must be > 0, got ${stakeUsdso}`);

  return { symbol, direction: direction as "up" | "down", window, wantIntervalSec: WINDOW_SECONDS[window], stakeUsdso, maxSlippage };
}

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

async function main() {
  const args = parseArgs();
  const cfg = loadConfig();
  const ctx = createExchange({ withSigner: true });
  log(
    `wallet ${ctx.exchange.walletAddress} · network ${cfg.network} · dryRun ${cfg.dryRun} ` +
      `· call: ${args.symbol} ${args.direction.toUpperCase()} ${args.window} stake=${args.stakeUsdso}`,
  );

  const markets = await activeMarkets(ctx, { asset: args.symbol, max: 50 });
  if (markets.length === 0) {
    throw new Error(
      `no active ${args.symbol} binary markets in this venue scope. Run "npm run ec:doctor" to inspect the venue.`,
    );
  }

  // Match the requested cadence exactly. Do NOT silently substitute a
  // different window — a wrong WINDOW is a real gotcha (docs/event-contracts.md
  // #12: read intervalSec, never the question text), so report what's live
  // instead of guessing for the caller.
  const candidates: { market: (typeof markets)[number]; intervalSec: number }[] = [];
  for (const m of markets) {
    const interval = isBinaryMarket(m.info) ? Number(m.info.intervalSec ?? 0) : 0;
    candidates.push({ market: m, intervalSec: interval });
  }
  const matches = candidates.filter((c) => c.intervalSec === args.wantIntervalSec);
  if (matches.length === 0) {
    const live = [...new Set(candidates.map((c) => `${Math.round(c.intervalSec / 60)}m`))].join(", ");
    throw new Error(
      `no live ${args.symbol} market runs a ${args.window} window right now on this venue. ` +
        `Live cadences for ${args.symbol}: ${live || "(none)"}. ` +
        `Choose one of those, or wait for the venue to roll a ${args.window} series.`,
    );
  }
  // Prefer the one with the most time left (soonest-expiring windows may lock
  // before we can size + send).
  matches.sort((a, b) => 0); // stable; activeMarkets already orders by discovery
  let picked: { market: (typeof markets)[number]; intervalSec: number } | null = null;
  let onchain: Awaited<ReturnType<typeof marketOnchain>> = null;
  for (const c of matches) {
    const oc = await marketOnchain(ctx, c.market);
    if (!oc || !isTradable(oc)) continue;
    if (!picked || Number(oc.expiry) > Number((await marketOnchain(ctx, picked.market))?.expiry ?? 0)) {
      picked = c;
      onchain = oc;
    }
  }
  if (!picked || !onchain) {
    throw new Error(`found a ${args.window} ${args.symbol} market, but none are in "Trading" status right now.`);
  }

  const left = Number(onchain.expiry) - Date.now() / 1000;
  log(`market ${picked.market.symbol} · marketId ${(picked.market.info as any).marketId} · window closes in ${Math.round(left / 60)}m`);
  if (left < 20) {
    throw new Error(`window closes in ${Math.round(left)}s — too close to lock, refusing to place a call the user can't realistically confirm.`);
  }

  // Up = YES leg, Down = NO leg. Fetch the order book for THAT outcome's own
  // symbol directly (fetchOrderBook returns asks/bids already in the traded
  // outcome's own probability terms — no complement arithmetic needed, which
  // is where an earlier version of this script had a sign bug: deriving the
  // NO price as 1-YES-bid and then subtracting slippage moved the price the
  // wrong way and the IOC never crossed).
  const outcome = args.direction === "up" ? "YES" : "NO";
  const { yes, no } = outcomeSymbols(picked.market);
  const outcomeSymbol = outcome === "YES" ? yes : no;
  const outcomeBook = await ctx.exchange.fetchOrderBook(outcomeSymbol, 5);
  const bestAsk = outcomeBook.asks[0]?.[0];
  if (bestAsk === undefined) {
    throw new Error(`${outcomeSymbol}: no resting ask to take against — cannot size a taker buy.`);
  }
  // We are always BUYING the called outcome, so cross by paying slightly
  // above the best ask (in that outcome's own probability terms).
  const crossPrice = clampProbability(bestAsk + args.maxSlippage);
  assertProbability(crossPrice);

  // NOTE: unlike ec-starter/ec-passive, this script never calls
  // seedInventory(). Streakr's calls are always a TAKER BUY of the called
  // leg (Up = buy YES, Down = buy NO) — a straightforward escrow-and-fill
  // against resting liquidity, not a sell. seedInventory mint-a-pairs 200
  // extra YES+NO shares for sell-side quoting, which a buy-only flow never
  // needs and which otherwise pollutes the wallet's outcome-token balance
  // (measured: an early version of this script minted a needless 200-share
  // pair per market, making "how many shares did THIS call buy" unreadable
  // from getOutcomeBalance alone).

  // Convert the USDso stake into a share size at the price we're paying:
  // stake ≈ price * shares  ⇒  shares ≈ stake / price.
  const rawShares = args.stakeUsdso / crossPrice;
  const shares = quantize(ctx, rawShares);
  if (shares <= 0) {
    throw new Error(`stake ${args.stakeUsdso} at price ${crossPrice.toFixed(4)} rounds to 0 shares on this venue's lot grid — increase STAKE_USDSO.`);
  }

  if (cfg.dryRun) {
    log(`DRY RUN — would submit: buy ${outcome} ${shares} shares @ ~${crossPrice.toFixed(4)} on ${picked.market.symbol} (stake ≈ ${(shares * crossPrice).toFixed(4)} tUSDC)`);
    log(`set DRY_RUN=false in .env to send a real signed transaction.`);
    await shutdown(ctx);
    return;
  }

  const order = await placeLimit(ctx, {
    market: picked.market,
    onchain,
    outcome,
    side: "buy",
    price: crossPrice,
    size: shares,
    type: "ioc",
    expiresInSec: Math.min(120, Math.max(20, Math.floor(left))),
  });

  const positionId = (picked.market.info as any).marketId as string;
  console.log("\n=== CALL SUBMITTED ===");
  console.log(`symbol       : ${args.symbol}`);
  console.log(`direction    : ${args.direction.toUpperCase()}`);
  console.log(`window       : ${args.window} (${picked.market.symbol})`);
  console.log(`positionId   : ${positionId}`);
  console.log(`orderId      : ${order.orderId?.toString() ?? "(none — fully filled, no resting remainder)"}`);
  console.log(`txHash       : ${order.hash ?? "(no hash returned by SDK)"}`);
  console.log(`filled       : ${order.filled} / ${order.size} shares @ ~${order.price.toFixed(4)}`);
  console.log(`stakeSpent   : ~${(order.filled * order.price).toFixed(4)} tUSDC`);
  console.log(`windowClosesAt: ${new Date(Number(onchain.expiry) * 1000).toISOString()}`);
  console.log("=======================\n");

  await shutdown(ctx);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`ERROR: ${(e as Error).message}`);
    process.exit(1);
  },
);
