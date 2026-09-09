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

export function callOutcomeLine(c: Pick<CallDoc, "status" | "direction" | "stakeUsdso" | "payout">): string {
  const called = c.direction === "up" ? "Up" : "Down";
  const opposite = c.direction === "up" ? "Down" : "Up";

  switch (c.status) {
    case "won":
      // payout is the gross return on the winning shares, not profit.
      return `Closed ${called} — you called it${
        c.payout !== undefined ? ` · +${c.payout.toFixed(2)} tUSDC` : ""
      }`;
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
