import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
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
  recordCall,
} from "../lib/firestoreApi";
import {
  listLiveMarkets,
  availableWindows,
  askFor,
  quoteFor,
  type LiveMarketInfo,
} from "../lib/eventContracts";
import { bookQuality, payoutMultiple } from "../lib/quote";
import { CallSheet } from "../components/CallSheet";
import { PriceChart } from "../components/PriceChart";
import { callResultAmount } from "../lib/callOutcome";
import { fetchPriceSeries, type PriceSeries } from "../lib/priceFeed";
import { friendlyErrorLine } from "../lib/errors";
import { reportFirestoreError, reportFirestoreOk } from "../lib/firestoreHealth";
import { fetchSentiment } from "../lib/sentimentApi";
import type { CallDoc, Direction, LeaderboardEntryDoc, RoomDoc, Symbol_, WindowLength } from "../lib/types";
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
  const [price, setPrice] = useState<PriceSeries | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  /** Which direction is awaiting confirmation in the sheet, if any. */
  const [pending, setPending] = useState<Direction | null>(null);
  // The sheet clears `pending` before onPlaced runs, so hold the direction
  // separately for the record write.
  const pendingRef = useRef<Direction | null>(null);
  useEffect(() => { if (pending) pendingRef.current = pending; }, [pending]);
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

  // Recent price action for the asset being called, sized to the window.
  //
  // Cleared on symbol change rather than left to be overwritten, so the chart
  // can't show BTC's line under an ETH heading during the fetch — the same class
  // of stale-render the market card had to be guarded against.
  useEffect(() => {
    let dead = false;
    setPrice(null);
    setPriceLoading(true);
    fetchPriceSeries(symbol, win)
      .then((s) => { if (!dead) setPrice(s); })
      .catch(() => { if (!dead) setPrice(null); })
      .finally(() => { if (!dead) setPriceLoading(false); });
    // Refreshed on the same cadence as the market read; the module caches for
    // 20s so this doesn't actually hit the feed every time.
    const id = setInterval(() => {
      fetchPriceSeries(symbol, win).then((s) => { if (!dead) setPrice(s); }).catch(() => {});
    }, 20_000);
    return () => { dead = true; clearInterval(id); };
  }, [symbol, win]);

  // Never render a market that belongs to a different asset or window than the
  // toggles currently show. Belt to the request-id braces: even if a response
  // slips through, the card can't display BTC's prices under an ETH heading —
  // the mismatch resolves to "still loading" instead of to wrong numbers.
  const market =
    rawMarket && rawMarket.symbol === symbol && rawMarket.window === win ? rawMarket : null;

  // Whether the book supports reading a price as a likelihood at all.
  const quality = bookQuality(market ?? {});

  const windowOptions = availableWindows(allMarkets, symbol).map((w) => ({ value: w, label: w }));
  const closed = !market || market.secondsLeft <= 0;
  const totalSec = market?.intervalSec && market.intervalSec > 0 ? market.intervalSec : 3600;

  /** Potential return for a side, shown on its button. */
  const winLabel = (direction: Direction): string | null => {
    if (!market || closed) return null;
    const q = quoteFor(market, direction, stake);
    return q ? `win ${q.payout.toFixed(2)}` : "no bids";
  };

  const call = (direction: Direction) => {
    if (!market || closed) {
      // Unreachable in practice — the buttons are disabled while closed, and the
      // note under them explains why. No Alert here: react-native-web's Alert is
      // a stub, so on the primary demo surface it would be a silent no-op.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPending(direction);
  };

  /** Record the call and hand off to the result screen once it's on-chain. */
  const onPlaced = async (res: {
    txHash: string;
    positionId: string;
    stakeSpent: number;
    filledShares: number;
    fillPrice: number;
  }) => {
    if (!session || !market) return;
    setPending(null);
    try {
      const callId = await recordCall({
        roomId,
        uid: session.user.uid,
        symbol,
        direction: pendingRef.current ?? "up",
        window: win,
        stakeUsdso: res.stakeSpent,
        // Both are needed at settlement: the payout is shares x (1 - fee), which
        // cannot be reconstructed from the stake alone.
        shares: res.filledShares,
        entryPrice: res.fillPrice,
        txHash: res.txHash,
        positionId: res.positionId,
      });
      navigation.navigate("Result", { callId, roomId });
    } catch (e) {
      // The order is already on-chain at this point, so failing to record it is
      // a bookkeeping problem, not a lost call — surface it without implying the
      // call didn't happen.
      setErr(friendlyErrorLine(e));
      reportFirestoreError(e);
    }
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
                  {/* Payout multiple is the headline because it is always true:
                      it's arithmetic on the price you'd actually pay. The implied
                      chance sits underneath, and ONLY when the book is two-sided
                      and the asks roughly complement each other.
                      
                      On a one-sided book a lone 0.020 ask is not "a 2% chance" —
                      there's nothing on the other leg to cross-check it against,
                      so it means only "someone will sell at 0.020". Labelling
                      that as a chance on a 15-minute coin flip actively misleads. */}
                  <View style={styles.book}>
                    <View>
                      <Text style={styles.bookL}>Up pays</Text>
                      <Text style={styles.bookV}>{payoutMultiple(market.yesAsk)}</Text>
                      {quality.chanceIsMeaningful ? (
                        <Text style={styles.bookSub}>{pct(market.yesAsk)} chance</Text>
                      ) : null}
                    </View>
                    <View style={styles.bookSep} />
                    <View>
                      <Text style={styles.bookL}>Down pays</Text>
                      <Text style={styles.bookV}>{payoutMultiple(market.noAsk)}</Text>
                      {quality.chanceIsMeaningful ? (
                        <Text style={styles.bookSub}>{pct(market.noAsk)} chance</Text>
                      ) : null}
                    </View>
                  </View>

                  {!quality.chanceIsMeaningful ? (
                    <Text style={styles.thin}>
                      {quality.twoSided
                        ? "Thin book — the two sides don't line up, so these prices aren't a reliable read on likelihood."
                        : "Only one side is quoted right now, so the price reflects a single resting order rather than a market view."}
                    </Text>
                  ) : null}
                </View>
                <Countdown closesAtSec={Number(market.onchain.expiry)} totalSec={totalSec} onExpire={loadMarket} size={124} />
              </View>
            )}

            {/* Full card width, below the row — a sparkline squeezed into the
                column beside a 124px countdown ring is too narrow to read.
                Same oracle feed the momentum sentence uses, so the chart and the
                AI take can't contradict each other. */}
            {market && !err ? <PriceChart series={price} loading={priceLoading} /> : null}
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

        {/* Call buttons — each shows what this stake actually returns if right,
            which is the number people care about and the one that makes the
            asymmetry between the two sides self-explanatory. */}
        <View style={styles.calls}>
          <CallBtn
            label="UP"
            arrow="up"
            sub={winLabel("up")}
            grad={colors.gradAccent}
            ink={colors.upInk}
            glow={colors.accentGlow}
            disabled={closed || !market || askFor(market, "up") === undefined}
            onPress={() => call("up")}
          />
          <CallBtn
            label="DOWN"
            arrow="down"
            sub={winLabel("down")}
            grad={colors.gradDown}
            ink="#fff"
            glow={colors.downGlow}
            disabled={closed || !market || askFor(market, "down") === undefined}
            onPress={() => call("down")}
          />
        </View>
        {closed && market ? <Text style={styles.closedNote}>Waiting for the venue to roll the next window…</Text> : null}

        {/* Telegram link state. Shown to everyone rather than just the creator —
            any member can link the group they're in, and the code is a claim
            ticket rather than a secret (claiming it only redirects this room's
            own notifications). */}
        {room?.linkCode || room?.telegramChatId ? (
          <Card tone="raised" padded={14} style={{ marginTop: spacing(4) }}>
            {room?.telegramChatId ? (
              <View style={styles.tgRow}>
                <Icon name="check" size={15} color={colors.accent} />
                <Text style={styles.tgOn}>
                  Telegram linked — settled calls from this room post to that chat.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.tgRow}>
                  <Icon name="share" size={14} color={colors.textMuted} />
                  <Text style={styles.tgTitle}>Get results in your Telegram group</Text>
                </View>
                <Text style={styles.tgBody}>
                  Add <Text style={styles.tgMono}>@streak_r_bot</Text> to the group, then send:
                </Text>
                <Pressable
                  onPress={() => {
                    Clipboard.setStringAsync(`/link ${room?.linkCode}`);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 1500);
                  }}
                  style={styles.tgCode}
                >
                  <Text style={styles.tgCodeT}>/link {room?.linkCode}</Text>
                  <Text style={styles.tgCopy}>{copiedCode ? "copied" : "tap to copy"}</Text>
                </Pressable>
              </>
            )}
          </Card>
        ) : null}

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
              const amount = callResultAmount(c);
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
                      {/* The result in tUSDC, so the feed shows what a call was
                          worth and not just that it resolved. */}
                      {amount ? (
                        <Text style={c.status === "won" ? styles.cwin : styles.close}>  {amount}</Text>
                      ) : null}
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

      {/* Confirm in place, over the room — the countdown and book stay visible
          while the user answers "is this the bet I meant?". */}
      <CallSheet
        visible={pending !== null}
        market={market}
        direction={pending ?? "up"}
        stake={stake}
        onCancel={() => setPending(null)}
        onPlaced={onPlaced}
      />
    </Screen>
  );
}

