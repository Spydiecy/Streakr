// Mirrors backend/functions/src/types.ts. Kept as a separate copy rather than
// a shared package: the app and Cloud Functions are two independent
// deployables (Metro vs Node), and a monorepo-wide shared-types package felt
// like overhead for a hackathon timeline. If this app grows past the demo,
// hoist these into a small @streakr/shared-types workspace package instead
// of hand-syncing the two copies.

export type CallStatus = "pending" | "won" | "lost" | "void";
export type Direction = "up" | "down";
export type Symbol_ = "BTC" | "ETH";

/**
 * Window cadences Streakr can label.
 *
 * Deliberately wider than the 15m/1h the product concept describes: the venue
 * decides which series are live at any moment and rotates them. Measured on
 * Shannon testnet — at one point the venue ran 1h + 4h + 1d, and a few hours
 * later only 4h + 1d with no 1h at all. Hard-coding 15m/1h made the app look
 * broken whenever neither happened to be running, so the UI now offers
 * whichever cadences are actually live (see eventContracts.listLiveMarkets).
 */
export type WindowLength = "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface UserDoc {
  uid: string;
  walletAddress: string;
  displayName: string;
  avatarUrl?: string;
  xp: number;
  currentStreak: number;
  bestStreak: number;
  badges: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RoomDoc {
  roomId: string;
  name: string;
  isPublic: boolean;
  memberUids: string[];
  createdBy: string;
  activeMarket?: {
    symbol: Symbol_;
    window: WindowLength;
    positionMarketId?: string;
  };
  /**
   * Short code a member types as `/link CODE` in a Telegram group to point this
   * room's notifications at that chat. Generated client-side at creation — it's
   * a claim ticket, not a secret, and claiming it only redirects a room's own
   * notifications.
   */
  linkCode?: string;
  /**
   * Telegram chat this room notifies, once linked. Written only by the webhook
   * Lambda via the admin SDK — firestore.rules restricts client updates to
   * name/activeMarket/isPublic, so a client cannot point another room's
   * notifications at a chat it controls.
   */
  telegramChatId?: string;
  createdAt: number;
}

export interface CallDoc {
  callId: string;
  roomId: string;
  uid: string;
  symbol: Symbol_;
  direction: Direction;
  window: WindowLength;
  /** Collateral actually spent, in tUSDC. */
  stakeUsdso: number;
  /**
   * Outcome tokens bought — the quantity that redeems at settlement.
   *
   * The payout is derived from this, not from the stake: a winning share redeems
   * for ~1 collateral, so `shares × (1 − fee)` is the return. Optional only
   * because calls recorded before this field existed don't carry it, and those
   * settle without a payout figure rather than a wrong one.
   */
  shares?: number;
  /** Price paid per share, 0–1. Also the implied chance at the time of the call. */
  entryPrice?: number;
  txHash: string;
  positionId: string;
  status: CallStatus;
  payout?: number;
  createdAt: number;
  settledAt?: number;
  streakAfter?: number;
  xpAwarded?: number;
  badgesAwarded?: string[];
}

export interface LeaderboardEntryDoc {
  uid: string;
  displayName: string;
  currentStreak: number;
  bestStreak: number;
  xp: number;
  updatedAt: number;
}

export interface ResultCardDoc {
  cardId: string;
  callId: string;
  uid: string;
  displayName: string;
  symbol: Symbol_;
  direction: Direction;
  status: CallStatus;
  streakAfter: number;
  payout?: number;
  imageUrl?: string;
  createdAt: number;
}

export const BADGES = {
  FIRST_CALL: "first_call",
  STREAK_3: "streak_3",
  STREAK_5: "streak_5",
  STREAK_10: "streak_10",
  ROOM_CHAMPION: "room_champion",
} as const;

export type BadgeKey = (typeof BADGES)[keyof typeof BADGES];

export const BADGE_META: Record<BadgeKey, { label: string; icon: string }> = {
  first_call: { label: "First Call", icon: "🎯" },
  streak_3: { label: "3-Streak", icon: "🔥" },
  streak_5: { label: "5-Streak", icon: "🔥🔥" },
  streak_10: { label: "10-Streak", icon: "🔥🔥🔥" },
  room_champion: { label: "Room Champion", icon: "👑" },
};
