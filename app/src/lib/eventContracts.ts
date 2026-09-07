// Client-side Event Contract helpers — the app's equivalent of
// chain-integration/scripts/place-event-contract-call.ts, adapted to run
// inside the app against the user's own embedded-wallet signer. Kept in sync
// deliberately: same venue scoping, same lot/tick handling, same "buy the
// called leg via IOC" approach. See that script's comments for the fuller
// rationale (the NO-leg pricing gotcha in particular).

import {
  SomniaMarkets,
  isBinaryMarket,
  ORDER_TYPE,
  type UnifiedMarket,
  type MarketOnchain,
} from "@somnia-chain/markets-sdk";
import {
  createReadOnlyExchange,
  createSignerExchange,
  createWalletClientExchange,
  VENUE_ID,
  LOT_RAW,
  TICK_RAW,
} from "./chain";
import type { Direction, Symbol_, WindowLength } from "./types";
import type { CallSigner } from "./walletTypes";

const WINDOW_SECONDS: Record<WindowLength, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
};

export interface LiveMarketInfo {
  market: UnifiedMarket;
  onchain: MarketOnchain;
  symbol: Symbol_;
  window: WindowLength | null; // null if the venue is running a cadence Streakr doesn't label (e.g. 4h/1d)
  intervalSec: number;
  secondsLeft: number;
  yesBid?: number;
  yesAsk?: number;
}

function labelWindow(intervalSec: number): WindowLength | null {
  for (const [label, secs] of Object.entries(WINDOW_SECONDS)) {
    if (secs === intervalSec) return label as WindowLength;
  }
  return null;
}

/** Every currently-Trading BTC/ETH binary market on the DreamDEX venue, with book snapshots. */
export async function listLiveMarkets(): Promise<LiveMarketInfo[]> {
  const exchange = createReadOnlyExchange();
  const all = Object.values(await exchange.loadMarkets(true));
  const live = all.filter(
    (m) => m.type === "binary" && m.active && isBinaryMarket(m.info) && m.info.venueId?.toLowerCase() === VENUE_ID.toLowerCase(),
  );

  const results: LiveMarketInfo[] = [];
  for (const m of live) {
    if (!isBinaryMarket(m.info)) continue;
    const asset = m.info.asset;
    if (asset !== "BTC" && asset !== "ETH") continue;
    const onchain = await exchange.client.getMarketOnchain(m.info.marketId as `0x${string}`);
    if (onchain.status !== 1) continue; // authoritative on-chain gate — never trust the indexer alone
    const intervalSec = Number(m.info.intervalSec ?? 0);
    const yesSymbol = m.outcomes?.[0]?.symbol;
    let yesBid: number | undefined;
    let yesAsk: number | undefined;
    if (yesSymbol) {
      try {
        const book = await exchange.fetchOrderBook(yesSymbol, 3);
        yesBid = book.bids[0]?.[0];
        yesAsk = book.asks[0]?.[0];
      } catch {
        // no resting liquidity yet — leave undefined, UI shows "—"
      }
    }
    results.push({
      market: m,
      onchain,
      symbol: asset,
      window: labelWindow(intervalSec),
      intervalSec,
      secondsLeft: Number(onchain.expiry) - Math.floor(Date.now() / 1000),
      yesBid,
      yesAsk,
    });
  }
  return results;
}

/** Pick the live market for a symbol+window the Room screen wants to call against. */
export async function findMarket(symbol: Symbol_, window: WindowLength): Promise<LiveMarketInfo | null> {
  const markets = await listLiveMarkets();
  const matches = markets.filter((m) => m.symbol === symbol && m.window === window);
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.secondsLeft - a.secondsLeft);
  return matches[0];
}

export interface PlaceCallResult {
  txHash: string;
  positionId: string;
  filledShares: number;
  fillPrice: number;
  stakeSpent: number;
}

function toSteps(human: number, decimals: number, step: bigint, mode: "round" | "floor"): bigint {
  const one = 10n ** BigInt(decimals);
  const stepsPerOne = Number(one / step);
  const n = human * stepsPerOne;
  const steps = mode === "round" ? Math.round(n) : Math.floor(n + 1e-9);
  return BigInt(Math.max(0, steps)) * step;
}

/**
 * Submit a real signed Up/Down call. This is what the Call Confirmation
 * screen invokes on "Confirm" — a real wallet-signed testnet transaction,
 * never simulated.
 */
export async function placeCall(
  signer: CallSigner,
  info: LiveMarketInfo,
  direction: Direction,
  stakeUsdso: number,
  maxSlippage = 0.03,
): Promise<PlaceCallResult> {
  // Same trader surface either way — the only difference is where the key
  // lives (on-device vs in the user's external wallet).
  const exchange: SomniaMarkets =
    signer.kind === "embedded"
      ? createSignerExchange(signer.privateKey)
      : createWalletClientExchange(signer.walletClient);
  const decimals = info.onchain.decimals;

  const outcomes = info.market.outcomes ?? [];
  const symbol = direction === "up" ? outcomes[0]?.symbol : outcomes[1]?.symbol;
  if (!symbol) throw new Error(`${info.market.symbol}: missing ${direction === "up" ? "YES" : "NO"} outcome symbol`);

  const book = await exchange.fetchOrderBook(symbol, 5);
  const bestAsk = book.asks[0]?.[0];
  if (bestAsk === undefined) throw new Error(`${symbol}: no resting liquidity to take against`);

  const priceHuman = Math.min(0.99, bestAsk + maxSlippage);
  const priceOwn = toSteps(priceHuman, decimals, TICK_RAW, "round");
  const one = 10n ** BigInt(decimals);
  if (priceOwn <= 0n || priceOwn >= one) throw new Error(`price ${priceHuman} out of (0,1) after tick snap`);

  const rawShares = stakeUsdso / priceHuman;
  const quantity = toSteps(rawShares, decimals, LOT_RAW, "floor");
  if (quantity <= 0n) throw new Error(`stake ${stakeUsdso} rounds to 0 shares on this venue's lot grid`);

  // Book is quoted in YES terms; NO's own price is 1 - YES at the raw level.
  const outcome = direction === "up" ? "YES" : "NO";
  const priceYes = outcome === "YES" ? priceOwn : one - priceOwn;

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(nowSec + 60, Number(info.onchain.expiry));
  if (expiresAt <= nowSec) throw new Error("window closes too soon to place this call");

  const res = await exchange.trader.placeOrder({
    pool: info.onchain.pool,
    side: outcome === "YES" ? "BUY_YES" : "BUY_NO",
    price: priceYes,
    quantity,
    outcomeToken: info.onchain.outcomeToken,
    yesId: info.onchain.yesId,
    noId: info.onchain.noId,
    orderType: ORDER_TYPE.MARKET, // IOC — take what crosses now, never rest silently
    expireTimestampNs: BigInt(expiresAt) * 1_000_000_000n,
  });

  if (res.receipt?.status === "reverted") {
    throw new Error(`call reverted on-chain (tx ${res.hash ?? "?"})`);
  }

  const filledRaw = (res.fills ?? []).reduce((acc, f) => acc + f.quantityFilled, 0n);
  const filledShares = Number(filledRaw) / Number(one);
  const fillPrice = Number(priceOwn) / Number(one);

  if (filledShares <= 0) {
    throw new Error("order did not fill — the book likely moved; try again");
  }

  const marketId = isBinaryMarket(info.market.info) ? info.market.info.marketId : "";
  return {
    txHash: res.hash ?? "",
    positionId: marketId,
    filledShares,
    fillPrice,
    stakeSpent: filledShares * fillPrice,
  };
}
