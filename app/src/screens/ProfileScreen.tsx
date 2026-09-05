import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { subscribeUserCalls } from "../lib/firestoreApi";
import type { CallDoc } from "../lib/types";
import { BADGE_META, type BadgeKey } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export default function ProfileScreen({ navigation }: Props) {
  const { session, profile } = useSession();
  const [calls, setCalls] = useState<CallDoc[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session) return;
    return subscribeUserCalls(session.user.uid, setCalls);
  }, [session]);

  const handleCopy = async () => {
    if (!session) return;
    await Clipboard.setStringAsync(session.wallet.address);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const winCount = calls.filter((c) => c.status === "won").length;
  const totalSettled = calls.filter((c) => c.status !== "pending").length;
  const winRate = totalSettled > 0 ? Math.round((winCount / totalSettled) * 100) : 0;

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.avatarSection}>
          <LinearGradient colors={colors.gradientPrimary} style={styles.avatar}>
            <Text style={styles.avatarText}>{(profile?.displayName ?? "?").charAt(0).toUpperCase()}</Text>
          </LinearGradient>
          <Text style={styles.displayName}>{profile?.displayName ?? "…"}</Text>
          <Pressable onPress={handleCopy} style={styles.walletRow}>
            <Text style={styles.walletAddress}>
              {session ? `${session.wallet.address.slice(0, 8)}…${session.wallet.address.slice(-6)}` : "…"}
            </Text>
            <Text style={styles.copyHint}>{copied ? "✓ copied" : "tap to copy"}</Text>
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.statsRow}>
          <Stat value={profile?.currentStreak ?? 0} label="Streak" emoji="🔥" />
          <Stat value={profile?.bestStreak ?? 0} label="Best" emoji="🏆" />
          <Stat value={profile?.xp ?? 0} label="XP" emoji="⭐" />
          <Stat value={`${winRate}%`} label="Win rate" emoji="🎯" />
        </Animated.View>

        <Text style={styles.sectionTitle}>Badges</Text>
        <View style={styles.badgeGrid}>
          {(Object.keys(BADGE_META) as BadgeKey[]).map((key, i) => {
            const earned = profile?.badges?.includes(key) ?? false;
            const meta = BADGE_META[key];
            return (
              <Animated.View key={key} entering={FadeInDown.delay(150 + i * 50).duration(350)} style={styles.badgeItem}>
                <Card style={[styles.badgeChip, !earned && styles.badgeChipDim]} noPadding>
                  <View style={styles.badgeChipInner}>
                    <Text style={[styles.badgeIcon, !earned && styles.dimOpacity]}>{meta.icon}</Text>
                    <Text style={[styles.badgeLabel, !earned && styles.badgeLabelDim]}>{meta.label}</Text>
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Call History</Text>
        <Card noPadding>
          <FlatList
            data={calls}
            keyExtractor={(c) => c.callId}
            scrollEnabled={false}
            ListEmptyComponent={<Text style={styles.emptyText}>No calls yet.</Text>}
            renderItem={({ item, index }) => (
              <View style={[styles.historyRow, index > 0 && styles.historyRowBorder]}>
                <View style={styles.historyLeft}>
                  <Text style={styles.historySymbol}>
                    {item.symbol} {item.direction === "up" ? "▲" : "▼"}
                  </Text>
                  <Text style={styles.historyWindow}>{item.window}</Text>
                </View>
                <View
                  style={[
                    styles.historyStatusPill,
                    item.status === "won" && styles.historyStatusWon,
                    item.status === "lost" && styles.historyStatusLost,
                  ]}
                >
                  <Text
                    style={[
                      styles.historyStatusText,
                      item.status === "won" && { color: colors.up },
                      item.status === "lost" && { color: colors.down },
                    ]}
                  >
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>
            )}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, emoji }: { value: number | string; label: string; emoji: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing(5), paddingTop: spacing(2) },
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
  title: { ...font.h3, color: colors.text, flex: 1, textAlign: "center" },
  scroll: { paddingHorizontal: spacing(5), paddingBottom: spacing(14) },
  avatarSection: { alignItems: "center", marginTop: spacing(4), marginBottom: spacing(6) },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing(3),
  },
  avatarText: { color: "#fff", fontSize: 34, fontWeight: "800" },
  displayName: { ...font.h2, color: colors.text },
  walletRow: { alignItems: "center", marginTop: spacing(1.5) },
  walletAddress: { color: colors.textFaint, fontSize: 13, fontVariant: ["tabular-nums"] },
  copyHint: { color: colors.primary, fontSize: 11, marginTop: 3, fontWeight: "600" },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing(7) },
  stat: { alignItems: "center", flex: 1 },
  statEmoji: { fontSize: 18, marginBottom: 4 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: "900" },
  statLabel: { color: colors.textFaint, fontSize: 11, marginTop: 2, textTransform: "uppercase" },
  sectionTitle: { ...font.h3, color: colors.text, marginBottom: spacing(3) },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(2.5), marginBottom: spacing(7) },
  badgeItem: { width: "30.5%" },
  badgeChip: { alignItems: "center" },
  badgeChipDim: { opacity: 0.4 },
  badgeChipInner: { alignItems: "center", paddingVertical: spacing(3.5) },
  badgeIcon: { fontSize: 26 },
  dimOpacity: { opacity: 0.5 },
  badgeLabel: { color: colors.text, fontSize: 10.5, marginTop: 6, textAlign: "center", fontWeight: "600" },
  badgeLabelDim: { color: colors.textFaint },
  emptyText: { color: colors.textFaint, textAlign: "center", paddingVertical: spacing(6) },
  historyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing(4) },
  historyRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  historyLeft: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  historySymbol: { color: colors.text, fontWeight: "700" },
  historyWindow: { color: colors.textFaint, fontSize: 12 },
  historyStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  historyStatusWon: { backgroundColor: colors.upDim },
  historyStatusLost: { backgroundColor: colors.downDim },
  historyStatusText: { color: colors.textFaint, fontWeight: "800", fontSize: 10.5 },
});
