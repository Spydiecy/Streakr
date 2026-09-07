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
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
};

/** Display order for whichever cadences happen to be live. */
export const WINDOW_ORDER: WindowLength[] = ["15m", "1h", "4h", "1d", "1w"];

/** Whether the SDK's market registry has been pulled at least once. */
let _registryLoaded = false;

let _prewarm: Promise<unknown> | null = null;

/**
 * Kick off the SDK's initial market-registry load early, without blocking.
 *
 * `loadMarkets()` pulls the whole registry for the deployment, which is large
 * (thousands of markets across all venues) and measured at ~20s cold. If that
 * happens when the user enters a Room, the market card sits on a spinner for
 * the entire time. Calling this on app mount moves the wait into the
 * onboarding / room-browsing time the user spends anyway, so the Room screen
 * usually finds a warm registry.
 *
 * Safe to call repeatedly — the work happens once.
 */
export function prewarmMarkets(): void {
  if (_prewarm) return;
  _prewarm = listLiveMarkets().catch(() => {
    // Best-effort warmup; the Room screen will retry and surface any error.
    _prewarm = null;
  });
}

/**
 * The cadences actually available for an asset right now, in display order.
 *
 * The venue rotates which series it runs, so this is read from live markets
 * rather than assumed. Returns [] when nothing is tradable for the asset.
 */
export function availableWindows(markets: LiveMarketInfo[], symbol: Symbol_): WindowLength[] {
  const live = new Set(
    markets.filter((m) => m.symbol === symbol && m.window !== null).map((m) => m.window as WindowLength),
  );
  return WINDOW_ORDER.filter((w) => live.has(w));
}

