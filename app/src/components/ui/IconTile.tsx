import React from "react";
import { Text, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius } from "../../theme";

interface Props {
  glyph: string;
  tone?: "accent" | "down" | "gold" | "ink" | "paper";
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const TONES = {
  accent: colors.gradAccent,
  down: colors.gradDown,
  gold: colors.gradGold,
  ink: colors.gradInk,
  paper: colors.gradPaper,
} as const;

/** Small rounded-square icon tile with a bright gradient fill — the little
 *  colourful glyph badges from the reference layout. */
export function IconTile({ glyph, tone = "accent", size = 44, style }: Props) {
  return (
    <LinearGradient
      colors={TONES[tone]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.32 },
        style,
      ]}
    >
      <Text style={{ fontSize: size * 0.44 }}>{glyph}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
});
