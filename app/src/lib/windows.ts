// Cadence labelling: turning a raw on-chain interval into a window chip.
//
// A leaf module by necessity. This logic belongs with the market reads, but
// `eventContracts.ts` constructs the markets SDK, which pulls
// react-native-get-random-values and Flow-typed react-native sources — enough to
// break the tsx transform the unit tests run under. Since it lives here it can
// actually be tested, which matters: every bug this file has had was silent.
//
// Same reasoning as quote.ts, callOutcome.ts and networkConfig.ts.
import type { WindowLength } from "./types";

export const WINDOW_SECONDS: Record<WindowLength, number> = {
  // The venue runs 5m series, and more of them than any other cadence. Without a
  // rung here, 300s snapped to the 15m rung, missed the tolerance, and came back
  // null — and a null window is dropped, so the fastest-settling window the venue
  // offers was invisible while being perfectly tradable.
  "5m": 5 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
};

/** Display order for whichever cadences happen to be live. */
export const WINDOW_ORDER: WindowLength[] = ["5m", "15m", "1h", "4h", "1d", "1w"];

/**
 * Map a raw `intervalSec` onto one of Streakr's window labels.
 *
 * Snaps to the NEAREST cadence rung rather than requiring an exact match. The
 * indexer derives a series' interval as `expiry − tradingStart`, and trading
 * routinely opens a second or two late, so a 1d series is indexed as 86398 or
 * 86399 as often as 86400 (the SDK documents ±CADENCE_TOLERANCE_SEC on its own
 * `intervalSec` filter for exactly this reason).
 *
 * An exact `===` here silently returned null for those off-by-a-second rolls. A
 * null window is dropped by `availableWindows`, which is what made the 4h/1d
 * chips vanish and reappear at random — the chip set was really tracking whether
 * the venue happened to open that window on the exact second.
 *
 * Tolerance is the LARGER of 10s and 1% of the rung: 10s covers the
 * open-a-moment-late drift on short cadences, and 1% scales for long ones (864s
 * on 1d). It stays well clear of merging neighbours, since the closest pair
 * (5m/15m) sits 600s apart and the widest tolerance among them is 9s.
 *
 * Returns null for a cadence with no label rather than guessing, so an unknown
 * series is dropped visibly in one place instead of being mislabelled as a
 * window that settles at a different time.
 */
export function labelWindow(intervalSec: number): WindowLength | null {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return null;

  let best: { label: WindowLength; secs: number; delta: number } | null = null;
  for (const [label, secs] of Object.entries(WINDOW_SECONDS) as [WindowLength, number][]) {
    const delta = Math.abs(secs - intervalSec);
    if (!best || delta < best.delta) best = { label, secs, delta };
  }
  if (!best) return null;

  const tolerance = Math.max(10, best.secs * 0.01);
  return best.delta <= tolerance ? best.label : null;
}

/**
 * The cadences present in a set of live markets for one asset, in display order.
 *
 * Read from what's actually tradable rather than assumed, because the venue
 * rotates which series it runs. Returns [] when nothing is live for the asset.
 */
export function availableWindows(
  markets: { symbol: string; window: WindowLength | null }[],
  symbol: string,
): WindowLength[] {
  const live = new Set(
    markets.filter((m) => m.symbol === symbol && m.window !== null).map((m) => m.window as WindowLength),
  );
  return WINDOW_ORDER.filter((w) => live.has(w));
}
