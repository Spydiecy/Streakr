import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Share, Alert, Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn, FadeInDown, ZoomIn,
  useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { subscribeCall } from "../lib/firestoreApi";
import type { CallDoc } from "../lib/types";
import { explorerTxUrl } from "../lib/chain";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { PillButton } from "../components/ui/PillButton";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

const META: Record<string, { glyph: string; label: string; tint: string; grad: readonly [string, string]; ink: string }> = {
  pending: { glyph: "◷", label: "SETTLING", tint: colors.textMuted, grad: ["#26282d", "#1c1e22"], ink: colors.text },
  won:     { glyph: "🎉", label: "YOU WON", tint: colors.accent, grad: colors.gradAccent, ink: colors.upInk },
  lost:    { glyph: "💥", label: "NOT THIS TIME", tint: colors.down, grad: colors.gradDown, ink: "#fff" },
  void:    { glyph: "⚪️", label: "VOIDED", tint: colors.neutral, grad: ["#5b636f", "#434a54"], ink: "#fff" },
};

const cardUrl = () => process.env.EXPO_PUBLIC_RESULT_CARD_URL;

export default function ResultScreen({ route, navigation }: Props) {
  const { callId, roomId } = route.params;
  const [call, setCall] = useState<CallDoc | null>(null);
  const pulse = useSharedValue(1);

  useEffect(() => subscribeCall(callId, setCall), [callId]);

  const status = call?.status ?? "pending";
  const m = META[status];

  useEffect(() => {
    if (status === "pending") {
      pulse.value = withRepeat(
        withSequence(withTiming(1.05, { duration: 900 }), withTiming(1, { duration: 900 })),
        -1, true,
      );
    } else {
      pulse.value = withTiming(1);
      Haptics.notificationAsync(
        status === "won" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      );
    }
  }, [status]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const image = () => {
    const base = cardUrl();
    if (!base) return null;
    return base.endsWith("/") ? `${base}?cardId=${callId}` : `${base}/?cardId=${callId}`;
  };

  const share = async () => {
    const url = image();
    try {
      await Share.share({
        message:
          `${m.glyph} Called ${call?.symbol} ${call?.direction?.toUpperCase()} on Streakr — ${m.label}!` +
          ` 🔥 streak: ${call?.streakAfter ?? "?"}${url ? `\n${url}` : ""}`,
        url: url ?? undefined,
      });
    } catch (e) {
      Alert.alert("Couldn't share", (e as Error).message);
    }
  };

  return (
    <Screen glow={status === "lost" ? "down" : "accent"}>
      <View style={styles.root}>
        {!call ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Animated.View style={pulseStyle} entering={ZoomIn.duration(460).springify()}>
              <LinearGradient colors={m.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.disc}>
                <Text style={[styles.discGlyph, { color: m.ink }]}>{m.glyph}</Text>
              </LinearGradient>
            </Animated.View>

            <Animated.Text entering={FadeInDown.delay(130).duration(360)} style={[styles.status, { color: m.tint }]}>
              {m.label}
            </Animated.Text>
            <Animated.Text entering={FadeInDown.delay(180).duration(360)} style={styles.detail}>
              {call.symbol} {call.direction.toUpperCase()} · {call.window}
            </Animated.Text>

            {status === "pending" ? (
              <Animated.View entering={FadeIn.delay(260)} style={styles.pendWrap}>
                <Text style={styles.pend}>
                  Your call is on-chain. This screen updates itself the moment the window settles.
                </Text>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeInDown.delay(260).duration(420).springify()} style={{ width: "100%" }}>
                <Card tone="paper" padded={20} elevated style={{ alignItems: "center" }}>
                  <Text style={styles.streakK}>Current streak</Text>
                  <View style={styles.streakRow}>
                    <Text style={styles.streakV}>{call.streakAfter ?? 0}</Text>
                    <Text style={styles.streakF}>🔥</Text>
                  </View>

                  <View style={styles.pills}>
                    {typeof call.payout === "number" && call.payout > 0 ? (
                      <Stat label="Payout" value={`+${call.payout.toFixed(2)}`} tint={colors.accentDeep} />
                    ) : null}
                    {call.xpAwarded ? <Stat label="XP" value={`+${call.xpAwarded}`} tint={colors.paperInk} /> : null}
                  </View>

                  {call.badgesAwarded?.length ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeT}>🏅 New badge · {call.badgesAwarded.join(", ")}</Text>
                    </View>
                  ) : null}
                </Card>

                <PillButton
                  label="Share Result Card"
                  icon="↗"
                  onPress={share}
                  size="lg"
                  full
                  style={{ marginTop: spacing(4) }}
                />
              </Animated.View>
            )}

            <Pressable onPress={() => Linking.openURL(explorerTxUrl(call.txHash))} style={styles.txWrap}>
              <Text style={styles.tx}>View on-chain transaction ↗</Text>
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        style={styles.done}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: "Room", params: { roomId } }] })}
      >
        <Text style={styles.doneT}>Back to room</Text>
      </Pressable>
    </Screen>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statL}>{label}</Text>
      <Text style={[styles.statV, { color: tint }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(6), gap: spacing(2) },
  disc: { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", marginBottom: spacing(3) },
  discGlyph: { fontSize: 46 },
  status: { fontSize: 25, fontWeight: "900", letterSpacing: 0.4 },
  detail: { ...font.body, color: colors.textMuted, marginTop: 1 },
  pendWrap: { marginTop: spacing(4), maxWidth: 290 },
  pend: { ...font.bodySm, color: colors.textFaint, textAlign: "center", lineHeight: 19 },

  streakK: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  streakRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  streakV: { fontSize: 58, fontWeight: "900", color: colors.paperInk, letterSpacing: -2.5 },
  streakF: { fontSize: 28 },
  pills: { flexDirection: "row", gap: spacing(3), marginTop: spacing(4) },
  stat: {
    backgroundColor: "rgba(10,11,12,0.05)", borderRadius: radius.md,
    paddingVertical: spacing(2.5), paddingHorizontal: spacing(4.5), alignItems: "center", minWidth: 96,
  },
  statL: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  statV: { fontSize: 18, fontWeight: "900", marginTop: 2 },
  badge: {
    marginTop: spacing(4), backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing(3.5), paddingVertical: spacing(2), borderRadius: radius.pill,
  },
  badgeT: { fontSize: 12.5, fontWeight: "800", color: colors.accentDeep },

  txWrap: { marginTop: spacing(5) },
  tx: { ...font.bodySm, color: colors.accent, fontWeight: "700" },
  done: { alignItems: "center", padding: spacing(5) },
  doneT: { ...font.body, color: colors.textFaint, fontWeight: "700" },
});
