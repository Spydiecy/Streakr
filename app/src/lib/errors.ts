// Turning chain / SDK / Firestore failures into something a person can act on.
//
// The raw strings that reach the UI otherwise are things like:
//
//   @somnia-chain/markets-sdk: placeBinaryOrder reverted:
//   ERC20InsufficientBalance(0x2ec8175015Bef5ad1C0BE1587C4A377bC083A2d8, 0, 5000000)
//
// which is precise and completely unreadable. Every branch below was hit for
// real during development, so this is a list of observed failures rather than a
// speculative taxonomy.

import { collateralDecimals } from "./networkConfig";

export interface FriendlyError {
  /** Short headline, sentence case, no trailing period. */
  title: string;
  /** One or two sentences saying what to do about it. */
  detail: string;
  /**
   * Machine tag, so a screen can offer a matching affordance (e.g. render a
   * "Mint test tUSDC" button for `insufficient-collateral`).
   */
  kind:
    | "insufficient-collateral"
    | "insufficient-gas"
    | "no-liquidity"
    | "stake-too-small"
    | "window-closed"
    | "rejected"
    | "blocked-by-extension"
    | "offline"
    | "timeout"
    | "unknown";
  /** The original message, kept for the expandable detail / logs. */
  raw: string;
}

const fmt = (raw: bigint | number, decimals = collateralDecimals()): string => {
  const n = Number(raw) / 10 ** decimals;
  // Sub-cent amounts shouldn't render as "0.00" when that's the whole point.
  return n > 0 && n < 0.01 ? n.toPrecision(2) : n.toFixed(2);
};

