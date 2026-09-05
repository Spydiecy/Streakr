import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { subscribeRoom, subscribeLeaderboard, setRoomActiveMarket } from "../lib/firestoreApi";
import { listLiveMarkets, type LiveMarketInfo } from "../lib/eventContracts";
import { fetchSentiment } from "../lib/sentimentApi";
import type { LeaderboardEntryDoc, RoomDoc, Symbol_, WindowLength } from "../lib/types";
import { Countdown } from "../components/Countdown";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { colors, radius, font, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Room">;

const SYMBOLS: { value: Symbol_; label: string }[] = [
  { value: "BTC", label: "₿ BTC" },
  { value: "ETH", label: "Ξ ETH" },
];
const WINDOWS: { value: WindowLength; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" },
];
const STAKES = [5, 10, 25, 50];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function RoomScreen({ route, navigation }: Props) {
  const { roomId } = route.params;
  const { session } = useSession();
  const [room, setRoom] = useState<RoomDoc | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntryDoc[]>([]);
  const [symbol, setSymbol] = useState<Symbol_>("BTC");
  const [windowLen, setWindowLen] = useState<WindowLength>("1h");
  const [market, setMarket] = useState<LiveMarketInfo | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<{ text: string; source: string } | null>(null);
  const [stake, setStake] = useState(5);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribeLeaderboard(roomId, setLeaderboard), [roomId]);

  const loadMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarketError(null);
    try {
      const markets = await listLiveMarkets();
      const found = markets.find((m) => m.symbol === symbol && m.window === windowLen) ?? null;
      setMarket(found);
      if (found && session) {
        await setRoomActiveMarket(roomId, {
          symbol,
          window: windowLen,
          positionMarketId: found.market.info.marketType === "BINARY" ? found.market.info.marketId : undefined,
        }).catch(() => {});
      }
    } catch (e) {
      setMarketError((e as Error).message);
    } finally {
      setMarketLoading(false);
    }
  }, [symbol, windowLen, roomId, session]);

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    const id = setInterval(loadMarket, 15_000);
    return () => clearInterval(id);
  }, [loadMarket]);

  useEffect(() => {
    let cancelled = false;
    fetchSentiment(symbol)
      .then((s) => !cancelled && setSentiment(s))
      .catch(() => !cancelled && setSentiment(null));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const windowClosed = !market || market.secondsLeft <= 0;
  const totalSec = windowLen === "15m" ? 15 * 60 : 60 * 60;

  const handleCall = (direction: "up" | "down") => {
    if (!market || windowClosed) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Window closed", "This window just locked — pick another symbol/window.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    navigation.navigate("CallConfirm", { roomId, symbol, window: windowLen, direction, stakeUsdso: stake });
  };

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
          <Text style={styles.roomTitle} numberOfLines={1}>
            {room?.name ?? "…"}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.pickerBlock}>
          <SegmentedControl options={SYMBOLS} value={symbol} onChange={setSymbol} />
          <SegmentedControl options={WINDOWS} value={windowLen} onChange={setWindowLen} />
        </View>

        <Animated.View entering={FadeIn.duration(300)}>
          <Card elevated style={styles.marketCard}>
            <LinearGradient
              colors={["rgba(124,92,255,0.10)", "rgba(124,92,255,0)"]}
              style={StyleSheet.absoluteFill}
            />
            {marketLoading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing(10) }} />
            ) : marketError ? (
              <Text style={styles.errorText}>{marketError}</Text>
            ) : !market ? (
              <View style={styles.noMarket}>
                <Text style={styles.noMarketEmoji}>🌙</Text>
                <Text style={styles.errorText}>
                  No live {symbol} {windowLen} window right now. Try another symbol or window.
                </Text>
              </View>
            ) : (
              <View style={styles.marketContent}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.marketLabel}>{market.market.symbol}</Text>
                  <View style={styles.priceGrid}>
                    <View>
                      <Text style={styles.priceCaption}>YES bid</Text>
                      <Text style={styles.priceValue}>{market.yesBid?.toFixed(3) ?? "—"}</Text>
                    </View>
                    <View>
                      <Text style={styles.priceCaption}>YES ask</Text>
                      <Text style={styles.priceValue}>{market.yesAsk?.toFixed(3) ?? "—"}</Text>
                    </View>
                  </View>
                </View>
                <Countdown closesAtSec={Number(market.onchain.expiry)} totalSec={totalSec} onExpire={loadMarket} />
              </View>
            )}
          </Card>
        </Animated.View>

        {sentiment ? (
          <Animated.View entering={FadeInDown.delay(100).duration(350)}>
            <Card style={styles.sentimentCard}>
              <View style={styles.sentimentHeader}>
                <Text style={styles.sentimentIcon}>🤖</Text>
                <Text style={styles.sentimentLabel}>AI take, not advice</Text>
              </View>
              <Text style={styles.sentimentText}>{sentiment.text}</Text>
            </Card>
          </Animated.View>
        ) : null}

        <View style={styles.stakeSection}>
          <Text style={styles.stakeSectionLabel}>Stake</Text>
          <View style={styles.stakeRow}>
            {STAKES.map((v) => (
              <Pressable
                key={v}
                onPress={() => {
                  Haptics.selectionAsync();
                  setStake(v);
                }}
                style={[styles.stakeChip, stake === v && styles.stakeChipActive]}
              >
                <Text style={[styles.stakeChipText, stake === v && styles.stakeChipTextActive]}>${v}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.callRow}>
          <CallButton
            label="UP"
            arrow="▲"
            gradient={colors.gradientUp}
            glow={colors.upGlow}
            disabled={windowClosed}
            onPress={() => handleCall("up")}
          />
          <CallButton
            label="DOWN"
            arrow="▼"
            gradient={colors.gradientDown}
            glow={colors.downGlow}
            disabled={windowClosed}
            onPress={() => handleCall("down")}
          />
        </View>
        {windowClosed && !marketLoading && market ? (
          <Text style={styles.closedNote}>Window closed — waiting for the venue to roll the next one.</Text>
        ) : null}

        <Text style={styles.sectionTitle}>Room Leaderboard</Text>
        <Card style={styles.leaderboardCard} noPadding>
          {leaderboard.length === 0 ? (
            <Text style={styles.emptyText}>No calls settled here yet.</Text>
          ) : (
            leaderboard.map((entry, i) => (
              <View key={entry.uid} style={[styles.leaderboardRow, i > 0 && styles.leaderboardRowBorder]}>
                <Text style={[styles.rank, i < 3 && styles.rankTop]}>{i + 1}</Text>
                <Text style={styles.leaderboardName} numberOfLines={1}>
                  {entry.displayName}
                </Text>
                <Text style={styles.leaderboardStreak}>🔥{entry.currentStreak}</Text>
                <Text style={styles.leaderboardXp}>{entry.xp} XP</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function CallButton({
  label,
  arrow,
  gradient,
  glow,
  disabled,
  onPress,
}: {
  label: string;
  arrow: string;
  gradient: readonly [string, string, ...string[]];
  glow: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      style={[styles.callButtonWrap, animatedStyle, !disabled && { shadowColor: glow, shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 }]}
      disabled={disabled}
      onPressIn={() => (scale.value = withSpring(0.95, { damping: 16, stiffness: 300 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 14, stiffness: 250 }))}
      onPress={onPress}
    >
      <LinearGradient colors={disabled ? ["#2b2f38", "#22262f"] : gradient} style={styles.callButton}>
        <Text style={styles.callArrow}>{arrow}</Text>
        <Text style={styles.callLabel}>{label}</Text>
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing(5), paddingBottom: spacing(14) },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing(5) },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: colors.text, fontSize: 22, marginTop: -2 },
  roomTitle: { ...font.h3, color: colors.text, flex: 1, textAlign: "center" },
  pickerBlock: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing(5) },
  marketCard: { marginBottom: spacing(4), minHeight: 140, justifyContent: "center", position: "relative" },
  marketContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  marketLabel: { ...font.caption, color: colors.textFaint, marginBottom: spacing(3) },
  priceGrid: { flexDirection: "row", gap: spacing(6) },
  priceCaption: { ...font.caption, color: colors.textFaint, textTransform: "uppercase", marginBottom: 3 },
  priceValue: { ...font.numeric, color: colors.text, fontSize: 18 },
  noMarket: { alignItems: "center", paddingVertical: spacing(4) },
  noMarketEmoji: { fontSize: 32, marginBottom: spacing(2) },
  errorText: { color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  sentimentCard: { marginBottom: spacing(4), backgroundColor: colors.surfaceAlt },
  sentimentHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing(1.5) },
  sentimentIcon: { fontSize: 14 },
  sentimentLabel: { ...font.caption, color: colors.textFaint, textTransform: "uppercase" },
  sentimentText: { ...font.body, color: colors.text, lineHeight: 21 },
  stakeSection: { marginBottom: spacing(5) },
  stakeSectionLabel: { ...font.caption, color: colors.textFaint, textTransform: "uppercase", marginBottom: spacing(2) },
  stakeRow: { flexDirection: "row", gap: spacing(2) },
  stakeChip: {
    flex: 1,
    paddingVertical: spacing(3),
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stakeChipActive: { backgroundColor: "rgba(124,92,255,0.16)", borderColor: colors.primary },
  stakeChipText: { color: colors.textMuted, fontWeight: "700" },
  stakeChipTextActive: { color: colors.primary },
  callRow: { flexDirection: "row", gap: spacing(3), marginBottom: spacing(2) },
  callButtonWrap: { flex: 1, borderRadius: radius.xl },
  callButton: {
    borderRadius: radius.xl,
    paddingVertical: spacing(6),
    alignItems: "center",
    gap: 4,
  },
  callArrow: { fontSize: 22, color: "#04140a" },
  callLabel: { color: "#04140a", fontWeight: "900", fontSize: 19, letterSpacing: 0.5 },
  closedNote: { color: colors.textFaint, textAlign: "center", marginBottom: spacing(3), fontSize: 13 },
  sectionTitle: { ...font.h3, color: colors.text, marginTop: spacing(6), marginBottom: spacing(3) },
  leaderboardCard: {},
  emptyText: { color: colors.textFaint, textAlign: "center", paddingVertical: spacing(6) },
  leaderboardRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing(3), paddingHorizontal: spacing(4) },
  leaderboardRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: { color: colors.textFaint, width: 26, fontWeight: "800", fontSize: 14 },
  rankTop: { color: colors.gold },
  leaderboardName: { flex: 1, color: colors.text, fontWeight: "600" },
  leaderboardStreak: { color: colors.gold, marginRight: spacing(3), fontWeight: "700" },
  leaderboardXp: { color: colors.textFaint, fontSize: 13 },
});
