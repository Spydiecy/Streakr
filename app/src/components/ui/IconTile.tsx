import React from "react";
import { Text, StyleSheet, View, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "../../theme";
import { Icon, type IconName } from "./Icon";

interface Props {
  /** Either a semantic icon, or a short string (used for room initials). */
  icon?: IconName;
  letter?: string;
  tone?: "accent" | "down" | "gold" | "ink" | "paper";
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const FILLS = {
  accent: colors.gradAccent,
  down: colors.gradDown,
  gold: colors.gradGold,
  ink: colors.gradInk,
  paper: colors.gradPaper,
} as const;

const INKS = {
  accent: colors.onAccent,
  down: "#fff",
  gold: "#2a1f00",
  ink: colors.text,
  paper: colors.paperInk,
} as const;

/** Rounded-square tile with a bright fill, holding either an icon or an initial. */
export function IconTile({ icon, letter, tone = "accent", size = 44, style }: Props) {
  const ink = INKS[tone];
  return (
    <LinearGradient
      colors={FILLS[tone]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3 }, style]}
    >
      {icon ? (
        <Icon name={icon} size={size * 0.46} color={ink} />
      ) : (
        <Text style={{ fontSize: size * 0.4, fontWeight: "900", color: ink }}>{letter ?? ""}</Text>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
});