export interface LiveMarketInfo {
  /** bytes32 marketId — also the positionId stored on a call record. */
  marketId: `0x${string}`;
  onchain: MarketOnchain;
  symbol: Symbol_;
  /** Human label for the market, e.g. "BTC 1h". */
  label: string;
  /** null when the venue runs a cadence Streakr has no label for. */
  window: WindowLength | null;
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

/**
 * Every currently-Trading BTC/ETH binary market on the DreamDEX venue, with
 * book snapshots.
 *
 * Fans the per-market reads out in parallel. Each market needs two round-trips
 * (the authoritative on-chain snapshot, then its order book), and doing that
 * sequentially across ~6 live markets left the Room screen sitting on a
 * spinner for many seconds. The reads are independent, so there's no reason to
 * serialise them.
 *
 * @param asset optional filter — skips fetching markets the caller doesn't
 *              need at all, which is the cheapest win available here.
 */
/** Reject rather than hang forever if a network read stalls. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function listLiveMarkets(asset?: Symbol_): Promise<LiveMarketInfo[]> {
  const exchange = createReadOnlyExchange();

  // Discovery via the TARGETED indexer query rather than exchange.loadMarkets().
  //
  // Measured on Shannon testnet (scripts/profile-market-reads.ts in
  // chain-integration):
  //   loadMarkets(true)                        18.1s   (608 markets, all venues)
  //   listBinaryMarkets({venueId, "Trading"})   2.2s   (our venue only)
  //   getMarketOnchain x50 in parallel          1.7s
  //
  // loadMarkets pulls the entire registry for the whole deployment, which is
  // ~8x the cost and almost all of it markets we'd immediately discard. It
  // also turned out to see FEWER usable markets: its derived `active` flag hid
  // a live BTC 1h window that the indexer query reported as Trading.
  const rows = await withTimeout(
    exchange.client.listBinaryMarkets({
      venueId: VENUE_ID as `0x${string}`,
      status: "Trading",
      limit: 60,
    }),
    30_000,
    "Loading markets",
  );

  const candidates = rows.filter((r) => {
    const a = r.asset;
    if (a !== "BTC" && a !== "ETH") return false;
    return asset ? a === asset : true;
  });

  const settled = await Promise.all(
    candidates.map(async (row): Promise<LiveMarketInfo | null> => {
      try {
        const marketId = row.marketId as `0x${string}`;
        const onchain = await exchange.client.getMarketOnchain(marketId);
        // Authoritative on-chain gate. The indexer's own status lags by
        // seconds, so a row can read "Trading" after the window has locked.
        if (onchain.status !== 1) return null;

        const intervalSec = Number(row.intervalSec ?? 0);
        const decimals = onchain.decimals;
        const one = 10 ** decimals;

        // Book straight off the pool — no symbol lookup, so no registry needed.
        let yesBid: number | undefined;
        let yesAsk: number | undefined;
        try {
          const book = await exchange.client.getBinaryOrderBook(onchain.pool);
          const topBid = book.yesBids[0]?.price;
          const topAsk = book.yesAsks[0]?.price;
          if (topBid !== undefined) yesBid = Number(topBid) / one;
          if (topAsk !== undefined) yesAsk = Number(topAsk) / one;
        } catch {
          // No resting liquidity yet — leave undefined; the UI shows "—".
        }

        return {
          marketId,
          onchain,
          symbol: row.asset as Symbol_,
          label: `${row.asset} ${row.interval ?? labelWindow(intervalSec) ?? ""}`.trim(),
          window: labelWindow(intervalSec),
          intervalSec,
          secondsLeft: Number(onchain.expiry) - Math.floor(Date.now() / 1000),
          yesBid,
          yesAsk,
        };
      } catch {
        // One unreadable market shouldn't blank the whole screen.
        return null;
      }
    }),
  );

  return settled
    .filter((m): m is LiveMarketInfo => m !== null)
    // Soonest-expiring first, so the default selection is the most immediate.
    .sort((a, b) => a.secondsLeft - b.secondsLeft);
}

/** Pick the live market for a symbol+window the Room screen wants to call against. */
export async function findMarket(symbol: Symbol_, window: WindowLength): Promise<LiveMarketInfo | null> {
  const markets = await listLiveMarkets(symbol);
  const matches = markets.filter((m) => m.window === window);
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
  const one = 10n ** BigInt(decimals);
  const oneNum = Number(one);
  const outcome = direction === "up" ? "YES" : "NO";

  // Read the book straight off the pool. Prices come back in raw collateral
  // units, and the SDK already gives all four sides — so the leg being bought
  // takes its OWN asks (yesAsks for UP, noAsks for DOWN).
  //
  // Doing it this way avoids the sign trap that broke an earlier version:
  // deriving the NO price as (1 − yesBid) and then adding slippage moves the
  // price the wrong way, so the IOC never crosses and the order silently
  // fails to fill.
  const book = await exchange.client.getBinaryOrderBook(info.onchain.pool);
  const askRaw = outcome === "YES" ? book.yesAsks[0]?.price : book.noAsks[0]?.price;
  if (askRaw === undefined) {
    throw new Error(`${info.label}: no resting ${outcome} liquidity to take against right now`);
  }

  const bestAsk = Number(askRaw) / oneNum;
  const priceHuman = Math.min(0.99, bestAsk + maxSlippage);
  const priceOwn = toSteps(priceHuman, decimals, TICK_RAW, "round");
  if (priceOwn <= 0n || priceOwn >= one) {
    throw new Error(`price ${priceHuman} out of (0,1) after tick snap`);
  }

  const rawShares = stakeUsdso / priceHuman;
  const quantity = toSteps(rawShares, decimals, LOT_RAW, "floor");
  if (quantity <= 0n) {
    throw new Error(`stake ${stakeUsdso} rounds to 0 shares on this venue's lot grid`);
  }

  // The pool always wants the price in YES terms, so a NO order goes in as the
  // complement. Integer subtraction keeps it exactly on the tick grid.
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

  // The SDK skips simulation and resolves even on a reverted receipt, so this
  // has to be checked explicitly or a failed call looks like a success.
  if (res.receipt?.status === "reverted") {
    throw new Error(`call reverted on-chain (tx ${res.hash ?? "?"})`);
  }

  const filledRaw = (res.fills ?? []).reduce((acc, f) => acc + f.quantityFilled, 0n);
  const filledShares = Number(filledRaw) / oneNum;
  const fillPrice = Number(priceOwn) / oneNum;

  if (filledShares <= 0) {
    throw new Error("order did not fill — the book likely moved; try again");
  }

  return {
    txHash: res.hash ?? "",
    positionId: info.marketId,
    filledShares,
    fillPrice,
    stakeSpent: filledShares * fillPrice,
  };
}
