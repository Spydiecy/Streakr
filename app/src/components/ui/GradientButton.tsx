import React from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle, StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { colors, radius, font, shadow } from "../../theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  label: string;
  onPress: () => void;
  colors?: readonly [string, string, ...string[]];
  disabled?: boolean;
  loading?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  glow?: string;
  icon?: React.ReactNode;
}

/** The app's primary call-to-action button: gradient fill, spring press feedback, haptic tap. */
export function GradientButton({
  label,
  onPress,
  colors: gradientColors = colors.gradientPrimary,
  disabled,
  loading,
  size = "md",
  style,
  glow,
  icon,
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 18, stiffness: 300 });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 14, stiffness: 250 });
  };
  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[animatedStyle, style, glow ? shadow.glow(glow) : undefined]}
    >
      <LinearGradient
        colors={disabled ? ["#3a3f4b", "#2b2f38"] : gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, size === "lg" && styles.buttonLg, disabled && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, size === "lg" && styles.labelLg]}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.lg,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonLg: {
    paddingVertical: 20,
    borderRadius: radius.xl,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  labelLg: {
    fontSize: 18,
  },
});