/** Pull the positional args out of a decoded Solidity custom error. */
function revertArgs(message: string, name: string): string[] | null {
  const m = message.match(new RegExp(`${name}\\s*\\(([^)]*)\\)`));
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function has(message: string, ...needles: string[]): boolean {
  const l = message.toLowerCase();
  return needles.some((n) => l.includes(n.toLowerCase()));
}

/**
 * Best-effort classification of anything thrown on the call path.
 *
 * Deliberately matches on message text as well as typed fields: the SDK
 * surfaces a decoded `ContractRevertError` in some paths, but a plain `Error`
 * with the revert name interpolated into the message in others (notably when
 * the revert arrives on the receipt rather than from a simulation), and the
 * user sees the same failure either way.
 */
export function friendlyError(e: unknown): FriendlyError {
  const err = e as { message?: string; errorName?: string; args?: readonly unknown[]; code?: unknown; name?: string };
  const raw = err?.message ?? String(e);
  const name = err?.errorName ?? "";
  const probe = `${name} ${raw}`;

  // ── Collateral ──────────────────────────────────────────────────────────
  // ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)
  if (has(probe, "ERC20InsufficientBalance", "not enough collateral", "insufficient collateral")) {
    const args = revertArgs(raw, "ERC20InsufficientBalance");
    let detail =
      "This wallet holds no tUSDC on Somnia testnet. Mint some test collateral, or switch to the demo wallet.";
    if (args && args.length >= 3) {
      const have = fmt(BigInt(args[1]));
      const need = fmt(BigInt(args[2]));
      detail = `This call needs ${need} tUSDC but the wallet holds ${have}. Mint some test collateral, or switch to the demo wallet.`;
    }
    return { title: "Not enough tUSDC", detail, kind: "insufficient-collateral", raw };
  }

  // ── Gas ─────────────────────────────────────────────────────────────────
  // "Missing or invalid parameters" (JSON-RPC -32602) is what Shannon returns
  // when the sender can't cover `gasLimit x gasPrice`. It reads like a client
  // bug and sent us looking at ABI encoding; it is really an underfunded wallet.
  // Matched on the SDK's wrapper text for the two writes that hit it first.
  if (
    has(probe, "insufficient funds for gas", "insufficient funds for intrinsic", "gas required exceeds") ||
    has(probe, "approve reverted: Missing or invalid parameters") ||
    has(probe, "faucet reverted: Missing or invalid parameters")
  ) {
    return {
      title: "No STT for gas",
      detail:
        "Signing needs a little Somnia testnet STT to pay gas. Fund this address from the Shannon faucet, or switch to the demo wallet.",
      kind: "insufficient-gas",
      raw,
    };
  }

  // ── Liquidity ───────────────────────────────────────────────────────────
  if (
    has(
      probe,
      "ImmediateOrCancelNoFill",
      "no resting",
      "did not fill",
      "no liquidity",
      "IOC",
    )
  ) {
    return {
      title: "Nobody on the other side",
      detail:
        "There's no resting order to trade against on this leg right now, so the call couldn't fill. Try the other direction, another window, or wait for a market maker to quote.",
      kind: "no-liquidity",
      raw,
    };
  }

  // ── Sizing ──────────────────────────────────────────────────────────────
  if (has(probe, "InvalidQuantity", "rounds to 0 shares", "out of (0,1) after tick snap")) {
    return {
      title: "Stake doesn't fit this market",
      detail:
        "The venue trades in fixed lot sizes and this stake rounds to zero shares at the current price. Pick a larger stake.",
      kind: "stake-too-small",
      raw,
    };
  }

  // ── Timing ──────────────────────────────────────────────────────────────
  if (has(probe, "window closes too soon", "MarketNotTrading", "window just locked", "expired")) {
    return {
      title: "Window already locked",
      detail: "This window closed before the call landed. The venue rolls a new one shortly — pick the next window.",
      kind: "window-closed",
      raw,
    };
  }

  // ── User cancelled in their wallet ──────────────────────────────────────
  if (
    err?.code === 4001 ||
    err?.name === "UserRejectedRequestError" ||
    has(probe, "user rejected", "user denied", "rejected the request", "request rejected")
  ) {
    return {
      title: "Signature cancelled",
      detail: "You dismissed the signing request, so nothing was submitted and nothing was spent.",
      kind: "rejected",
      raw,
    };
  }

  // ── Firestore blocked / offline ──────────────────────────────────────────
  // An ad/privacy blocker blocking firestore.googleapis.com is indistinguishable
  // from being offline as far as the SDK is concerned, but the fix is completely
  // different, so it's worth naming the likely cause.
  if (has(probe, "ERR_BLOCKED_BY_CLIENT", "blocked by client")) {
    return {
      title: "Blocked by a browser extension",
      detail:
        "An ad or privacy blocker is blocking requests to Google Firestore, so nothing can save. Disable it for this site and reload.",
      kind: "blocked-by-extension",
      raw,
    };
  }
  // Firestore specifically — worth naming, because a blocker is the usual cause
  // and the fix is "allow this site" rather than "check your wifi".
  if (has(probe, "could not reach cloud firestore", "client is offline", "firestore", "googleapis")) {
    return {
      title: "Can't reach the database",
      detail:
        "Requests to Firestore aren't getting through. That's usually an ad or privacy blocker — allow this site, or check your connection, then retry.",
      kind: "offline",
      raw,
    };
  }
  // Anything else network-shaped. Deliberately does NOT mention Firestore: the
  // same generic "network error" also comes from the chain indexer and the RPC,
  // and blaming the database for an indexer outage sends people the wrong way.
  if (has(probe, "network error", "failed to fetch", "err_connection", "err_name_not_resolved", "unavailable")) {
    return {
      title: "Network unreachable",
      detail: "Couldn't reach the network. Check your connection and retry.",
      kind: "offline",
      raw,
    };
  }

  if (has(probe, "timed out", "timeout")) {
    return {
      title: "That took too long",
      detail: "The network didn't answer in time. Retry — if it keeps happening, an extension may be blocking requests.",
      kind: "timeout",
      raw,
    };
  }

  // ── Fallback ────────────────────────────────────────────────────────────
  // Strip the SDK's own prefix so the sentence at least starts with the useful
  // part rather than the package name.
  const cleaned = raw
    .replace(/^@somnia-chain\/markets-sdk:\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
  return {
    title: "Call failed",
    detail: cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned || "Something went wrong.",
    kind: "unknown",
    raw,
  };
}

/** One-line form, for compact places like an inline field error. */
export function friendlyErrorLine(e: unknown): string {
  const f = friendlyError(e);
  return `${f.title} — ${f.detail}`;
}
