import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring,
} from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import {
  subscribeRoom,
  subscribeLeaderboard,
  subscribeRoomCalls,
  setRoomActiveMarket,
  fetchDisplayNames,
} from "../lib/firestoreApi";
import { listLiveMarkets, availableWindows, type LiveMarketInfo } from "../lib/eventContracts";
import { friendlyErrorLine } from "../lib/errors";
import { reportFirestoreError, reportFirestoreOk } from "../lib/firestoreHealth";
import { fetchSentiment } from "../lib/sentimentApi";
import type { CallDoc, LeaderboardEntryDoc, RoomDoc, Symbol_, WindowLength } from "../lib/types";
import { Countdown } from "../components/Countdown";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Toggle } from "../components/ui/Toggle";
import { PillButton } from "../components/ui/PillButton";
import { Icon, type IconName } from "../components/ui/Icon";
import { colors, radius, font, spacing, shadow } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Room">;

const SYMBOLS: { value: Symbol_; label: string }[] = [
  { value: "BTC", label: "₿ BTC" },
  { value: "ETH", label: "Ξ ETH" },
];
const STAKES = [5, 10, 25, 50];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function RoomScreen({ route, navigation }: Props) {
  const { roomId } = route.params;
  const { session } = useSession();
  const [room, setRoom] = useState<RoomDoc | null>(null);
  const [board, setBoard] = useState<LeaderboardEntryDoc[]>([]);
  const [calls, setCalls] = useState<CallDoc[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [symbol, setSymbol] = useState<Symbol_>("BTC");
  const [win, setWin] = useState<WindowLength>("1h");
  const [allMarkets, setAllMarkets] = useState<LiveMarketInfo[]>([]);
  // Raw last-written market; read through the `market` guard below rather than
  // directly, so a response for a since-changed symbol/window can't render.
  const [rawMarket, setMarket] = useState<LiveMarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Which asset the last completed read was for. "No live windows" is only
  // truthful once a read for the *current* asset has actually finished;
  // without this the empty state flashes for a frame on every toggle.
  const [loadedFor, setLoadedFor] = useState<Symbol_ | null>(null);
  const [sentiment, setSentiment] = useState<{ text: string; source: string } | null>(null);
  const [stake, setStake] = useState(5);

  useEffect(() => subscribeRoom(roomId, setRoom), [roomId]);
  useEffect(() => subscribeLeaderboard(roomId, setBoard), [roomId]);

  // Every call made in this room, pending ones included.
  //
  // The room previously showed only the leaderboard, which is written server-side
  // from SETTLED results — so a call you had just placed appeared nowhere in the
  // room it belonged to, while showing up fine in your profile. This is the feed
  // that makes a room feel shared, and it's what the
  // calls(roomId, createdAt DESC) index exists for.
  useEffect(() => subscribeRoomCalls(roomId, setCalls), [roomId]);

  // Resolve uid -> display name for the feed; calls carry only a uid.
  useEffect(() => {
    const uids = [...new Set(calls.map((c) => c.uid))];
    if (uids.length === 0) return;
    let dead = false;
    fetchDisplayNames(uids).then((m) => !dead && setNames(m));
    return () => { dead = true; };
  }, [calls]);

  /**
   * Guards against out-of-order market reads.
   *
   * `listLiveMarkets` takes seconds, and both the symbol/window toggles and a
   * 15s poll can start one. Switching BTC→ETH while a BTC read is in flight let
   * the older response land last and overwrite state — the card then showed the
   * ETH heading (from `symbol`) above BTC's label and BTC's prices, which is
   * exactly the "odds don't change when I switch" symptom. Only the newest
   * request is allowed to write.
   */
  const reqIdRef = useRef(0);

  /** Last `activeMarket` value actually written, so identical writes are skipped. */
  const publishedRef = useRef<string | null>(null);

  const loadMarket = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    const isStale = () => reqId !== reqIdRef.current;

    setLoading(true);
    setErr(null);
    try {
      const live = await listLiveMarkets(symbol);
      if (isStale()) return;

      // Keep the last non-empty result for a symbol. A transient empty read
      // (RPC hiccup, or every market mid-roll and failing the status gate)
      // would otherwise blank `windowOptions` and make the 4h/1d chips vanish
      // for a poll cycle.
      if (live.length > 0) setAllMarkets(live);

      const source = live.length > 0 ? live : [];
      const options = availableWindows(source, symbol);
      const effective = options.includes(win) ? win : options[0];
      if (effective && effective !== win) setWin(effective);

      const found = effective ? (source.find((m) => m.window === effective) ?? null) : null;
      if (isStale()) return;
      setMarket(found);

      setLoadedFor(symbol);

      // Publish which market this room is watching — the pre-lock nudge Lambda
      // reads it to know who to ping.
      //
      // Two guards, both of which were missing and together produced a stream of
      // failing writes (one per toggle AND one per 15s poll, forever):
      //
      //   1. Only the creator may write `activeMarket` — firestore.rules allows
      //      a non-creator exactly one kind of update, appending themselves to
      //      memberUids. So for every other member this call was rejected with
      //      permission-denied on every single poll, silently swallowed by a
      //      bare .catch().
      //   2. Only write when it actually changed. Re-writing the same value
      //      every 15s burns quota and, when requests are being blocked, buries
      //      the console in ERR_BLOCKED_BY_CLIENT.
      const isOwner = !!session && !!room && room.createdBy === session.user.uid;
      if (found && effective && isOwner) {
        const next = `${symbol}:${effective}:${found.marketId}`;
        if (publishedRef.current !== next) {
          try {
            await setRoomActiveMarket(roomId, {
              symbol,
              window: effective,
              positionMarketId: found.marketId,
            });
            publishedRef.current = next;
            reportFirestoreOk();
          } catch (e) {
            // Don't cache on failure, so it retries on the next change.
            reportFirestoreError(e);
          }
        }
      }
    } catch (e) {
      if (isStale()) return;
      setErr(friendlyErrorLine(e));
    } finally {
      if (!isStale()) setLoading(false);
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

  // Never render a market that belongs to a different asset or window than the
  // toggles currently show. Belt to the request-id braces: even if a response
  // slips through, the card can't display BTC's prices under an ETH heading —
  // the mismatch resolves to "still loading" instead of to wrong numbers.
  const market =
    rawMarket && rawMarket.symbol === symbol && rawMarket.window === win ? rawMarket : null;

  const windowOptions = availableWindows(allMarkets, symbol).map((w) => ({ value: w, label: w }));
  const closed = !market || market.secondsLeft <= 0;
  const totalSec = market?.intervalSec && market.intervalSec > 0 ? market.intervalSec : 3600;

  const call = (direction: "up" | "down") => {
    if (!market || closed) {
      // Unreachable in practice — both buttons are disabled while closed, and
      // the note under them explains why. No Alert here: react-native-web's
      // Alert is a stub, so on the primary demo surface it would be a silent
      // no-op rather than a message.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
            <Icon name="back" size={20} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headKicker}>Room</Text>
            <Text style={styles.headTitle} numberOfLines={1}>{room?.name ?? "…"}</Text>
          </View>
          {/* Re-read the market on demand, so a stale card doesn't need a page
              reload. The calls feed and leaderboard are live listeners and don't
              need prompting. */}
          <Pressable
            onPress={() => { Haptics.selectionAsync(); loadMarket(); }}
            disabled={loading}
            accessibilityLabel="Refresh market"
            accessibilityRole="button"
            style={styles.back}
          >
            {loading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <Icon name="refresh" size={18} color={colors.textMuted} />
            )}
          </Pressable>
        </View>

        <View style={styles.pickers}>
          <Toggle options={SYMBOLS} value={symbol} onChange={setSymbol} compact />
          {windowOptions.length > 0 ? (
            <Toggle options={windowOptions} value={win} onChange={setWin} compact />
          ) : null}
        </View>

        {/* Market card */}
        <Animated.View entering={FadeIn.duration(280)}>
          <Card padded={20} elevated style={styles.market}>
            <LinearGradient colors={["rgba(197,248,42,0.07)", "transparent"]} style={StyleSheet.absoluteFill} />
            {!market && (loading || loadedFor !== symbol) && !err ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Reading live {symbol} markets on-chain…</Text>
              </View>
            ) : err ? (
              <View style={styles.noMarket}>
                <Text style={styles.err}>{err}</Text>
                <PillButton
                  label="Retry"
                  tone="ink"
                  size="sm"
                  onPress={loadMarket}
                  style={{ marginTop: spacing(3) }}
                />
              </View>
            ) : !market ? (
              <View style={styles.noMarket}>
                <Icon name="moon" size={30} color={colors.textFaint} style={{ marginBottom: 8 }} />
                <Text style={styles.noMarketTitle}>No live {symbol} windows</Text>
                <Text style={styles.noMarketBody}>
                  The venue rotates which series it runs and isn't quoting {symbol} right now. Try the
                  other asset, or check back shortly.
                </Text>
              </View>
            ) : (
              <View style={styles.marketRow}>
                <View style={{ flex: 1 }}>
                  {/* Stretch column: without align="start" the pill spans the full width. */}
                  <Chip label={closed ? "Locked" : "Live"} tone={closed ? "neutral" : "up"} icon="live" align="start" />
                  <Text style={styles.marketSym}>{symbol}</Text>
                  <Text style={styles.marketId} numberOfLines={1}>{market.label}</Text>
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
                <Icon name="sparkle" size={13} color={colors.accent} />
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
          <CallBtn label="UP" arrow="up" grad={colors.gradAccent} ink={colors.upInk} glow={colors.accentGlow} disabled={closed} onPress={() => call("up")} />
          <CallBtn label="DOWN" arrow="down" grad={colors.gradDown} ink="#fff" glow={colors.downGlow} disabled={closed} onPress={() => call("down")} />
        </View>
        {closed && market ? <Text style={styles.closedNote}>Waiting for the venue to roll the next window…</Text> : null}

        {/* Calls made in this room — pending included, newest first. */}
        <View style={styles.boardHead}>
          <Text style={styles.blockLabel}>Room calls</Text>
          {calls.length > 0 ? <Text style={styles.boardCount}>{calls.length}</Text> : null}
        </View>
        <Card padded={false}>
          {calls.length === 0 ? (
            <Text style={styles.boardEmpty}>No calls in this room yet. Make the first one.</Text>
          ) : (
            calls.slice(0, 12).map((c, i) => {
              const mine = !!session && c.uid === session.user.uid;
              const up = c.direction === "up";
              return (
                <View key={c.callId} style={[styles.crow, i > 0 && styles.browLine]}>
                  <Icon
                    name={up ? "up" : "down"}
                    size={15}
                    color={up ? colors.accent : colors.down}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cname} numberOfLines={1}>
                      {mine ? "You" : (names.get(c.uid) ?? "…")}
                    </Text>
                    <Text style={styles.cmeta}>
                      {c.symbol} {c.direction.toUpperCase()} · {c.window} · {c.stakeUsdso.toFixed(2)} tUSDC
                    </Text>
                  </View>
                  <Chip
                    label={c.status === "pending" ? "live" : c.status}
                    tone={
                      c.status === "won"
                        ? "up"
                        : c.status === "lost"
                          ? "down"
                          : c.status === "void"
                            ? "neutral"
                            : "gold"
                    }
                  />
                </View>
              );
            })
          )}
        </Card>

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
                <View style={styles.bstreakWrap}><Icon name="streak" size={12} color={colors.gold} /><Text style={styles.bstreak}>{e.currentStreak}</Text></View>
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
  label: string; arrow: IconName; grad: readonly [string, string];
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
        <Icon name={arrow} size={24} color={disabled ? colors.textFaint : ink} />
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
  loadingWrap: { alignItems: "center", gap: spacing(3), paddingVertical: spacing(9) },
  loadingText: { ...font.bodySm, color: colors.textFaint },
  err: { color: colors.down, textAlign: "center", lineHeight: 20 },
  noMarket: { alignItems: "center", paddingVertical: spacing(4) },
  noMarketTitle: { ...font.h3, color: colors.text },
  noMarketBody: { ...font.bodySm, color: colors.textFaint, marginTop: 4, textAlign: "center", lineHeight: 18 },

  ai: { marginBottom: spacing(4) },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing(1.5) },
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
  callLabel: { fontWeight: "900", fontSize: 19, letterSpacing: 0.6 },
  closedNote: { ...font.bodySm, color: colors.textFaint, textAlign: "center", marginBottom: spacing(2) },

  boardHead: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginTop: spacing(6) },
  boardCount: {
    ...font.label, color: colors.textFaint, backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill,
    overflow: "hidden", marginBottom: spacing(2.5),
  },
  boardEmpty: { ...font.bodySm, color: colors.textFaint, textAlign: "center", paddingVertical: spacing(7) },
  crow: { flexDirection: "row", alignItems: "center", gap: spacing(3), paddingVertical: spacing(3), paddingHorizontal: spacing(4) },
  cname: { color: colors.text, fontWeight: "800", fontSize: 14 },
  cmeta: { ...font.bodySm, fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
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
  bstreakWrap: { flexDirection: "row", alignItems: "center", gap: 3 },
  bstreak: { color: colors.gold, fontWeight: "800", fontSize: 13 },
  bxp: { ...font.mono, fontSize: 12, color: colors.textFaint, minWidth: 52, textAlign: "right" },
});
