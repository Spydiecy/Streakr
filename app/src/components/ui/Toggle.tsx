import React from "react";
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { colors, radius, font } from "../../theme";

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
}

/** Inner-pill toggle with a sliding lime highlight (the Start / My Recent
 *  pattern from the reference). Used for symbol and window selection. */
export function Toggle<T extends string>({ options, value, onChange, compact }: Props<T>) {
  const [widths, setWidths] = React.useState<number[]>(() => options.map(() => 0));
  const x = useSharedValue(0);
  const active = options.findIndex((o) => o.value === value);

  const onSegLayout = (i: number) => (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidths((prev) => {
      if (prev[i] === w) return prev;
      const next = [...prev];
      next[i] = w;
      return next;
    });
  };

  React.useEffect(() => {
    x.value = withTiming(widths.slice(0, active).reduce((a, b) => a + b, 0), { duration: 200 });
  }, [active, widths]);

  const highlight = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: widths[active] || 0,
  }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.highlight, highlight]} />
      {options.map((o, i) => (
        <Pressable
          key={o.value}
          onLayout={onSegLayout(i)}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(o.value);
          }}
          style={[styles.seg, compact && styles.segCompact]}
        >
          <Text style={[styles.label, value === o.value && styles.labelActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  highlight: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  seg: { paddingVertical: 9, paddingHorizontal: 18, zIndex: 1 },
  segCompact: { paddingHorizontal: 13, paddingVertical: 7 },
  label: { ...font.bodySm, color: colors.textMuted, fontWeight: "800" },
  labelActive: { color: colors.onAccent },
});
