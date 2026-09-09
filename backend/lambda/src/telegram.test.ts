// buildTelegramMessage — the text that lands in a room's group chat.
//
// Worth testing because MarkdownV2 fails the whole send on a single unescaped
// reserved character, and the payload is full of them: display names are
// user-supplied, badge keys contain underscores, and every amount contains a dot.
// A silent 400 from Telegram would look like "notifications don't work".

import { describe, it, expect } from "vitest";
import { buildTelegramMessage } from "./telegram";
import type { SettlementNotifyPayload } from "./n8n";

const base: SettlementNotifyPayload = {
  roomId: "room1",
  uid: "u1",
  displayName: "Spy",
  symbol: "BTC",
  direction: "up",
  window: "15m",
  status: "won",
  payout: 7.15,
  currentStreak: 2,
  bestStreak: 3,
  xpAwarded: 20,
  newBadges: [],
  txHash: "0xabc123",
  positionId: "0xdef",
  settledAt: 1_700_000_000_000,
};

/** Every MarkdownV2 reserve must be backslash-escaped outside of markup. */
const RESERVED = "_*[]()~`>#+-=|{}.!";

function unescapedReserved(text: string): string[] {
  const bad: string[] = [];
  // Strip the intentional markup we generate: *bold*, [label](url) and escapes.
  const stripped = text
    .replace(/\\./g, "")
    .replace(/\*[^*]*\*/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "");
  for (const ch of stripped) if (RESERVED.includes(ch)) bad.push(ch);
  return bad;
}

describe("buildTelegramMessage", () => {
  it("leads with who did what, since this lands in a group chat", () => {
    const t = buildTelegramMessage(base);
    expect(t.split("\n")[0]).toContain("Spy");
    expect(t.split("\n")[0]).toContain("BTC UP");
  });

  it("states the real return on a win", () => {
    // The dot is a MarkdownV2 reserve, so the amount arrives escaped — that's
    // correct, and asserting the raw form would be asserting a bug.
    expect(buildTelegramMessage(base)).toContain("7\\.15 tUSDC");
  });

  it("omits the amount when the payout is unknown rather than inventing one", () => {
    const t = buildTelegramMessage({ ...base, payout: null });
    expect(t).not.toContain("tUSDC");
    expect(t).toContain("won");
  });

  it("names the capped downside on a loss", () => {
    const t = buildTelegramMessage({ ...base, status: "lost", payout: 0, currentStreak: 0 });
    expect(t).toContain("lost");
    expect(t).toContain("Streak reset to 0");
  });

  it("marks a personal best only when the streak actually equals it", () => {
    const pb = buildTelegramMessage({ ...base, currentStreak: 4, bestStreak: 4 });
    const notPb = buildTelegramMessage({ ...base, currentStreak: 2, bestStreak: 5 });
    expect(pb).toContain("personal best");
    expect(notPb).not.toContain("personal best");
  });

  it("escapes reserved characters in a hostile display name", () => {
    const t = buildTelegramMessage({ ...base, displayName: "a_b*c[d].e!" });
    expect(unescapedReserved(t)).toEqual([]);
  });

  it("escapes badge keys, which contain underscores", () => {
    const t = buildTelegramMessage({ ...base, newBadges: ["room_champion", "first_call"] });
    expect(t).toContain("room\\_champion");
    expect(unescapedReserved(t)).toEqual([]);
  });

  it("escapes every amount, since decimals contain a reserved dot", () => {
    const t = buildTelegramMessage({ ...base, payout: 1234.56 });
    expect(t).toContain("1234\\.56");
    expect(unescapedReserved(t)).toEqual([]);
  });

  it("links the transaction so the result is verifiable, not asserted", () => {
    expect(buildTelegramMessage(base)).toContain("shannon-explorer.somnia.network/tx/0xabc123");
  });

  it("handles a void without calling it a loss", () => {
    const t = buildTelegramMessage({ ...base, status: "void", payout: null });
    expect(t).toContain("voided");
    expect(t).not.toContain("lost");
  });
});
