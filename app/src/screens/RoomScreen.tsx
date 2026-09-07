import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring,
} from "react-native-reanimated";
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
import { Chip } from "../components/ui/Chip";
import { Toggle } from "../components/ui/Toggle";
import { colors, radius, font, spacing, shadow } from "../theme";

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
  const [board, setBoard] = useState<LeaderboardEntryDoc[]>([]);
  const [symbol, setSymbol] = useState<Symbol_>("BTC");
  const [win, setWin] = useState<WindowLength>("1h");
  const [market, setMarket] = useState<LiveMarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<{ text: string; source: string } | null>(null);
  const [stake, setStake] = useState(5);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribeLeaderboard(roomId, setBoard), [roomId]);

  const loadMarket = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const found = (await listLiveMarkets()).find((m) => m.symbol === symbol && m.window === win) ?? null;
      setMarket(found);
      if (found && session) {
        await setRoomActiveMarket(roomId, {
          symbol, window: win,
          positionMarketId: found.market.info.marketType === "BINARY" ? found.market.info.marketId : undefined,
        }).catch(() => {});
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbol, win, roomId, session]);

  useEffect(() => { loadMarket(); }, [loadMarket]);

  // Re-read live on-chain state so "closed" never depends on the client clock.
  useEffect(() => {
    const id = setInterval(loadMarket, 15_000);
    return () => clearInterval(id);
  }, [loadMarket]);

  useEffect(() => {
    let dead = false;
    fetchSentiment(symbol).then((s) => !dead && setSentiment(s)).catch(() => !dead && setSentiment(null));
    return () => { dead = true; };
  }, [symbol]);

  const closed = !market || market.secondsLeft <= 0;
  const totalSec = win === "15m" ? 900 : 3600;

  const call = (direction: "up" | "down") => {
    if (!market || closed) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Window closed", "This window just locked. Pick another symbol or window.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    navigation.navigate("CallConfirm", { roomId, symbol, window: win, direction, stakeUsdso: stake });
  };

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <Pressable onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headKicker}>Room</Text>
            <Text style={styles.headTitle} numberOfLines={1}>{room?.name ?? "…"}</Text>
          </View>
        </View>

        <View style={styles.pickers}>
          <Toggle options={SYMBOLS} value={symbol} onChange={setSymbol} compact />
          <Toggle options={WINDOWS} value={win} onChange={setWin} compact />
        </View>

        {/* Market card */}
        <Animated.View entering={FadeIn.duration(280)}>
          <Card padded={20} elevated style={styles.market}>
            <LinearGradient colors={["rgba(197,248,42,0.07)", "transparent"]} style={StyleSheet.absoluteFill} />
            {loading && !market ? (
              <ActivityIndicator color={colors.accent} style={{ paddingVertical: spacing(11) }} />
            ) : err ? (
              <Text style={styles.err}>{err}</Text>
            ) : !market ? (
              <View style={styles.noMarket}>
                <Text style={styles.noMarketGlyph}>🌙</Text>
                <Text style={styles.noMarketTitle}>No live {symbol} {win} window</Text>
                <Text style={styles.noMarketBody}>The venue isn't running this series right now — try the other window.</Text>
              </View>
            ) : (
              <View style={styles.marketRow}>
                <View style={{ flex: 1 }}>
                  <Chip label={closed ? "Locked" : "Live"} tone={closed ? "neutral" : "up"} icon="●" />
                  <Text style={styles.marketSym}>{symbol}</Text>
                  <Text style={styles.marketId} numberOfLines={1}>{market.market.symbol}</Text>
                  <View style={styles.book}>
                    <View>
                      <Text style={styles.bookL}>Up</Text>
                      <Text style={styles.bookV}>{market.yesAsk?.toFixed(3) ?? "—"}</Text>
                    </View>
                    <View style={styles.bookSep} />
                    <View>
                      <Text style={styles.bookL}>Down</Text>
                      <Text style={styles.bookV}>
                        {market.yesBid !== undefined ? (1 - market.yesBid).toFixed(3) : "—"}
                      </Text>
                    </View>
                  </View>
                </View>
                <Countdown closesAtSec={Number(market.onchain.expiry)} totalSec={totalSec} onExpire={loadMarket} size={124} />
              </View>
            )}
          </Card>
        </Animated.View>

        {/* AI sentiment */}
        {sentiment ? (
          <Animated.View entering={FadeInDown.delay(90).duration(320)}>
            <Card tone="raised" padded={16} style={styles.ai}>
              <View style={styles.aiHead}>
                <Text style={styles.aiGlyph}>🤖</Text>
                <Text style={styles.aiLabel}>AI take · not advice</Text>
              </View>
              <Text style={styles.aiText}>{sentiment.text}</Text>
            </Card>
          </Animated.View>
        ) : null}

        {/* Stake */}
        <Text style={styles.blockLabel}>Stake</Text>
        <View style={styles.stakes}>
          {STAKES.map((v) => {
            const on = stake === v;
            return (
              <Pressable
                key={v}
                onPress={() => { Haptics.selectionAsync(); setStake(v); }}
                style={[styles.stake, on && styles.stakeOn]}
              >
                <Text style={[styles.stakeT, on && styles.stakeTOn]}>${v}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Call buttons */}
        <View style={styles.calls}>
          <CallBtn label="UP" arrow="▲" grad={colors.gradAccent} ink={colors.upInk} glow={colors.accentGlow} disabled={closed} onPress={() => call("up")} />
          <CallBtn label="DOWN" arrow="▼" grad={colors.gradDown} ink="#fff" glow={colors.downGlow} disabled={closed} onPress={() => call("down")} />
        </View>
        {closed && market ? <Text style={styles.closedNote}>Waiting for the venue to roll the next window…</Text> : null}

        {/* Room board */}
        <View style={styles.boardHead}>
          <Text style={styles.blockLabel}>Room leaderboard</Text>
          {board.length > 0 ? <Text style={styles.boardCount}>{board.length}</Text> : null}
        </View>
        <Card padded={false}>
          {board.length === 0 ? (
            <Text style={styles.boardEmpty}>No calls settled here yet.</Text>
          ) : (
            board.map((e, i) => (
              <View key={e.uid} style={[styles.brow, i > 0 && styles.browLine]}>
                <View style={[styles.rank, i < 3 && styles.rankTop]}>
                  <Text style={[styles.rankT, i < 3 && styles.rankTT]}>{i + 1}</Text>
                </View>
                <Text style={styles.bname} numberOfLines={1}>{e.displayName}</Text>
                <Text style={styles.bstreak}>🔥{e.currentStreak}</Text>
                <Text style={styles.bxp}>{e.xp} XP</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function CallBtn({
  label, arrow, grad, ink, glow, disabled, onPress,
}: {
  label: string; arrow: string; grad: readonly [string, string];
  ink: string; glow: string; disabled: boolean; onPress: () => void;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      style={[styles.callWrap, a, !disabled && shadow.glow(glow)]}
      disabled={disabled}
      onPressIn={() => (s.value = withSpring(0.955, { damping: 17, stiffness: 320 }))}
      onPressOut={() => (s.value = withSpring(1, { damping: 13, stiffness: 260 }))}
      onPress={onPress}
    >
      <LinearGradient
        colors={disabled ? ["#26282d", "#1d1f23"] : grad}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.callBtn}
      >
        <Text style={[styles.callArrow, { color: disabled ? colors.textFaint : ink }]}>{arrow}</Text>
        <Text style={[styles.callLabel, { color: disabled ? colors.textFaint : ink }]}>{label}</Text>
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing(5), paddingBottom: spacing(12) },
  head: { flexDirection: "row", alignItems: "center", gap: spacing(3), marginBottom: spacing(5) },
  back: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  backGlyph: { color: colors.text, fontSize: 22, marginTop: -3 },
  headKicker: { ...font.label, color: colors.textFaint, textTransform: "uppercase" },
  headTitle: { ...font.h2, color: colors.text, marginTop: 1 },

  pickers: { flexDirection: "row", justifyContent: "space-between", gap: spacing(2), marginBottom: spacing(4) },

  market: { marginBottom: spacing(3), minHeight: 168, justifyContent: "center" },
  marketRow: { flexDirection: "row", alignItems: "center", gap: spacing(3) },
  marketSym: { ...font.display, fontSize: 34, color: colors.text, marginTop: spacing(2) },
  marketId: { ...font.bodySm, fontSize: 11, color: colors.textFaint, marginTop: 1 },
  book: { flexDirection: "row", alignItems: "center", gap: spacing(4), marginTop: spacing(3.5) },
  bookL: { ...font.label, color: colors.textFaint, textTransform: "uppercase" },
  bookV: { ...font.mono, fontSize: 17, color: colors.text, marginTop: 2 },
  bookSep: { width: 1, height: 28, backgroundColor: colors.border },
  err: { color: colors.down, textAlign: "center", lineHeight: 20 },
  noMarket: { alignItems: "center", paddingVertical: spacing(4) },
  noMarketGlyph: { fontSize: 30, marginBottom: spacing(2) },
  noMarketTitle: { ...font.h3, color: colors.text },
  noMarketBody: { ...font.bodySm, color: colors.textFaint, marginTop: 4, textAlign: "center", lineHeight: 18 },

  ai: { marginBottom: spacing(4) },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing(1.5) },
  aiGlyph: { fontSize: 13 },
  aiLabel: { ...font.label, color: colors.textFaint, textTransform: "uppercase" },
  aiText: { ...font.body, color: colors.text, lineHeight: 21 },

  blockLabel: { ...font.label, color: colors.textFaint, textTransform: "uppercase", marginBottom: spacing(2.5) },
  stakes: { flexDirection: "row", gap: spacing(2), marginBottom: spacing(5) },
  stake: {
    flex: 1, paddingVertical: spacing(3.5), borderRadius: radius.md, alignItems: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  stakeOn: { backgroundColor: colors.accentWash, borderColor: colors.accent },
  stakeT: { color: colors.textMuted, fontWeight: "800", fontSize: 15 },
  stakeTOn: { color: colors.accent },

  calls: { flexDirection: "row", gap: spacing(3), marginBottom: spacing(2) },
  callWrap: { flex: 1, borderRadius: radius.xl },
  callBtn: { borderRadius: radius.xl, paddingVertical: spacing(6), alignItems: "center", gap: 3 },
  callArrow: { fontSize: 20 },
  callLabel: { fontWeight: "900", fontSize: 19, letterSpacing: 0.6 },
  closedNote: { ...font.bodySm, color: colors.textFaint, textAlign: "center", marginBottom: spacing(2) },

  boardHead: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginTop: spacing(6) },
  boardCount: {
    ...font.label, color: colors.textFaint, backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill,
    overflow: "hidden", marginBottom: spacing(2.5),
  },
  boardEmpty: { ...font.bodySm, color: colors.textFaint, textAlign: "center", paddingVertical: spacing(7) },
  brow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing(3), paddingHorizontal: spacing(4), gap: spacing(2.5) },
  browLine: { borderTopWidth: 1, borderTopColor: colors.border },
  rank: {
    width: 24, height: 24, borderRadius: 8, backgroundColor: colors.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  rankTop: { backgroundColor: colors.accentWash },
  rankT: { ...font.label, color: colors.textFaint },
  rankTT: { color: colors.accent },
  bname: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 14 },
  bstreak: { color: colors.gold, fontWeight: "800", fontSize: 13 },
  bxp: { ...font.mono, fontSize: 12, color: colors.textFaint, minWidth: 52, textAlign: "right" },
});
