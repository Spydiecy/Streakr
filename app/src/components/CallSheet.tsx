import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ActivityIndicator } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, font, spacing } from "../theme";
import { Icon } from "./ui/Icon";
import { PillButton } from "./ui/PillButton";
import {
  placeCall,
  quoteFor,
  getCollateralBalance,
  mintTestCollateral,
  type LiveMarketInfo,
} from "../lib/eventContracts";
import { bookQuality } from "../lib/quote";
import { friendlyError, type FriendlyError } from "../lib/errors";
import { requestFaucet, HAS_FAUCET } from "../lib/faucetApi";
import { useWallet } from "../lib/WalletProvider";
import type { Direction } from "../lib/types";

interface Props {
  visible: boolean;
  market: LiveMarketInfo | null;
  direction: Direction;
  stake: number;
  onCancel: () => void;
  /** Called with the on-chain result once the order fills. */
  onPlaced: (res: {
    txHash: string;
    positionId: string;
    stakeSpent: number;
    filledShares: number;
    fillPrice: number;
  }) => void;
}

/**
 * Confirming a call in place, over the room.
 *
 * Previously this was a full screen push, which meant leaving the room to answer
 * one question — "is this the bet I meant?" — and losing sight of the countdown
 * and the book while answering it. A sheet keeps the market visible behind the
 * decision, which is the right shape for something that expires in minutes.
 */
export function CallSheet({ visible, market, direction, stake, onCancel, onPlaced }: Props) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [funding, setFunding] = useState(false);
  const [err, setErr] = useState<FriendlyError | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const isUp = direction === "up";
  const quote = market ? quoteFor(market, direction, stake) : null;
  const quality = bookQuality(market ?? {});

  const refreshBalance = useCallback(() => {
    if (!wallet.address) return;
    getCollateralBalance(wallet.address)
      .then((b) => setBalance(b.human))
      .catch(() => setBalance(null));
  }, [wallet.address]);

  // Read collateral when the sheet opens. Catching an empty wallet here means the
  // user never gets as far as approving a signature that cannot succeed.
  useEffect(() => {
    if (!visible) return;
    setErr(null);
    refreshBalance();
  }, [visible, refreshBalance]);

  const underfunded = balance !== null && balance < stake;

  const fund = async () => {
    if (!wallet.address) return;
    setFunding(true);
    setErr(null);
    try {
      let granted = false;
      if (HAS_FAUCET) granted = (await requestFaucet(wallet.address)).funded;
      // The server grant needs no gas; the on-chain faucet does, so it only
      // works as a fallback once gas has landed.
      if (!granted) await mintTestCollateral(await wallet.getSigner());
      await new Promise((r) => setTimeout(r, 4000));
      refreshBalance();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setFunding(false);
    }
  };

  const confirm = async () => {
    if (!market) return;
    setBusy(true);
    setErr(null);
    try {
      const signer = await wallet.getSigner();
      const res = await placeCall(signer, market, direction, stake);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPlaced(res);
    } catch (e) {
      const f = friendlyError(e);
      setErr(f);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (f.kind === "insufficient-collateral") refreshBalance();
    } finally {
      setBusy(false);
    }
  };

  const accent = isUp ? colors.accent : colors.down;
  const grad = isUp ? colors.gradAccent : colors.gradDown;
  const ink = isUp ? colors.upInk : "#fff";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <BlurView intensity={30} tint="dark" style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onCancel} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
              <Icon name={isUp ? "up" : "down"} size={26} color={ink} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {market?.symbol ?? "—"} <Text style={{ color: accent }}>{direction.toUpperCase()}</Text>
              </Text>
              <Text style={styles.sub}>
                {market?.window ?? "—"} window · closes in {fmtLeft(market?.secondsLeft ?? 0)}
              </Text>
            </View>
          </View>

          {/* Plain-language framing: risk this, win that. The multiple explains
              why the two sides differ without needing the price at all. */}
          <View style={styles.numbers}>
            <View style={styles.numBlock}>
              <Text style={styles.numL}>You risk</Text>
              <Text style={styles.numV}>{stake.toFixed(2)}</Text>
              <Text style={styles.numU}>tUSDC</Text>
            </View>
            <Icon name="forward" size={16} color={colors.textFaint} />
            <View style={styles.numBlock}>
              <Text style={styles.numL}>You win</Text>
              <Text style={[styles.numV, { color: accent }]}>
                {quote ? quote.payout.toFixed(2) : "—"}
              </Text>
              <Text style={styles.numU}>tUSDC</Text>
            </View>
          </View>

          <View style={styles.meta}>
            <Row
              label="Profit if right"
              value={quote ? `+${quote.profit.toFixed(2)} tUSDC (${quote.multiple.toFixed(2)}×)` : "—"}
            />
            <Row label="Loss if wrong" value={`−${stake.toFixed(2)} tUSDC`} />
            {/* Only call it a chance when the book can support that reading. On a
                one-sided book the price is just what one participant will sell
                at, so it's labelled as a price and the payout does the talking. */}
            <Row
              label={quality.chanceIsMeaningful ? "Implied chance" : "Price per share"}
              value={
                quote
                  ? quality.chanceIsMeaningful
                    ? `${Math.round(quote.price * 100)}%`
                    : quote.price.toFixed(3)
                  : "—"
              }
            />
            <Row
              label="Wallet"
              value={`${balance === null ? "…" : balance.toFixed(2)} tUSDC${
                wallet.label ? ` · ${wallet.label}` : ""
              }`}
            />
          </View>

          <View style={styles.risk}>
            <Icon name="shield" size={14} color={colors.accent} />
            <Text style={styles.riskT}>
              Downside is capped at your stake — the Event Contract can't take more.
            </Text>
          </View>

          {!quality.chanceIsMeaningful && quote ? (
            <Text style={styles.thin}>
              {quality.twoSided
                ? "Thin book — the two sides don't line up, so treat this price as one order rather than a market view."
                : "Only this side is quoted right now, so the price is a single resting order rather than a market view."}
            </Text>
          ) : null}

          {err ? (
            <View style={styles.note}>
              <Text style={styles.noteT}>{err.title}</Text>
              <Text style={styles.noteB}>{err.detail}</Text>
            </View>
          ) : underfunded ? (
            <View style={styles.note}>
              <Text style={styles.noteT}>Not enough tUSDC</Text>
              <Text style={styles.noteB}>
                This wallet holds {balance?.toFixed(2)} and the call needs {stake.toFixed(2)}.
              </Text>
            </View>
          ) : null}

          {underfunded || err?.kind === "insufficient-collateral" || err?.kind === "insufficient-gas" ? (
            <PillButton
              label={funding ? "Funding wallet…" : "Fund this wallet"}
              icon="add"
              tone="paper"
              size="md"
              full
              loading={funding}
              onPress={fund}
              style={{ marginTop: spacing(3) }}
            />
          ) : null}

          <PillButton
            label={busy ? "Signing…" : "Sign & place call"}
            icon="wallet"
            tone={isUp ? "accent" : "down"}
            size="lg"
            full
            loading={busy}
            disabled={!market || !quote || underfunded || funding}
            onPress={confirm}
            style={{ marginTop: spacing(3) }}
          />

          {!quote && market ? (
            <Text style={styles.hint}>
              Nobody is quoting this side right now, so the call can't fill. Try the other direction or
              another window.
            </Text>
          ) : null}

          <Pressable onPress={onCancel} disabled={busy} style={styles.cancel}>
            <Text style={styles.cancelT}>{busy ? "Submitting on-chain…" : "Cancel"}</Text>
          </Pressable>
        </View>
      </BlurView>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowL}>{label}</Text>
      <Text style={styles.rowV}>{value}</Text>
    </View>
  );
}

