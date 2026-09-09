import React from "react";
import { View, Text, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { colors, radius, font } from "../../theme";
import { Icon, type IconName } from "./Icon";

export type ChipTone = "accent" | "up" | "down" | "gold" | "neutral" | "coral" | "onPaper";

interface Props {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
  /**
   * Cross-axis placement. Left unset the chip inherits the parent's
   * `alignItems`, which is what you want almost everywhere: centred inside a
   * centred column, vertically centred inside a row.
   *
   * This used to default to `"start"`, which emitted `alignSelf: "flex-start"`
   * unconditionally and so *overrode* the parent on every call site — the pill
   * sat left of centre in the Profile card and top-aligned in each row. Only
   * pass `"start"` when the parent is a stretch column and the chip would
   * otherwise span the full width.
   */
  align?: "start" | "center" | "stretch";
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

const ALIGN: Record<NonNullable<Props["align"]>, ViewStyle> = {
  start: { alignSelf: "flex-start" },
  center: { alignSelf: "center" },
  stretch: { alignSelf: "stretch" },
};

export function Chip({ label, tone = "neutral", icon, align, style }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, align ? ALIGN[align] : null, style]}>
      {icon ? (
        // The glyph gets its own fixed square box. Ionicons renders as text, so
        // left inline its line box drifts against the label's baseline and the
        // icon reads a pixel or two low; a square with centred content gives
        // flexbox a deterministic box to align instead.
        <View style={styles.iconBox}>
          <Icon name={icon} size={11} color={t.fg} />
        </View>
      ) : null}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const ROW_H = 14;

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  iconBox: { width: ROW_H, height: ROW_H, alignItems: "center", justifyContent: "center" },
  // Matched to the icon box so both children contribute the same row height and
  // neither can nudge the other off the chip's centre line.
  text: { ...font.label, textTransform: "uppercase", lineHeight: ROW_H },
});
