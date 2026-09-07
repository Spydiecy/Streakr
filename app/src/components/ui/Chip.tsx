import React from "react";
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { colors, radius, font } from "../../theme";

export type ChipTone = "accent" | "up" | "down" | "gold" | "neutral" | "coral" | "onPaper";

interface Props {
  label: string;
  tone?: ChipTone;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  accent: { bg: colors.accentWash, fg: colors.accent },
  up: { bg: colors.upWash, fg: colors.up },
  down: { bg: colors.downWash, fg: colors.down },
  gold: { bg: colors.goldWash, fg: colors.gold },
  neutral: { bg: colors.neutralWash, fg: colors.textMuted },
  coral: { bg: colors.coral, fg: "#fff" },
  onPaper: { bg: "rgba(10,11,12,0.06)", fg: colors.paperMuted },
};

export function Chip({ label, tone = "neutral", icon, style }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]}>
      {icon ? <Text style={[styles.icon, { color: t.fg }]}>{icon}</Text> : null}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  text: { ...font.label, textTransform: "uppercase" },
  icon: { fontSize: 10 },
});
