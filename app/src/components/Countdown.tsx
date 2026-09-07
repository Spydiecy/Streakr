import React, { useEffect, useState, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors, font } from "../theme";

/**
 * Live countdown ring to `closesAtSec` (unix seconds), ticking every second.
 * Per the brief: countdown timers must be prominent and always visible during
 * an open window, and "closed" must come from the actual chain state
 * (poll/subscribe), never just the client clock — the client clock here only
 * drives the *display*; the button-disable decision lives with the caller
 * reading real on-chain status.
 */
export function Countdown({
  closesAtSec,
  totalSec,
  onExpire,
  size = 132,
}: {
  closesAtSec: number;
  totalSec?: number;
  onExpire?: () => void;
  size?: number;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.max(0, closesAtSec - now);
  useEffect(() => {
    if (secondsLeft === 0) onExpire?.();
  }, [secondsLeft === 0]);

  const total = totalSec ?? 3600;
  const progress = Math.min(1, Math.max(0, secondsLeft / total));
  const urgent = secondsLeft <= 30 && secondsLeft > 0;
  const closed = secondsLeft <= 0;

  const strokeWidth = 9;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = useMemo(() => circumference * (1 - progress), [circumference, progress]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const ringColor = closed ? colors.textFaint : urgent ? colors.down : colors.accent;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {closed ? (
        <Text style={styles.closedText}>CLOSED</Text>
      ) : (
        <>
          <Text style={[styles.time, urgent && styles.timeUrgent]}>
            {m}:{s.toString().padStart(2, "0")}
          </Text>
          <Text style={styles.caption}>left</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  time: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  timeUrgent: {
    color: colors.down,
  },
  caption: {
    ...font.label,
    color: colors.textFaint,
    marginTop: 2,
  },
  closedText: {
    ...font.label,
    color: colors.textFaint,
    fontSize: 13,
  },
});
