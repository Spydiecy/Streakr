import React, { useEffect, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { useWallet } from "../lib/WalletProvider";
import {
  findMarket,
  placeCall,
  getCollateralBalance,
  mintTestCollateral,
  type LiveMarketInfo,
} from "../lib/eventContracts";
import { recordCall } from "../lib/firestoreApi";
import { friendlyError, type FriendlyError } from "../lib/errors";
import { requestFaucet, HAS_FAUCET } from "../lib/faucetApi";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { PillButton } from "../components/ui/PillButton";
import { Icon } from "../components/ui/Icon";

type Props = NativeStackScreenProps<RootStackParamList, "CallConfirm">;

export default function CallConfirmScreen({ route, navigation }: Props) {
  const { roomId, symbol, window: win, direction, stakeUsdso } = route.params;
  const { session } = useSession();
  const wallet = useWallet();
  const [market, setMarket] = useState<LiveMarketInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FriendlyError | null>(null);
  /** tUSDC on hand; null until read. Drives the pre-sign funding warning. */
  const [balance, setBalance] = useState<number | null>(null);
  const [minting, setMinting] = useState(false);

  const isUp = direction === "up";
  const grad = isUp ? colors.gradAccent : colors.gradDown;
  const accent = isUp ? colors.accent : colors.down;
  const ink = isUp ? colors.upInk : "#fff";

  useEffect(() => {
    findMarket(symbol, win)
      .then(setMarket)
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [symbol, win]);

  // Read the wallet's collateral up front. Finding out about an empty wallet
  // from an ERC20InsufficientBalance revert means the user already approved a
  // signature and (on an external wallet) paid gas to learn it.
  const refreshBalance = useCallback(() => {
    if (!wallet.address) return;
    getCollateralBalance(wallet.address)
      .then((b) => setBalance(b.human))
      .catch(() => setBalance(null));
  }, [wallet.address]);

  useEffect(refreshBalance, [refreshBalance]);

  const underfunded = balance !== null && balance < stakeUsdso;

  /**
   * Get the wallet ready to trade.
   *
   * Order matters. The server faucet goes first because it needs nothing from
   * the wallet — an unfunded wallet has no STT, and STT is gas, so it cannot
   * send the collateral token's own `faucet()` transaction either. Only once gas
   * has landed is the on-chain mint usable, which is the fallback for an address
   * that already used its one server grant but has since spent the collateral.
   */
  const topUp = async () => {
    if (!wallet.address) return;
    setMinting(true);
    setErr(null);
    try {
      let granted = false;
      if (HAS_FAUCET) {
        const r = await requestFaucet(wallet.address);
        granted = r.funded;
      }

      if (!granted) {
        // Already used its grant (or no faucet configured) — fall back to the
        // public on-chain faucet, which works now that the wallet holds gas.
        const signer = await wallet.getSigner();
        await mintTestCollateral(signer);
      }

      // Give the transfers a moment to land before re-reading.
      await new Promise((r) => setTimeout(r, 4000));
      refreshBalance();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setMinting(false);
    }
  };

  // Price of the leg being bought, in its own probability terms.
  const entry = market
    ? isUp
      ? market.yesAsk
      : market.yesBid !== undefined
        ? 1 - market.yesBid
        : undefined
    : undefined;
  const payout = entry ? stakeUsdso / entry : null;

  const confirm = async () => {
    if (!market || !session) return;
    setBusy(true);
    setErr(null);
    try {
      const signer = await wallet.getSigner();
      const res = await placeCall(signer, market, direction, stakeUsdso);
      const callId = await recordCall({
        roomId,
        uid: session.user.uid,
        symbol, direction, window: win,
        stakeUsdso: res.stakeSpent,
        txHash: res.txHash,
        positionId: res.positionId,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace("Result", { callId, roomId });
    } catch (e) {
      const f = friendlyError(e);
      setErr(f);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // The inline block below already says this; a native Alert on top of it
      // is redundant on mobile and a no-op on react-native-web anyway.
      if (f.kind === "insufficient-collateral") refreshBalance();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen glow={isUp ? "accent" : "down"} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.root}>
        <Pressable onPress={() => navigation.goBack()} style={styles.close}>
          <Icon name="close" size={17} color={colors.textMuted} />
        </Pressable>

        <Animated.View entering={FadeInUp.duration(420).springify()} style={styles.hero}>
          <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dirTile}>
            <Icon name={isUp ? "up" : "down"} size={40} color={ink} />
          </LinearGradient>
          <Text style={styles.dirText}>
            {symbol} <Text style={{ color: accent }}>{direction.toUpperCase()}</Text>
          </Text>
          <Chip label={`${win} window`} tone="neutral" style={{ marginTop: spacing(2) }} />
        </Animated.View>

        <Animated.View entering={FadeIn.delay(140).duration(340)}>
          <Card tone="paper" padded={20} elevated>
            <Row label="Stake" value={`${stakeUsdso.toFixed(2)} tUSDC`} />
            <Row label="Entry price" value={entry ? entry.toFixed(3) : "—"} />
            <Row label="If you're right" value={payout ? `≈ ${payout.toFixed(2)} tUSDC` : "—"} strong />
            <Row label="If you're wrong" value={`−${stakeUsdso.toFixed(2)} tUSDC`} />

            <View style={styles.risk}>
              <Icon name="shield" size={16} color={colors.accentDeep} />
              <Text style={styles.riskText}>
                <Text style={styles.riskBold}>Capped risk, no liquidation.</Text> Your downside is exactly
                your stake — the Event Contract can't take more than that.
              </Text>
            </View>

            <View style={styles.signedBy}>
              <Text style={styles.signedByL}>Signing with</Text>
              <Text style={styles.signedByV}>
                {wallet.label ?? "—"}
                {wallet.address ? `  ·  ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ""}
              </Text>
            </View>
          </Card>
        </Animated.View>

        <View style={styles.footer}>
          {loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : !market ? (
            <ErrorNote
              title={err?.title ?? "No live window"}
              detail={
                err?.detail ?? `The venue isn't quoting a ${symbol} ${win} window right now — go back and pick another.`
              }
            />
          ) : (
            <>
              {err ? <ErrorNote title={err.title} detail={err.detail} /> : null}

              {/* Funding gate. Shown before signing rather than after failing. */}
              {underfunded && !err ? (
                <ErrorNote
                  title="Not enough tUSDC"
                  detail={`This wallet holds ${balance?.toFixed(2)} tUSDC and the call needs ${stakeUsdso.toFixed(2)}.`}
                />
              ) : null}

              {underfunded ||
              err?.kind === "insufficient-collateral" ||
              err?.kind === "insufficient-gas" ? (
                <PillButton
                  label={minting ? "Funding wallet…" : "Fund this wallet"}
                  icon="add"
                  tone="paper"
                  onPress={topUp}
                  loading={minting}
                  size="md"
                  full
                />
              ) : null}

              <PillButton
                label="Sign & Submit Call"
                icon="wallet"
                onPress={confirm}
                loading={busy}
                disabled={underfunded || minting}
                size="lg"
                full
                tone={isUp ? "accent" : "down"}
              />
            </>
          )}
          <Pressable onPress={() => navigation.goBack()} style={styles.cancel}>
            <Text style={styles.cancelT}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

/**
 * A failure the user can read. Headline plus one actionable sentence, on a
 * tinted panel so it registers as a state of the screen rather than as a stray
 * line of red text under the button.
 */
function ErrorNote({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.note}>
      <Icon name="close" size={14} color={colors.down} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.noteTitle}>{title}</Text>
        <Text style={styles.noteBody}>{detail}</Text>
      </View>
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowL}>{label}</Text>
      <Text style={[styles.rowV, strong && styles.rowVStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing(5), justifyContent: "space-between" },
  close: {
    width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  hero: { alignItems: "center", marginTop: spacing(3) },
  dirTile: {
    width: 84, height: 84, borderRadius: radius.lg,
    alignItems: "center", justifyContent: "center", marginBottom: spacing(4),
  },
  dirText: { ...font.h1, fontSize: 29, color: colors.text },

  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing(3) },
  rowL: { ...font.body, color: colors.paperMuted },
  rowV: { ...font.mono, fontSize: 15, color: colors.paperInk },
  rowVStrong: { fontSize: 17, fontWeight: "900" },

  risk: {
    flexDirection: "row", gap: spacing(3), alignItems: "flex-start",
    backgroundColor: "rgba(10,11,12,0.05)", borderRadius: radius.md,
    padding: spacing(3.5), marginTop: spacing(2),
  },
  riskText: { ...font.bodySm, color: colors.paperMuted, flex: 1, lineHeight: 18.5 },
  riskBold: { color: colors.paperInk, fontWeight: "800" },

  signedBy: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: spacing(4), paddingTop: spacing(3.5),
    borderTopWidth: 1, borderTopColor: "rgba(10,11,12,0.08)",
  },
  signedByL: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  signedByV: { ...font.bodySm, fontSize: 12, color: colors.paperInk, fontWeight: "700" },

  footer: { gap: spacing(3) },
  note: {
    flexDirection: "row", gap: spacing(2.5), alignItems: "flex-start",
    backgroundColor: colors.downWash, borderRadius: radius.md,
    borderWidth: 1, borderColor: "rgba(255,90,64,0.28)",
    padding: spacing(3.5),
  },
  noteTitle: { ...font.body, fontSize: 13.5, fontWeight: "800", color: colors.down },
  noteBody: { ...font.bodySm, fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17.5 },
  cancel: { alignItems: "center", paddingVertical: spacing(2) },
  cancelT: { ...font.body, color: colors.textFaint, fontWeight: "700" },
});
