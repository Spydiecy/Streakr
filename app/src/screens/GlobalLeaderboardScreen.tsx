import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { subscribeLeaderboard } from "../lib/firestoreApi";
import type { LeaderboardEntryDoc } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";

type Props = NativeStackScreenProps<RootStackParamList, "GlobalLeaderboard">;

const PODIUM = [
  { grad: colors.gradAccent, ink: colors.onAccent, h: 108 },
  { grad: ["#dfe5ec", "#b9c2cd"] as const, ink: "#20242a", h: 84 },
  { grad: ["#e0a56a", "#c07f42"] as const, ink: "#2a1a08", h: 68 },
];

export default function GlobalLeaderboardScreen({ navigation }: Props) {
  const [rows, setRows] = useState<LeaderboardEntryDoc[]>([]);
  useEffect(() => subscribeLeaderboard("global", setRows, 100), []);

  const top = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.head}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Global</Text>
          <Text style={styles.title}>Leaderboard</Text>
        </View>
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyGlyph}>🏆</Text>
          <Text style={styles.emptyTitle}>Nothing settled yet</Text>
          <Text style={styles.emptyBody}>Be the first to land a call.</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(e) => e.uid}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Animated.View entering={FadeInDown.duration(420)} style={styles.podium}>
              {[top[1], top[0], top[2]].map((e, i) => {
                const place = i === 1 ? 0 : i === 0 ? 1 : 2;
                if (!e) return <View key={`gap-${i}`} style={{ flex: 1 }} />;
                const p = PODIUM[place];
                return (
                  <View key={e.uid} style={styles.spot}>
                    <View style={styles.spotAvatarWrap}>
                      <LinearGradient colors={p.grad} style={styles.spotAvatar}>
                        <Text style={[styles.spotAvatarT, { color: p.ink }]}>
                          {e.displayName.charAt(0).toUpperCase()}
                        </Text>
                      </LinearGradient>
                    </View>
                    <Text style={styles.spotName} numberOfLines={1}>{e.displayName}</Text>
                    <Text style={styles.spotStreak}>🔥{e.currentStreak}</Text>
                    <LinearGradient colors={p.grad} style={[styles.bar, { height: p.h }]}>
                      <Text style={[styles.barN, { color: p.ink }]}>{place + 1}</Text>
                    </LinearGradient>
                  </View>
                );
              })}
            </Animated.View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 35).duration(300)}>
              <Card padded={false} style={styles.row}>
                <View style={styles.rowInner}>
                  <Text style={styles.rank}>{index + 4}</Text>
                  <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                  <Text style={styles.streak}>🔥{item.currentStreak}</Text>
                  <Text style={styles.xp}>{item.xp} XP</Text>
                </View>
              </Card>
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: spacing(3), paddingHorizontal: spacing(5), paddingTop: spacing(2), paddingBottom: spacing(3) },
  back: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  backGlyph: { color: colors.text, fontSize: 22, marginTop: -3 },
  kicker: { ...font.label, color: colors.textFaint, textTransform: "uppercase" },
  title: { ...font.h2, color: colors.text, marginTop: 1 },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing(1) },
  emptyGlyph: { fontSize: 38, marginBottom: spacing(2) },
  emptyTitle: { ...font.h3, color: colors.text },
  emptyBody: { ...font.bodySm, color: colors.textFaint },

  list: { paddingHorizontal: spacing(5), paddingBottom: spacing(10), gap: spacing(2) },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: spacing(2), marginTop: spacing(3), marginBottom: spacing(7) },
  spot: { flex: 1, alignItems: "center" },
  spotAvatarWrap: { marginBottom: spacing(2) },
  spotAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  spotAvatarT: { fontWeight: "900", fontSize: 17 },
  spotName: { color: colors.text, fontSize: 11.5, fontWeight: "800", maxWidth: 80 },
  spotStreak: { color: colors.gold, fontSize: 11.5, fontWeight: "800", marginTop: 2, marginBottom: spacing(2) },
  bar: {
    width: "100%", borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    alignItems: "center", paddingTop: spacing(2),
  },
  barN: { fontWeight: "900", fontSize: 17 },

  row: {},
  rowInner: { flexDirection: "row", alignItems: "center", padding: spacing(3.5), gap: spacing(2.5) },
  rank: { ...font.label, color: colors.textFaint, width: 24, fontSize: 12 },
  name: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 14 },
  streak: { color: colors.gold, fontWeight: "800", fontSize: 13 },
  xp: { ...font.mono, fontSize: 12, color: colors.textFaint, minWidth: 52, textAlign: "right" },
});
