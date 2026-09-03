// Shared Firestore document shapes for Streakr. Same as
// backend/functions/src/types.ts (kept identical when that package existed) —
// see app/src/lib/types.ts for the third copy the Expo app uses. Three
// independent deployables (Lambda, Expo/Metro), hand-synced rather than a
// shared workspace package, deliberately, to keep each deployable's bundle
// self-contained for a hackathon timeline.

export type CallStatus = "pending" | "won" | "lost" | "void";
export type Direction = "up" | "down";
export type Symbol_ = "BTC" | "ETH";
export type WindowLength = "15m" | "1h";

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
  createdAt: number;
}

export interface CallDoc {
  callId: string;
  roomId: string;
  uid: string;
  symbol: Symbol_;
  direction: Direction;
  window: WindowLength;
  stakeUsdso: number;
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
