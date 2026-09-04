import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radius, font } from "../../theme";

interface Props {
  label: string;
  tone?: "primary" | "up" | "down" | "gold" | "neutral";
  size?: "sm" | "md";
}

const TONES: Record<string, { bg: string; fg: string }> = {
  primary: { bg: "rgba(124,92,255,0.16)", fg: colors.primary },
  up: { bg: colors.upDim, fg: colors.up },
  down: { bg: colors.downDim, fg: colors.down },
  gold: { bg: "rgba(255,200,87,0.14)", fg: colors.gold },
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
};

export function Badge({ label, tone = "neutral", size = "md" }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }, size === "sm" && styles.pillSm]}>
      <Text style={[styles.text, { color: t.fg }, size === "sm" && styles.textSm]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  pillSm: {
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  text: {
    ...font.caption,
    textTransform: "uppercase",
  },
  textSm: {
    fontSize: 10,
  },
});
