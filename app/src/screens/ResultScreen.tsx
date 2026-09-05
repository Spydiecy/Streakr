import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Share, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { subscribeCall } from "../lib/firestoreApi";
import type { CallDoc } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { explorerTxUrl } from "../lib/chain";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { GradientButton } from "../components/ui/GradientButton";

type Props = NativeStackScreenProps<RootStackParamList, "Result">;

const STATUS_META: Record<string, { emoji: string; color: string; gradient: readonly [string, string]; label: string }> = {
  pending: { emoji: "⏳", color: colors.textMuted, gradient: ["#2b2f38", "#1c1f27"], label: "Settling…" },
  won: { emoji: "🎉", color: colors.up, gradient: colors.gradientUp, label: "YOU WON" },
  lost: { emoji: "💥", color: colors.down, gradient: colors.gradientDown, label: "NOT THIS TIME" },
  void: { emoji: "⚪️", color: colors.voidColor, gradient: ["#4b5563", "#374151"], label: "VOIDED" },
};

function resultCardUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_RESULT_CARD_URL;
}

export default function ResultScreen({ route, navigation }: Props) {
  const { callId, roomId } = route.params;
  const [call, setCall] = useState<CallDoc | null>(null);
  const pulse = useSharedValue(1);

  useEffect(() => subscribeCall(callId, setCall), [callId]);

  const status = call?.status ?? "pending";
  const meta = STATUS_META[status];

  useEffect(() => {
    if (status === "pending") {
      pulse.value = withRepeat(withSequence(withTiming(1.06, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true);
    } else {
      Haptics.notificationAsync(
        status === "won" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      );
    }
  }, [status]);

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const cardImageUrl = () => {
    const base = resultCardUrl();
    if (!base) return null;
    return base.endsWith("/") ? `${base}?cardId=${callId}` : `${base}/?cardId=${callId}`;
  };

  const handleShare = async () => {
    const url = cardImageUrl();
    try {
      await Share.share({
        message: `${meta.emoji} I called ${call?.symbol} ${call?.direction?.toUpperCase()} on Streakr — ${meta.label}! 🔥 streak: ${call?.streakAfter ?? "?"}${url ? `\n${url}` : ""}`,
        url: url ?? undefined,
      });
    } catch (e) {
      Alert.alert("Couldn't share", (e as Error).message);
    }
  };

  return (
    <Screen glow="none">
      <LinearGradient
        colors={[status === "won" ? "rgba(47,212,122,0.18)" : status === "lost" ? "rgba(255,84,112,0.14)" : "rgba(124,92,255,0.14)", "transparent"]}
        style={styles.ambientGlow}
      />
      <View style={styles.container}>
        {!call ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Animated.View style={pulseStyle} entering={ZoomIn.duration(500).springify()}>
              <LinearGradient colors={meta.gradient} style={styles.emojiCircle}>
                <Text style={styles.emoji}>{meta.emoji}</Text>
              </LinearGradient>
            </Animated.View>

            <Animated.Text entering={FadeInDown.delay(150).duration(400)} style={[styles.statusText, { color: meta.color }]}>
              {meta.label}
            </Animated.Text>
            <Animated.Text entering={FadeInDown.delay(200).duration(400)} style={styles.detail}>
              {call.symbol} {call.direction.toUpperCase()} · {call.window}
            </Animated.Text>

            {status === "pending" ? (
              <Animated.Text entering={FadeIn.delay(300)} style={styles.pendingNote}>
                Your call is on-chain — this updates automatically the moment the window settles.
              </Animated.Text>
            ) : (
              <Animated.View entering={FadeInDown.delay(300).duration(450).springify()} style={{ width: "100%" }}>
                <Card style={styles.statsCard}>
                  <View style={styles.streakRow}>
                    <Text style={styles.streakEmoji}>🔥</Text>
                    <Text style={styles.streakValue}>{call.streakAfter ?? 0}</Text>
                  </View>
                  <Text style={styles.streakLabel}>current streak</Text>

                  <View style={styles.metaRow}>
                    {typeof call.payout === "number" && call.payout > 0 ? (
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipLabel}>Payout</Text>
                        <Text style={[styles.metaChipValue, { color: colors.up }]}>+{call.payout.toFixed(2)}</Text>
                      </View>
                    ) : null}
                    {call.xpAwarded ? (
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipLabel}>XP</Text>
                        <Text style={[styles.metaChipValue, { color: colors.gold }]}>+{call.xpAwarded}</Text>
                      </View>
                    ) : null}
                  </View>

                  {call.badgesAwarded && call.badgesAwarded.length > 0 ? (
                    <View style={styles.badgeRow}>
                      <Text style={styles.badgeText}>🏅 New badge: {call.badgesAwarded.join(", ")}</Text>
                    </View>
                  ) : null}
                </Card>

                <GradientButton
                  label="Share Result Card"
                  onPress={handleShare}
                  size="lg"
                  style={{ marginTop: spacing(4) }}
                  glow={colors.primaryGlow}
                />
              </Animated.View>
            )}

            <Pressable onPress={() => Alert.alert("Transaction", explorerTxUrl(call.txHash))} style={styles.txLinkWrap}>
              <Text style={styles.txLink}>View on-chain transaction ↗</Text>
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        style={styles.doneButton}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: "Room", params: { roomId } }] })}
      >
        <Text style={styles.doneButtonText}>Back to Room</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ambientGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 400 },
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(6), gap: spacing(2) },
  emojiCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing(2),
  },
  emoji: { fontSize: 52 },
  statusText: { fontSize: 26, fontWeight: "900", letterSpacing: 0.5 },
  detail: { ...font.body, color: colors.textMuted, marginTop: 2 },
  pendingNote: { color: colors.textFaint, textAlign: "center", marginTop: spacing(3), fontSize: 13, lineHeight: 19, maxWidth: 280 },
  statsCard: { alignItems: "center", marginTop: spacing(5), width: "100%" },
  streakRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  streakEmoji: { fontSize: 34 },
  streakValue: { fontSize: 52, fontWeight: "900", color: colors.text },
  streakLabel: { ...font.caption, color: colors.textFaint, textTransform: "uppercase", marginTop: -4 },
  metaRow: { flexDirection: "row", gap: spacing(3), marginTop: spacing(4) },
  metaChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    alignItems: "center",
    minWidth: 90,
  },
  metaChipLabel: { ...font.caption, color: colors.textFaint, textTransform: "uppercase" },
  metaChipValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },
  badgeRow: { marginTop: spacing(4) },
  badgeText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  txLinkWrap: { marginTop: spacing(5) },
  txLink: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  doneButton: { alignItems: "center", padding: spacing(5) },
  doneButtonText: { color: colors.textFaint, fontWeight: "600" },
});
