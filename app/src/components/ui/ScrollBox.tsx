import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, type LayoutChangeEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font, spacing } from "../../theme";

interface Props {
  children: React.ReactNode;
  /** Tallest the box may grow before it starts scrolling internally. */
  maxHeight?: number;
  /** Colour the bottom fade blends into. Defaults to the standard card surface. */
  fadeTo?: string;
}

/**
 * A list that stops growing and scrolls inside itself.
 *
 * Room calls and call history are unbounded — a busy room pushed the leaderboard
 * and everything under it off the bottom of the page, so reaching the next
 * section meant scrolling past every row. Capping the height keeps each screen's
 * sections all reachable no matter how much history accumulates.
 *
 * `maxHeight` rather than a hard `height`: a room with two calls should render a
 * two-row card, not a mostly-empty box padded to 320px.
 *
 * The fade at the bottom is the only cue that content continues — a nested
 * scroller has no visible scrollbar on touch devices, so without it a capped
 * list is indistinguishable from a complete one. It's rendered only while
 * scrolled-content remains below, and it sits in a non-touchable overlay so it
 * can't swallow taps meant for the last row.
 */
export function ScrollBox({ children, maxHeight = 320, fadeTo = colors.surface }: Props) {
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [offset, setOffset] = useState(0);

  // Both measurements are needed before we can say anything overflows, and a
  // sub-pixel difference in layout rounding shouldn't trigger a fade.
  const overflows = viewH > 0 && contentH > viewH + 1;
  const atBottom = offset + viewH >= contentH - 1;
  const showFade = overflows && !atBottom;

  return (
    <View style={{ maxHeight }}>
      <ScrollView
        style={{ flexGrow: 0 }}
        // Android confines a nested scroller to the parent without this.
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={(e: LayoutChangeEvent) => setViewH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentH(h)}
        onScroll={(e) => setOffset(e.nativeEvent.contentOffset.y)}
      >
        {children}
      </ScrollView>

      {showFade ? (
        <View style={styles.fadeWrap} pointerEvents="none">
          <LinearGradient
            colors={["transparent", fadeTo]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.more}>scroll for more</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fadeWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0, height: 40,
    alignItems: "center", justifyContent: "flex-end", paddingBottom: 5,
  },
  more: {
    ...font.label,
    fontSize: 9,
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
