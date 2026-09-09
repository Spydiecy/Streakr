import React, { useMemo } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Line } from "react-native-svg";
import { colors, font, spacing } from "../theme";
import { formatPrice, type PriceSeries } from "../lib/priceFeed";

/**
 * A sparkline of recent closes for the asset being called.
 *
 * The point is orientation: the app asks "will this go up or down?" and until now
 * gave no view of what it had just been doing. The line is deliberately minimal —
 * no axes, no gridlines, no candles. A trader doesn't need them at this size, and
 * a casual player would only be crowded by them. What matters is the shape, the
 * current price, and the change over the span.
 *
 * Coloured by direction over the window rather than by a fixed brand colour, so
 * the chart agrees at a glance with the UP/DOWN decision underneath it.
 */
export function PriceChart({
  series,
  loading,
  height = 56,
}: {
  series: PriceSeries | null;
  loading?: boolean;
  height?: number;
}) {
  // A viewBox in fixed units keeps the path independent of the rendered width, so
  // it scales to any container without recomputing.
  const W = 100;
  const H = 32;

  const path = useMemo(() => {
    if (!series || series.points.length < 2) return null;
    const { points, min, max } = series;
    // Pad the range so a flat series doesn't divide by zero and doesn't render
    // pinned to an edge.
    const span = max - min || Math.max(max * 0.001, 0.01);
    const lo = min - span * 0.12;
    const hi = max + span * 0.12;

    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join(" ");
    // Close the shape to the baseline for the fill underneath.
    const area = `${line} L${W},${H} L0,${H} Z`;
    return { line, area, y0: y(series.first) };
  }, [series]);

  if (loading && !series) {
    return (
      <View style={[styles.wrap, { height }]}>
        <ActivityIndicator color={colors.textFaint} size="small" />
      </View>
    );
  }

  if (!series || !path) {
    // Silent when unavailable — a missing chart shouldn't draw attention on a
    // screen whose job is placing a call.
    return null;
  }

  const up = series.changePct >= 0;
  const stroke = up ? colors.accent : colors.down;
  const sign = up ? "+" : "";
  const span = series.timeframe === "1m" ? `${series.points.length}m` : `${series.points.length}h`;

  return (
    <View style={[styles.wrap, { height }]}>
      <View style={styles.head}>
        <Text style={styles.price}>{formatPrice(series.last)}</Text>
        <Text style={[styles.change, { color: stroke }]}>
          {sign}
          {series.changePct.toFixed(2)}%
        </Text>
        <Text style={styles.span}>{span}</Text>
      </View>

      <Svg width="100%" height={height - 20} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Defs>
          <SvgGradient id="pcFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stroke} stopOpacity="0.22" />
            <Stop offset="1" stopColor={stroke} stopOpacity="0" />
          </SvgGradient>
        </Defs>

        {/* Where the series opened, so the change reads as a distance from it. */}
        <Line
          x1="0"
          y1={path.y0}
          x2={W}
          y2={path.y0}
          stroke={colors.border}
          strokeWidth="0.4"
          strokeDasharray="2 2"
        />
        <Path d={path.area} fill="url(#pcFill)" />
        <Path
          d={path.line}
          fill="none"
          stroke={stroke}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          // The path is drawn in a non-uniform viewBox, so scaling would
          // otherwise stretch the stroke horizontally.
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: "center", marginTop: spacing(3) },
  head: { flexDirection: "row", alignItems: "baseline", gap: spacing(2), marginBottom: 2 },
  price: { ...font.mono, fontSize: 15, color: colors.text, fontVariant: ["tabular-nums"] },
  change: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  span: { ...font.label, fontSize: 9.5, color: colors.textFaint, marginLeft: "auto" },
});
