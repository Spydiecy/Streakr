// Recent BTC/ETH price history, for the chart on the market card.
//
// Comes from the SDK's oracle price feed — the same source the momentum sentence
// uses — so the chart and the AI take can never disagree about what the market
// just did.
//
// Two constraints worth knowing:
//   - the feed serves only 1m / 1h / 1d timeframes. "5m" throws "unknown price
//     timeframe" at runtime, which is how we found out.
//   - testnet only; there is no mainnet price-feed endpoint bundled, so this
//     returns null there rather than throwing into the UI.

import { createReadOnlyExchange, NETWORK } from "./chain";
import type { Symbol_, WindowLength } from "./types";

/** A close price with its bucket timestamp. */
export interface PricePoint {
  t: number;
  close: number;
}

export interface PriceSeries {
  symbol: Symbol_;
  timeframe: "1m" | "1h";
  points: PricePoint[];
  first: number;
  last: number;
  /** Percent change across the series. */
  changePct: number;
  /** Lowest/highest close, for scaling the chart. */
  min: number;
  max: number;
}

/**
 * Which candle size to draw for a given call window.
 *
 * Matched so the chart spans a period that makes the window feel meaningful: a
 * 15-minute call wants minute candles over the last hour, a 1-day call wants
 * hourly candles over the last day. The feed's 1m/1h/1d limitation means there's
 * no finer option for the short windows.
 */
function frameFor(window: WindowLength | null): { timeframe: "1m" | "1h"; limit: number } {
  switch (window) {
    // Half an hour of minute candles: enough context to read a 5-minute call
    // without compressing the move that matters into a couple of pixels.
    case "5m":
      return { timeframe: "1m", limit: 30 };
    case "15m":
      return { timeframe: "1m", limit: 60 };
    case "1h":
      return { timeframe: "1m", limit: 120 };
    case "4h":
      return { timeframe: "1h", limit: 24 };
    default:
      return { timeframe: "1h", limit: 48 };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("price feed timed out")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Short-lived cache. The Room screen re-reads markets every 15s and re-renders
// more often than that; refetching a 120-point series on each pass would be
// wasteful and visually noisy for no new information.
const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; series: PriceSeries | null }>();

/**
 * Close prices for an asset, sized to the call window.
 *
 * Resolves to null rather than throwing when the feed is unavailable — a missing
 * chart should quietly leave the card as it was, not break the screen the user is
 * trying to trade on.
 */
export async function fetchPriceSeries(
  symbol: Symbol_,
  window: WindowLength | null,
): Promise<PriceSeries | null> {
  if (NETWORK !== "testnet") return null;

  const { timeframe, limit } = frameFor(window);
  const key = `${symbol}:${timeframe}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.series;

  try {
    const exchange = createReadOnlyExchange();
    const raw = (await withTimeout(
      exchange.fetchPriceOHLCV(symbol, timeframe, undefined, limit),
      12_000,
    )) as [number, number, number, number, number, number][];

    // [timestamp, open, high, low, close, vol] — vol is the oracle update count
    // for the bucket, not trade volume, so it's deliberately ignored.
    const CLOSE = 4;
    const points = (raw ?? [])
      .filter((c) => Array.isArray(c) && Number.isFinite(c[CLOSE]) && c[CLOSE] > 0)
      .map((c) => ({ t: Number(c[0]), close: Number(c[CLOSE]) }));

    if (points.length < 2) {
      cache.set(key, { at: Date.now(), series: null });
      return null;
    }

    const closes = points.map((p) => p.close);
    const first = closes[0];
    const last = closes[closes.length - 1];
    const series: PriceSeries = {
      symbol,
      timeframe,
      points,
      first,
      last,
      changePct: ((last - first) / first) * 100,
      min: Math.min(...closes),
      max: Math.max(...closes),
    };
    cache.set(key, { at: Date.now(), series });
    return series;
  } catch {
    // Cache the failure briefly too, so a broken feed doesn't get hammered on
    // every re-render.
    cache.set(key, { at: Date.now(), series: null });
    return null;
  }
}

/** Price formatted for display — BTC needs no decimals, ETH benefits from two. */
export function formatPrice(p: number): string {
  return p >= 1000
    ? p.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : p.toFixed(2);
}
