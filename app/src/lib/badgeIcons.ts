import type { IconName } from "../components/ui/Icon";
import type { BadgeKey } from "./types";

/**
 * One distinct icon per badge.
 *
 * The badge set is a progression (first call → 3 → 5 → 10 → room champion),
 * and the original emoji labelling repeated the same flame 1–3 times, which
 * read as a rendering glitch rather than a tier. Distinct glyphs make the
 * progression legible at a glance.
 */
export const BADGE_ICONS: Record<BadgeKey, IconName> = {
  first_call: "target",
  streak_3: "streak",
  streak_5: "bolt",
  streak_10: "medal",
  room_champion: "crown",
};
