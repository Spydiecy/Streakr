import React from "react";
import { Ionicons } from "@expo/vector-icons";
import type { OpaqueColorValue, StyleProp, TextStyle } from "react-native";
import { colors } from "../../theme";

/**
 * The app's icon vocabulary, as a fixed set of semantic names.
 *
 * Deliberately a closed mapping rather than passing raw Ionicons names around:
 * it keeps one glyph per concept across every screen, and swapping the
 * underlying icon set later is a change in this one file.
 *
 * Emoji were used here originally and read as filler — real icons sit on the
 * baseline properly, take a colour, and scale crisply.
 */
export type IconName =
  | "streak"
  | "trophy"
  | "profile"
  | "bolt"
  | "shield"
  | "target"
  | "star"
  | "wallet"
  | "up"
  | "down"
  | "add"
  | "close"
  | "back"
  | "forward"
  | "copy"
  | "share"
  | "sparkle"
  | "clock"
  | "lock"
  | "globe"
  | "medal"
  | "crown"
  | "check"
  | "moon"
  | "live"
  | "trash"
  | "refresh";

const GLYPHS: Record<IconName, React.ComponentProps<typeof Ionicons>["name"]> = {
  streak: "flame",
  trophy: "trophy",
  profile: "person",
  bolt: "flash",
  shield: "shield-checkmark",
  target: "locate",
  star: "star",
  wallet: "wallet",
  up: "caret-up",
  down: "caret-down",
  add: "add",
  close: "close",
  back: "chevron-back",
  forward: "chevron-forward",
  copy: "copy-outline",
  share: "share-outline",
  sparkle: "sparkles",
  clock: "time-outline",
  lock: "lock-closed",
  globe: "globe-outline",
  medal: "medal",
  crown: "ribbon",
  check: "checkmark-circle",
  moon: "moon-outline",
  live: "radio-button-on",
  trash: "trash-outline",
  refresh: "refresh",
};

interface Props {
  name: IconName;
  size?: number;
  color?: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 18, color = colors.text, style }: Props) {
  return <Ionicons name={GLYPHS[name]} size={size} color={color} style={style} />;
}
