// Which leg a direction buys, and what a stake returns on it.
//
// A leaf module on purpose: it takes only the four book numbers, so it has no
// dependency on the markets SDK or on react-native, and can be reasoned about (and
// tested) without a bundler. `LiveMarketInfo` structurally satisfies `BookSide`,
// so callers pass a market directly.

import type { Direction } from "./types";

/** Top of book for both legs, each in its OWN price terms. */
export interface BookSide {
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
}

/**
 * The ask for the leg a direction buys — what that call actually costs.
 *
 * DOWN reads `noAsk`, NOT `1 − yesBid`. Those are different numbers: one is what
 * someone will sell you the NO leg for, the other reflects the YES bid across the
 * spread. `placeCall` executes against `noAsks`, so deriving it any other way for
 * display means quoting a price the user will not be charged — which is exactly
 * the bug this module was extracted to fix.
 */
export function askFor(book: BookSide, direction: Direction): number | undefined {
  return direction === "up" ? book.yesAsk : book.noAsk;
}

export interface Quote {
  /** Ask price paid per share, 0–1. Doubles as the implied chance. */
  price: number;
  /** Total returned if the call is right, stake included. */
  payout: number;
  /** Payout minus stake. */
  profit: number;
  /** Payout per unit staked, e.g. 4.9x. */
  multiple: number;
}

/**
 * What `stake` returns if the call is right.
 *
 * A winning outcome token redeems for exactly 1 unit of collateral, so buying at
 * `price` converts `stake` into `stake / price` shares — hence the payout. This is
 * why the two sides of a market quote so differently: a 0.20 ask pays about 5x, a
 * 0.82 ask about 1.22x. Cheaper side, less likely, bigger payout.
 *
 * Returns null when the leg has no ask, so an unfillable side is reported as
 * absent rather than as a free or infinite bet.
 */
export function quoteFor(book: BookSide, direction: Direction, stake: number): Quote | null {
  const price = askFor(book, direction);
  if (price === undefined || price <= 0) return null;
  const payout = stake / price;
  return { price, payout, profit: payout - stake, multiple: 1 / price };
}

/** An ask price rendered as an implied percentage chance. */
export function impliedChance(price?: number): string {
  return price === undefined ? "—" : `${Math.round(price * 100)}%`;
}

/** Payout per unit staked, e.g. "50.0x". */
export function payoutMultiple(price?: number): string {
  if (price === undefined || price <= 0) return "—";
  const m = 1 / price;
  return m >= 10 ? `${Math.round(m)}x` : `${m.toFixed(2)}x`;
}

export interface BookQuality {
  /** Both legs have a resting ask, so the two prices can be cross-checked. */
  twoSided: boolean;
  /** yesAsk + noAsk. A tight market sits a little over 1.00 (the spread). */
  askSum: number | null;
  /**
   * Whether an ask price can be read as a market's view of likelihood.
   *
   * Only when both legs are quoted AND they roughly complement each other. On a
   * one-sided book there is nothing to cross-check against, so a lone ask says
   * only "this is what one participant will sell at" — not "this is how likely it
   * is". Presenting 0.02 as a "2% chance" on a 15-minute coin flip is the visible
   * symptom of that, and it is materially misleading: at that price the payout is
   * ~50x on something far closer to even money.
   */
  chanceIsMeaningful: boolean;
}

/**
 * How much the book can be trusted to imply a probability.
 *
 * The venue's flagship series are frequently quoted on one side only — measured
 * repeatedly, and several other teams reported the same. See
 * chain-integration/scripts/inspect-book.ts, which prints every resting level.
 */
export function bookQuality(book: BookSide): BookQuality {
  const { yesAsk, noAsk } = book;
  const twoSided = yesAsk !== undefined && noAsk !== undefined;
  const askSum = twoSided ? yesAsk! + noAsk! : null;
  // A genuine two-sided market's asks sum to just over 1 — the excess is the
  // spread. Well outside that band means the quotes aren't complementary and
  // shouldn't be read as probabilities.
  const chanceIsMeaningful = askSum !== null && askSum >= 0.95 && askSum <= 1.25;
  return { twoSided, askSum, chanceIsMeaningful };
}
