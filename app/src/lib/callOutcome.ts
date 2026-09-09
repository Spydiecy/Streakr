// Turning a settled call into a sentence that says what actually happened.
//
// A WON / LOST badge alone tells you the result but not the reason, which makes
// the history feel like a scoreboard rather than a record you can check against
// the market.
//
// The winning leg is deliberately NOT stored on the call document — settlement
// compares the called leg against the resolved one, so the outcome is already
// implied: `won` means the window closed the way it was called, `lost` means it
// closed the other way. Deriving it here keeps Firestore from carrying a second,
// staleable copy of on-chain state.

import type { CallDoc } from "./types";

export function callOutcomeLine(
  c: Pick<CallDoc, "status" | "direction" | "stakeUsdso" | "payout">,
): string {
  const called = c.direction === "up" ? "Up" : "Down";
  const opposite = c.direction === "up" ? "Down" : "Up";

  switch (c.status) {
    case "won": {
      // `payout` is the GROSS return — the winning shares redeeming at ~1
      // collateral each — so profit is payout minus stake. Showing the gross
      // figure next to a "+" read as profit and understated the win, so both are
      // stated explicitly.
      //
      // The amount is omitted entirely when unknown rather than falling back to
      // the stake. That fallback is what produced "+5.00" on a $5 call that
      // actually returned ~$21: settlement was valuing the position from the
      // stake instead of the share count, so every win looked like break-even.
      if (c.payout === undefined) return `Closed ${called} — you called it`;
      const profit = c.payout - c.stakeUsdso;
      return `Closed ${called} — won ${c.payout.toFixed(2)} tUSDC (+${profit.toFixed(2)} profit)`;
    }
    case "lost":
      return `Closed ${opposite} — you called ${called} · −${c.stakeUsdso.toFixed(2)} tUSDC`;
    case "void":
      // A voided market refunds both sides at 0.5, so it is not a loss and the
      // settlement logic leaves the streak alone.
      return "Market voided — stake refunded, streak untouched";
    default:
      return "Waiting for the window to settle on-chain";
  }
}

/** Compact result for a dense row: "+16.10" / "−5.00" / null while pending. */
export function callResultAmount(
  c: Pick<CallDoc, "status" | "stakeUsdso" | "payout">,
): string | null {
  switch (c.status) {
    case "won":
      return c.payout === undefined ? null : `+${(c.payout - c.stakeUsdso).toFixed(2)}`;
    case "lost":
      return `−${c.stakeUsdso.toFixed(2)}`;
    case "void":
      return "refunded";
    default:
      return null;
  }
}