function fmtLeft(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h >= 1 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing(6),
    paddingTop: spacing(3),
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  grabber: {
    width: 42, height: 4, borderRadius: 2, backgroundColor: colors.borderBright,
    alignSelf: "center", marginBottom: spacing(4),
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing(3), marginBottom: spacing(5) },
  tile: { width: 52, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { ...font.h2, fontSize: 22, color: colors.text },
  sub: { ...font.bodySm, fontSize: 12, color: colors.textFaint, marginTop: 2 },

  numbers: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surfaceAlt, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing(4), paddingHorizontal: spacing(5),
  },
  numBlock: { alignItems: "center", flex: 1 },
  numL: { ...font.label, color: colors.textFaint, textTransform: "uppercase" },
  numV: { fontSize: 26, fontWeight: "900", color: colors.text, marginTop: 3, fontVariant: ["tabular-nums"] },
  numU: { ...font.label, color: colors.textFaint, marginTop: 1 },

  meta: { marginTop: spacing(4), gap: spacing(2) },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowL: { ...font.bodySm, color: colors.textFaint },
  rowV: { ...font.bodySm, color: colors.text, fontWeight: "700" },

  risk: {
    flexDirection: "row", gap: spacing(2.5), alignItems: "center",
    backgroundColor: colors.accentWash, borderRadius: radius.md,
    padding: spacing(3), marginTop: spacing(4),
  },
  riskT: { ...font.bodySm, fontSize: 11.5, color: colors.textMuted, flex: 1, lineHeight: 16 },

  note: {
    backgroundColor: colors.downWash, borderRadius: radius.md,
    borderWidth: 1, borderColor: "rgba(255,90,64,0.28)",
    padding: spacing(3.5), marginTop: spacing(4),
  },
  noteT: { ...font.body, fontSize: 13.5, fontWeight: "800", color: colors.down },
  noteB: { ...font.bodySm, fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17 },

  thin: { ...font.bodySm, fontSize: 11, color: colors.gold, marginTop: spacing(3), lineHeight: 15 },
  hint: { ...font.bodySm, fontSize: 11.5, color: colors.textFaint, textAlign: "center", marginTop: spacing(2), lineHeight: 16 },
  cancel: { alignItems: "center", paddingVertical: spacing(3), marginTop: spacing(1) },
  cancelT: { ...font.body, color: colors.textFaint, fontWeight: "700" },
});
