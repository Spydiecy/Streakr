import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { findMarket, placeCall, type LiveMarketInfo } from "../lib/eventContracts";
import { recordCall } from "../lib/firestoreApi";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { GradientButton } from "../components/ui/GradientButton";

type Props = NativeStackScreenProps<RootStackParamList, "CallConfirm">;

export default function CallConfirmScreen({ route, navigation }: Props) {
  const { roomId, symbol, window: windowLen, direction, stakeUsdso } = route.params;
  const { session } = useSession();
  const [market, setMarket] = useState<LiveMarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUp = direction === "up";
  const accentGradient = isUp ? colors.gradientUp : colors.gradientDown;
  const accentColor = isUp ? colors.up : colors.down;

  useEffect(() => {
    findMarket(symbol, windowLen)
      .then(setMarket)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [symbol, windowLen]);

  const potentialPayout = market?.yesAsk
    ? stakeUsdso / (direction === "up" ? market.yesAsk : 1 - (market.yesBid ?? market.yesAsk))
    : null;

  const handleConfirm = async () => {
    if (!market || !session) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await placeCall(session.wallet.privateKey, market, direction, stakeUsdso);
      const callId = await recordCall({
        roomId,
        uid: session.user.uid,
        symbol,
        direction,
        window: windowLen,
        stakeUsdso: result.stakeSpent,
        txHash: result.txHash,
        positionId: result.positionId,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace("Result", { callId, roomId });
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Call failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen glow="none" edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>

        <Animated.View entering={FadeInUp.duration(400).springify()} style={styles.center}>
          <LinearGradient colors={accentGradient} style={styles.directionBadge}>
            <Text style={styles.directionArrow}>{isUp ? "▲" : "▼"}</Text>
          </LinearGradient>
          <Text style={styles.symbolText}>
            {symbol} {direction.toUpperCase()}
          </Text>
          <Text style={styles.windowText}>{windowLen} window</Text>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(150).duration(350)}>
          <Card style={styles.detailsCard}>
            <Row label="Stake" value={`${stakeUsdso.toFixed(2)} tUSDC`} />
            <Row
              label="Potential payout"
              value={potentialPayout ? `~${potentialPayout.toFixed(2)} tUSDC` : "—"}
              valueColor={colors.up}
            />
            <View style={styles.divider} />
            <View style={styles.riskRow}>
              <Text style={styles.riskIcon}>🛡️</Text>
              <Text style={styles.riskText}>
                Capped risk, no liquidation. Right, and you get a fixed payout. Wrong, and you only lose
                your stake — nothing more.
              </Text>
            </View>
          </Card>
        </Animated.View>

        <View style={styles.footer}>
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : !market ? (
            <Text style={styles.errorText}>
              {error ?? `No live ${symbol} ${windowLen} window right now — go back and pick another.`}
            </Text>
          ) : (
            <>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <GradientButton
                label="Sign & Submit Call"
                onPress={handleConfirm}
                loading={submitting}
                size="lg"
                colors={accentGradient}
                glow={isUp ? colors.upGlow : colors.downGlow}
              />
            </>
          )}
          <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing(5), justifyContent: "space-between" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  closeIcon: { color: colors.textMuted, fontSize: 16 },
  center: { alignItems: "center", marginTop: spacing(4) },
  directionBadge: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing(4),
  },
  directionArrow: { fontSize: 40, color: "#04140a" },
  symbolText: { ...font.h1, fontSize: 30, color: colors.text },
  windowText: { ...font.body, color: colors.textFaint, marginTop: 4 },
  detailsCard: { marginTop: spacing(8) },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing(3) },
  rowLabel: { ...font.body, color: colors.textFaint },
  rowValue: { ...font.h3, fontSize: 16, color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing(2) },
  riskRow: { flexDirection: "row", gap: spacing(3), alignItems: "flex-start" },
  riskIcon: { fontSize: 18 },
  riskText: { ...font.bodySm, color: colors.textMuted, flex: 1, lineHeight: 19 },
  footer: { gap: spacing(3) },
  errorText: { color: colors.down, fontSize: 13, textAlign: "center" },
  cancelButton: { alignItems: "center", paddingVertical: spacing(2) },
  cancelText: { color: colors.textFaint, fontWeight: "600" },
});
