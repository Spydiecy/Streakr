import React from "react";
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { colors, radius, font } from "../../theme";
import { Icon, type IconName } from "./Icon";

export type ChipTone = "accent" | "up" | "down" | "gold" | "neutral" | "coral" | "onPaper";

interface Props {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
  /** Chips default to hugging their content on the left; center when standalone. */
  align?: "start" | "center";
  style?: StyleProp<ViewStyle>;
}

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  accent: { bg: colors.accentWash, fg: colors.accent },
  up: { bg: colors.upWash, fg: colors.up },
  down: { bg: colors.downWash, fg: colors.down },
  gold: { bg: colors.goldWash, fg: colors.gold },
  neutral: { bg: colors.neutralWash, fg: colors.textMuted },
  coral: { bg: "rgba(255,122,69,0.16)", fg: colors.coral },
  onPaper: { bg: "rgba(10,11,12,0.06)", fg: colors.paperMuted },
};

export function Chip({ label, tone = "neutral", icon, align = "start", style }: Props) {
  const t = TONES[tone];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: t.bg },
        align === "center" ? styles.center : styles.start,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={11} color={t.fg} style={styles.icon} /> : null}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    // Ionicons glyphs carry their own line box, which sits a pixel or two
    // below the text baseline and made the icon look off-centre in the pill.
    // A fixed row height plus centred alignment pins both to the same axis.
    minHeight: 24,
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  start: { alignSelf: "flex-start" },
  center: { alignSelf: "center" },
  text: { ...font.label, textTransform: "uppercase", lineHeight: 14 },
  // Zero out the glyph's intrinsic line box so it centres on the row axis
  // rather than on a text baseline.
  icon: { lineHeight: 11, marginTop: 0 },
});
