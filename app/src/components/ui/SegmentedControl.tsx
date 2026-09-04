import React from "react";
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { colors, radius, font } from "../../theme";

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** A pill-shaped segmented control with a sliding highlight — used for
 *  symbol (BTC/ETH) and window (15m/1h) selection on the Room screen. */
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const [widths, setWidths] = React.useState<number[]>(() => options.map(() => 0));
  const translateX = useSharedValue(0);
  const activeIndex = options.findIndex((o) => o.value === value);

  const onSegmentLayout = (index: number) => (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidths((prev) => {
      const next = [...prev];
      next[index] = w;
      return next;
    });
  };

  React.useEffect(() => {
    const offset = widths.slice(0, activeIndex).reduce((a, b) => a + b, 0);
    translateX.value = withTiming(offset, { duration: 220 });
  }, [activeIndex, widths]);

  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: widths[activeIndex] || 0,
  }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.highlight, highlightStyle]} />
      {options.map((opt, i) => (
        <Pressable
          key={opt.value}
          onLayout={onSegmentLayout(i)}
          onPress={() => {
            Haptics.selectionAsync();
            onChange(opt.value);
          }}
          style={styles.segment}
        >
          <Text style={[styles.label, value === opt.value && styles.labelActive]}>{opt.label}</Text>
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
    position: "relative",
    borderWidth: 1,
    borderColor: colors.border,
  },
  highlight: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  segment: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    zIndex: 1,
  },
  label: {
    ...font.bodySm,
    color: colors.textMuted,
    fontWeight: "700",
  },
  labelActive: {
    color: "#fff",
  },
});
