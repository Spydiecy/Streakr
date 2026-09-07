import React from "react";
import { View, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { colors, radius, shadow } from "../../theme";

export type CardTone = "surface" | "raised" | "paper" | "accentSoft";

interface Props {
  children: React.ReactNode;
  tone?: CardTone;
  style?: StyleProp<ViewStyle>;
  padded?: boolean | number;
  elevated?: boolean;
  bordered?: boolean;
}

const TONES: Record<CardTone, ViewStyle> = {
  surface: { backgroundColor: colors.surface, borderColor: colors.border },
  raised: { backgroundColor: colors.surfaceAlt, borderColor: colors.borderBright },
  paper: { backgroundColor: colors.paper, borderColor: "transparent" },
  accentSoft: { backgroundColor: colors.accentSoft, borderColor: "transparent" },
};

/** Base surface. Every panel of content on every screen sits in one of these. */
export function Card({ children, tone = "surface", style, padded = true, elevated, bordered = true }: Props) {
  const pad = padded === true ? 18 : padded === false ? 0 : padded;
  return (
    <View
      style={[
        styles.card,
        TONES[tone],
        bordered && styles.bordered,
        elevated && shadow.card,
        { padding: pad },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, overflow: "hidden" },
  bordered: { borderWidth: 1 },
});
