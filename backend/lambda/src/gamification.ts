// Streak / XP / badge rules. Pure functions, unchanged from the Cloud
// Functions version — no AWS/Firebase-specific code here at all.

import { BADGES, type BadgeKey, type CallStatus } from "./types";

export const XP_WIN = 20;
export const XP_LOSS = 2;
export const XP_VOID = 0;

export interface StreakUpdateInput {
  status: CallStatus;
  currentStreak: number;
  bestStreak: number;
  existingBadges: string[];
  isFirstCallEver: boolean;
}

export interface StreakUpdateResult {
  currentStreak: number;
  bestStreak: number;
  xpAwarded: number;
  newBadges: BadgeKey[];
}

export function applyStreakUpdate(input: StreakUpdateInput): StreakUpdateResult {
  let { currentStreak, bestStreak } = input;
  let xpAwarded = 0;
  const newBadges: BadgeKey[] = [];

  if (input.status === "won") {
    currentStreak += 1;
    xpAwarded = XP_WIN;
  } else if (input.status === "lost") {
    currentStreak = 0;
    xpAwarded = XP_LOSS;
  } else {
    xpAwarded = XP_VOID;
  }

  if (currentStreak > bestStreak) bestStreak = currentStreak;

  if (input.isFirstCallEver && !input.existingBadges.includes(BADGES.FIRST_CALL)) {
    newBadges.push(BADGES.FIRST_CALL);
  }
  const streakBadgeThresholds: [number, BadgeKey][] = [
    [3, BADGES.STREAK_3],
    [5, BADGES.STREAK_5],
    [10, BADGES.STREAK_10],
  ];
  for (const [threshold, badge] of streakBadgeThresholds) {
    if (currentStreak >= threshold && !input.existingBadges.includes(badge)) {
      newBadges.push(badge);
    }
  }

  return { currentStreak, bestStreak, xpAwarded, newBadges };
}

export function shouldAwardRoomChampion(existingBadges: string[], isNumberOneInRoom: boolean): boolean {
  return isNumberOneInRoom && !existingBadges.includes(BADGES.ROOM_CHAMPION);
}
