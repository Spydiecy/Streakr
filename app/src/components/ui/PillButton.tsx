import React from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, View, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { colors, radius, shadow } from "../../theme";
import { Icon, type IconName } from "./Icon";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PillTone = "accent" | "paper" | "ink" | "down";

interface Props {
  label: string;
  onPress: () => void;
  tone?: PillTone;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TONES: Record<PillTone, { fill: readonly [string, string]; ink: string; glow?: string }> = {
  accent: { fill: colors.gradAccent, ink: colors.onAccent, glow: colors.accentGlow },
  paper: { fill: colors.gradPaper, ink: colors.paperInk },
  ink: { fill: colors.gradInk, ink: colors.text },
  down: { fill: colors.gradDown, ink: "#fff", glow: colors.downGlow },
};

/**
 * The app's signature CTA: a fully-rounded pill with a bright fill and dark
 * ink, an optional leading icon, spring press feedback and a haptic tap.
 */
export function PillButton({
  label,
  onPress,
  tone = "accent",
  size = "md",
  icon,
  disabled,
  loading,
  full,
  style,
}: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const t = TONES[tone];

  return (
    <AnimatedPressable
      onPressIn={() => (scale.value = withSpring(0.955, { damping: 18, stiffness: 320 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 13, stiffness: 260 }))}
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled || loading}
      style={[animated, full && { alignSelf: "stretch" }, !disabled && t.glow ? shadow.glow(t.glow) : null, style]}
    >
      <LinearGradient
        colors={disabled ? ["#2a2c31", "#202226"] : t.fill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.base, styles[size], disabled && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator color={disabled ? colors.textFaint : t.ink} size="small" />
        ) : (
          <View style={styles.row}>
            {icon ? (
              <Icon
                name={icon}
                size={size === "lg" ? 19 : size === "md" ? 17 : 15}
                color={disabled ? colors.textFaint : t.ink}
              />
            ) : null}
            <Text style={[styles.label, sizeLabel[size], { color: disabled ? colors.textFaint : t.ink }]}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  sm: { paddingVertical: 9, paddingHorizontal: 16 },
  md: { paddingVertical: 14, paddingHorizontal: 24 },
  lg: { paddingVertical: 18, paddingHorizontal: 28 },
  disabled: { opacity: 0.65 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  label: { fontWeight: "800", letterSpacing: -0.2 },
  icon: {},
});

const sizeLabel = StyleSheet.create({
  sm: { fontSize: 13 },
  md: { fontSize: 15 },
  lg: { fontSize: 17 },
});

const sizeIcon = StyleSheet.create({
  sm: { fontSize: 13 },
  md: { fontSize: 15 },
  lg: { fontSize: 17 },
});
