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

const PODIUM_COLORS = [colors.gold, "#c0c6d4", "#c98a4b"];

export default function GlobalLeaderboardScreen({ navigation }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntryDoc[]>([]);

  useEffect(() => subscribeLeaderboard("global", setEntries, 100), []);

  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Leaderboard</Text>
        <View style={{ width: 36 }} />
      </View>

      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🏆</Text>
          <Text style={styles.emptyText}>No settled calls yet across any room.</Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(e) => e.uid}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            podium.length > 0 ? (
              <Animated.View entering={FadeInDown.duration(400)} style={styles.podiumRow}>
                {[podium[1], podium[0], podium[2]].map((entry, i) =>
                  entry ? <PodiumSpot key={entry.uid} entry={entry} place={i === 1 ? 1 : i === 0 ? 2 : 3} /> : <View key={i} style={{ flex: 1 }} />,
                )}
              </Animated.View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 40).duration(300)}>
              <Card style={styles.row} noPadding>
                <View style={styles.rowInner}>
                  <Text style={styles.rank}>{index + 4}</Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.displayName}
                  </Text>
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

function PodiumSpot({ entry, place }: { entry: LeaderboardEntryDoc; place: 1 | 2 | 3 }) {
  const height = place === 1 ? 120 : place === 2 ? 96 : 80;
  const color = PODIUM_COLORS[place - 1];
  return (
    <View style={styles.podiumSpot}>
      <View style={[styles.podiumAvatar, { borderColor: color }]}>
        <Text style={styles.podiumAvatarText}>{entry.displayName.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>
        {entry.displayName}
      </Text>
      <Text style={[styles.podiumStreak, { color }]}>🔥{entry.currentStreak}</Text>
      <LinearGradient
        colors={place === 1 ? colors.gradientGold : [color, color]}
        style={[styles.podiumBar, { height }]}
      >
        <Text style={styles.podiumPlace}>{place}</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing(5), paddingTop: spacing(2), marginBottom: spacing(2) },
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
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing(2) },
  emptyEmoji: { fontSize: 40 },
  emptyText: { color: colors.textFaint, textAlign: "center" },
  list: { paddingHorizontal: spacing(5), paddingBottom: spacing(10), gap: spacing(2) },
  podiumRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing(2), marginBottom: spacing(7), marginTop: spacing(2) },
  podiumSpot: { flex: 1, alignItems: "center" },
  podiumAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing(1.5),
  },
  podiumAvatarText: { color: colors.text, fontWeight: "800", fontSize: 18 },
  podiumName: { color: colors.text, fontSize: 12, fontWeight: "700", marginBottom: 2, maxWidth: 76 },
  podiumStreak: { fontSize: 12, fontWeight: "800", marginBottom: spacing(1.5) },
  podiumBar: {
    width: "100%",
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: spacing(1.5),
  },
  podiumPlace: { color: "#04140a", fontWeight: "900", fontSize: 18 },
  row: { marginBottom: spacing(1) },
  rowInner: { flexDirection: "row", alignItems: "center", padding: spacing(3.5), gap: spacing(2) },
  rank: { color: colors.textFaint, width: 28, fontWeight: "800", fontSize: 14 },
  name: { flex: 1, color: colors.text, fontWeight: "600" },
  streak: { color: colors.gold, marginRight: spacing(2), fontWeight: "700" },
  xp: { color: colors.textFaint, fontSize: 13 },
});
