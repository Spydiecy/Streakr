import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { colors, radius, shadow } from "../../theme";

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  noPadding?: boolean;
}

/** The app's base surface — every "panel" of content sits in one of these. */
export function Card({ children, style, elevated, noPadding }: Props) {
  return (
    <View
      style={[
        styles.card,
        elevated && shadow.card,
        !noPadding && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  padded: {
    padding: 20,
  },
});
