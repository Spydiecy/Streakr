import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, radius, font, spacing } from "../theme";
import { Icon } from "./ui/Icon";
import { getClaimableShares, claimCall } from "../lib/eventContracts";
import { friendlyError } from "../lib/errors";
import { useWallet } from "../lib/WalletProvider";
import type { CallDoc } from "../lib/types";

/**
 * The claim step for a won call.
 *
 * A resolved Event Contract does NOT pay out on its own. The winning position
 * doesn't decay into collateral — the tokens sit in the wallet until they're
 * burned for the collateral behind them. So a won call showed a payout while the
 * balance never moved, which reads exactly like the money going missing. This is
 * the missing step.
 *
 * Renders nothing once there's nothing left to claim, so a fully-claimed history
 * stays quiet rather than showing dead buttons.
 */
export function ClaimRow({ call, onClaimed }: { call: CallDoc; onClaimed?: () => void }) {
  const wallet = useWallet();
  const [shares, setShares] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet.address || call.status !== "won") return;
    try {
      const r = await getClaimableShares(wallet.address, call.positionId, call.direction);
      setShares(r.shares);
    } catch {
      // A failed read shouldn't render a claim button that can't work.
      setShares(0);
    }
  }, [wallet.address, call.positionId, call.direction, call.status]);

  useEffect(() => { refresh(); }, [refresh]);

  const claim = async () => {
    setBusy(true);
    setErr(null);
    try {
      const signer = await wallet.getSigner();
      const res = await claimCall(signer, call.positionId, call.direction);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(res.claimed);
      setShares(0);
      onClaimed?.();
    } catch (e) {
      const f = friendlyError(e);
      setErr(`${f.title} — ${f.detail}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  if (call.status !== "won") return null;

  if (done !== null) {
    return (
      <View style={styles.doneRow}>
        <Icon name="check" size={13} color={colors.accent} />
        <Text style={styles.doneT}>Claimed {done.toFixed(2)} tUSDC into your wallet</Text>
      </View>
    );
  }

  // null = still reading; 0 = already redeemed.
  if (shares === null || shares <= 0.000001) return null;

  return (
    <View>
      <Pressable onPress={claim} disabled={busy} style={styles.btn}>
        {busy ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <>
            <Icon name="wallet" size={13} color={colors.onAccent} />
            <Text style={styles.btnT}>Claim {shares.toFixed(2)} tUSDC</Text>
          </>
        )}
      </Pressable>
      {err ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing(3.5),
    marginTop: spacing(2),
  },
  btnT: { fontSize: 12, fontWeight: "900", color: colors.onAccent },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing(2) },
  doneT: { ...font.bodySm, fontSize: 11.5, color: colors.accent, fontWeight: "700" },
  err: { ...font.bodySm, fontSize: 11, color: colors.down, marginTop: spacing(1.5), lineHeight: 15 },
});
