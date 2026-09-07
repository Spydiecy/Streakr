import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { useWallet } from "../lib/WalletProvider";
import { subscribeUserCalls } from "../lib/firestoreApi";
import { BADGE_META, type BadgeKey, type CallDoc } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { PillButton } from "../components/ui/PillButton";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const { session, profile } = useSession();
  const wallet = useWallet();
  const [calls, setCalls] = useState<CallDoc[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session) return;
    return subscribeUserCalls(session.user.uid, setCalls);
  }, [session]);

  const copy = async () => {
    if (!wallet.address) return;
    await Clipboard.setStringAsync(wallet.address);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const settled = calls.filter((c) => c.status !== "pending");
  const wins = settled.filter((c) => c.status === "won").length;
  const rate = settled.length ? Math.round((wins / settled.length) * 100) : 0;

  const disconnect = () => {
    Alert.alert("Disconnect wallet?", "You can reconnect any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await wallet.disconnect();
          navigation.reset({ index: 0, routes: [{ name: "Onboarding" }] });
        },
      },
    ]);
  };

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.head}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.headTitle}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Identity */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <Card tone="paper" padded={20} elevated style={{ alignItems: "center" }}>
            <LinearGradient colors={colors.gradAccent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
              <Text style={styles.avatarT}>{(profile?.displayName ?? "?").charAt(0).toUpperCase()}</Text>
            </LinearGradient>
            <Text style={styles.name}>{profile?.displayName ?? "…"}</Text>
            {wallet.label ? <Chip label={wallet.label} tone="onPaper" icon="◈" style={{ marginTop: spacing(2) }} /> : null}
            <Pressable onPress={copy} style={styles.addrWrap}>
              <Text style={styles.addr}>
                {wallet.address ? `${wallet.address.slice(0, 10)}…${wallet.address.slice(-8)}` : "—"}
              </Text>
              <Text style={styles.copy}>{copied ? "✓ copied" : "tap to copy"}</Text>
            </Pressable>

            <View style={styles.stats}>
              <Stat v={profile?.currentStreak ?? 0} l="Streak" glyph="🔥" />
              <View style={styles.sep} />
              <Stat v={profile?.bestStreak ?? 0} l="Best" glyph="🏆" />
              <View style={styles.sep} />
              <Stat v={profile?.xp ?? 0} l="XP" glyph="⭐" />
              <View style={styles.sep} />
              <Stat v={`${rate}%`} l="Win rate" glyph="🎯" />
            </View>
          </Card>
        </Animated.View>

        {/* Badges */}
        <Text style={styles.section}>Badges</Text>
        <View style={styles.grid}>
          {(Object.keys(BADGE_META) as BadgeKey[]).map((k, i) => {
            const got = profile?.badges?.includes(k) ?? false;
            const meta = BADGE_META[k];
            return (
              <Animated.View key={k} entering={FadeInDown.delay(120 + i * 45).duration(320)} style={styles.gridItem}>
                <Card
                  tone={got ? "accentSoft" : "surface"}
                  padded={12}
                  style={[styles.badge, !got && styles.badgeOff]}
                >
                  <Text style={[styles.badgeGlyph, !got && { opacity: 0.45 }]}>{meta.icon}</Text>
                  <Text style={[styles.badgeL, got ? styles.badgeLOn : styles.badgeLOff]} numberOfLines={2}>
                    {meta.label}
                  </Text>
                </Card>
              </Animated.View>
            );
          })}
        </View>

        {/* History */}
        <Text style={styles.section}>Call history</Text>
        <Card padded={false}>
          {calls.length === 0 ? (
            <Text style={styles.empty}>No calls yet.</Text>
          ) : (
            calls.map((c, i) => (
              <View key={c.callId} style={[styles.hrow, i > 0 && styles.hline]}>
                <Text style={[styles.harrow, { color: c.direction === "up" ? colors.accent : colors.down }]}>
                  {c.direction === "up" ? "▲" : "▼"}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hsym}>{c.symbol}</Text>
                  <Text style={styles.hwin}>{c.window} · {c.stakeUsdso.toFixed(2)} tUSDC</Text>
                </View>
                <Chip
                  label={c.status}
                  tone={c.status === "won" ? "up" : c.status === "lost" ? "down" : c.status === "void" ? "neutral" : "gold"}
                />
              </View>
            ))
          )}
        </Card>

        <PillButton label="Disconnect wallet" tone="ink" onPress={disconnect} full style={{ marginTop: spacing(7) }} />
      </ScrollView>
    </Screen>
  );
}

function Stat({ v, l, glyph }: { v: number | string; l: string; glyph: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statGlyph}>{glyph}</Text>
      <Text style={styles.statV}>{v}</Text>
      <Text style={styles.statL}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing(5), paddingTop: spacing(2), paddingBottom: spacing(3) },
  back: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  backGlyph: { color: colors.text, fontSize: 22, marginTop: -3 },
  headTitle: { ...font.h3, color: colors.text, flex: 1, textAlign: "center" },
  scroll: { paddingHorizontal: spacing(5), paddingBottom: spacing(12) },

  avatar: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  avatarT: { fontSize: 32, fontWeight: "900", color: colors.onAccent },
  name: { ...font.h2, color: colors.paperInk, marginTop: spacing(3) },
  addrWrap: { alignItems: "center", marginTop: spacing(2) },
  addr: { ...font.mono, fontSize: 12, color: colors.paperMuted },
  copy: { fontSize: 10.5, fontWeight: "800", color: colors.accentDeep, marginTop: 3, textTransform: "uppercase" },

  stats: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing(5), paddingTop: spacing(4),
    borderTopWidth: 1, borderTopColor: "rgba(10,11,12,0.08)", alignSelf: "stretch",
  },
  stat: { alignItems: "center", flex: 1 },
  statGlyph: { fontSize: 15, marginBottom: 3 },
  statV: { fontSize: 18, fontWeight: "900", color: colors.paperInk },
  statL: { fontSize: 9.5, fontWeight: "800", color: colors.paperMuted, textTransform: "uppercase", marginTop: 1 },
  sep: { width: 1, height: 30, backgroundColor: "rgba(10,11,12,0.1)" },

  section: { ...font.h3, color: colors.text, marginTop: spacing(7), marginBottom: spacing(3) },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(2.5) },
  gridItem: { width: "31%" },
  badge: { alignItems: "center" },
  badgeOff: { opacity: 0.5 },
  badgeGlyph: { fontSize: 24 },
  badgeL: { fontSize: 10, textAlign: "center", marginTop: 6, fontWeight: "800" },
  badgeLOn: { color: colors.accentDeep },
  badgeLOff: { color: colors.textFaint },

  empty: { ...font.bodySm, color: colors.textFaint, textAlign: "center", paddingVertical: spacing(7) },
  hrow: { flexDirection: "row", alignItems: "center", gap: spacing(3), padding: spacing(4) },
  hline: { borderTopWidth: 1, borderTopColor: colors.border },
  harrow: { fontSize: 15, fontWeight: "900" },
  hsym: { color: colors.text, fontWeight: "800", fontSize: 14 },
  hwin: { ...font.bodySm, fontSize: 11.5, color: colors.textFaint, marginTop: 1 },
});
