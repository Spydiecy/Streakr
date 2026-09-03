import { describe, it, expect } from "vitest";
import { applyStreakUpdate, shouldAwardRoomChampion, XP_WIN, XP_LOSS, XP_VOID } from "./gamification";
import { BADGES } from "./types";

describe("applyStreakUpdate", () => {
  it("increments streak and awards XP on a win", () => {
    const r = applyStreakUpdate({ status: "won", currentStreak: 2, bestStreak: 4, existingBadges: [], isFirstCallEver: false });
    expect(r.currentStreak).toBe(3);
    expect(r.bestStreak).toBe(4);
    expect(r.xpAwarded).toBe(XP_WIN);
  });

  it("resets streak to 0 on a loss", () => {
    const r = applyStreakUpdate({ status: "lost", currentStreak: 5, bestStreak: 5, existingBadges: [], isFirstCallEver: false });
    expect(r.currentStreak).toBe(0);
    expect(r.bestStreak).toBe(5);
    expect(r.xpAwarded).toBe(XP_LOSS);
  });

  it("leaves streak unaffected on a void", () => {
    const r = applyStreakUpdate({ status: "void", currentStreak: 3, bestStreak: 5, existingBadges: [], isFirstCallEver: false });
    expect(r.currentStreak).toBe(3);
    expect(r.bestStreak).toBe(5);
    expect(r.xpAwarded).toBe(XP_VOID);
  });

  it("raises bestStreak when currentStreak surpasses it", () => {
    const r = applyStreakUpdate({ status: "won", currentStreak: 4, bestStreak: 4, existingBadges: [], isFirstCallEver: false });
    expect(r.bestStreak).toBe(5);
  });

  it("awards first_call badge exactly once", () => {
    const r1 = applyStreakUpdate({ status: "lost", currentStreak: 0, bestStreak: 0, existingBadges: [], isFirstCallEver: true });
    expect(r1.newBadges).toContain(BADGES.FIRST_CALL);
    const r2 = applyStreakUpdate({ status: "lost", currentStreak: 0, bestStreak: 0, existingBadges: [BADGES.FIRST_CALL], isFirstCallEver: false });
    expect(r2.newBadges).not.toContain(BADGES.FIRST_CALL);
  });

  it("awards streak badges at 3, 5, and 10, without re-awarding", () => {
    const r3 = applyStreakUpdate({ status: "won", currentStreak: 2, bestStreak: 2, existingBadges: [], isFirstCallEver: false });
    expect(r3.currentStreak).toBe(3);
    expect(r3.newBadges).toContain(BADGES.STREAK_3);

    const r5 = applyStreakUpdate({ status: "won", currentStreak: 4, bestStreak: 4, existingBadges: [BADGES.FIRST_CALL, BADGES.STREAK_3], isFirstCallEver: false });
    expect(r5.currentStreak).toBe(5);
    expect(r5.newBadges).toContain(BADGES.STREAK_5);
    expect(r5.newBadges).not.toContain(BADGES.STREAK_3);

    const r10 = applyStreakUpdate({ status: "won", currentStreak: 9, bestStreak: 9, existingBadges: [BADGES.FIRST_CALL, BADGES.STREAK_3, BADGES.STREAK_5], isFirstCallEver: false });
    expect(r10.currentStreak).toBe(10);
    expect(r10.newBadges).toEqual([BADGES.STREAK_10]);
  });

  it("does not award a streak badge on a loss even from a high prior streak", () => {
    const r = applyStreakUpdate({ status: "lost", currentStreak: 9, bestStreak: 9, existingBadges: [], isFirstCallEver: false });
    expect(r.currentStreak).toBe(0);
    expect(r.newBadges).toEqual([]);
  });
});

describe("shouldAwardRoomChampion", () => {
  it("awards when #1 and not already held", () => {
    expect(shouldAwardRoomChampion([], true)).toBe(true);
  });
  it("does not re-award", () => {
    expect(shouldAwardRoomChampion([BADGES.ROOM_CHAMPION], true)).toBe(false);
  });
  it("does not award when not #1", () => {
    expect(shouldAwardRoomChampion([], false)).toBe(false);
  });
});