/** An ask price as an implied percentage chance. */
function pct(price?: number): string {
  return price === undefined ? "—" : `${Math.round(price * 100)}%`;
}

function CallBtn({
  label, arrow, sub, grad, ink, glow, disabled, onPress,
}: {
  label: string; arrow: IconName; sub?: string | null; grad: readonly [string, string];
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
        <Icon name={arrow} size={22} color={disabled ? colors.textFaint : ink} />
        <Text style={[styles.callLabel, { color: disabled ? colors.textFaint : ink }]}>{label}</Text>
        <Text style={[styles.callSub, { color: disabled ? colors.textFaint : ink }]} numberOfLines={1}>
          {disabled ? "no liquidity" : (sub ?? " ")}
        </Text>
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
  bookSub: { ...font.bodySm, fontSize: 10.5, color: colors.textFaint, marginTop: 1 },
  bookSep: { width: 1, height: 34, backgroundColor: colors.border },
  thin: { ...font.bodySm, fontSize: 10.5, color: colors.gold, marginTop: spacing(2.5), lineHeight: 14.5 },
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
  callSub: { fontSize: 11.5, fontWeight: "800", opacity: 0.78, marginTop: 1 },
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
  cwin: { color: colors.accent, fontWeight: "800" },
  close: { color: colors.down, fontWeight: "800" },

  tgRow: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  tgTitle: { ...font.body, fontSize: 13.5, fontWeight: "800", color: colors.text },
  tgOn: { ...font.bodySm, fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 16.5 },
  tgBody: { ...font.bodySm, fontSize: 12, color: colors.textFaint, marginTop: spacing(2), lineHeight: 16.5 },
  tgMono: { ...font.mono, fontSize: 11.5, color: colors.textMuted },
  tgCode: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing(2.5), paddingHorizontal: spacing(3.5), marginTop: spacing(2.5),
  },
  tgCodeT: { ...font.mono, fontSize: 14, color: colors.accent, letterSpacing: 0.5 },
  tgCopy: { ...font.label, fontSize: 9.5, color: colors.textFaint },
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
