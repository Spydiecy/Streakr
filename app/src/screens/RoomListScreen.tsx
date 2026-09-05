import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { createRoom, joinRoom, listPublicRooms } from "../lib/firestoreApi";
import type { RoomDoc } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { GradientButton } from "../components/ui/GradientButton";

type Props = NativeStackScreenProps<RootStackParamList, "RoomList">;

export default function RoomListScreen({ navigation }: Props) {
  const { profile, session } = useSession();
  const [rooms, setRooms] = useState<RoomDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listPublicRooms();
      setRooms(r);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleJoin = async (room: RoomDoc) => {
    if (!session) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!room.memberUids.includes(session.user.uid)) {
      await joinRoom(room.roomId, session.user.uid);
    }
    navigation.navigate("Room", { roomId: room.roomId });
  };

  const handleCreate = async () => {
    if (!session || !newRoomName.trim()) return;
    setCreating(true);
    try {
      const roomId = await createRoom({ name: newRoomName.trim(), isPublic, createdBy: session.user.uid });
      setModalOpen(false);
      setNewRoomName("");
      navigation.navigate("Room", { roomId });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.title}>{profile?.displayName ?? "…"}</Text>
        </View>
        <View style={styles.headerButtons}>
          <IconButton emoji="🏆" onPress={() => navigation.navigate("GlobalLeaderboard")} />
          <IconButton emoji="👤" onPress={() => navigation.navigate("Profile")} />
        </View>
      </View>

      <Animated.View entering={FadeInDown.duration(400)} style={styles.statsRow}>
        <StatPill icon="🔥" value={profile?.currentStreak ?? 0} label="streak" tone="primary" />
        <StatPill icon="⭐" value={profile?.xp ?? 0} label="XP" tone="gold" />
        <StatPill icon="🏅" value={profile?.badges?.length ?? 0} label="badges" tone="up" />
      </Animated.View>

      <Text style={styles.sectionTitle}>Public Rooms</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(r) => r.roomId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.text}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎯</Text>
              <Text style={styles.empty}>No public rooms yet.{"\n"}Create the first one.</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
              <Pressable onPress={() => handleJoin(item)}>
                {({ pressed }) => (
                  <Card style={[styles.roomCard, pressed && styles.roomCardPressed]}>
                    <View style={styles.roomIconWrap}>
                      <LinearGradient colors={colors.gradientPrimary} style={styles.roomIcon}>
                        <Text style={styles.roomIconText}>{item.name.charAt(0).toUpperCase()}</Text>
                      </LinearGradient>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.roomName}>{item.name}</Text>
                      <View style={styles.roomMetaRow}>
                        <Text style={styles.roomMeta}>
                          {item.memberUids.length} member{item.memberUids.length === 1 ? "" : "s"}
                        </Text>
                        {item.activeMarket ? (
                          <Badge label={`${item.activeMarket.symbol} · ${item.activeMarket.window}`} tone="primary" size="sm" />
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Card>
                )}
              </Pressable>
            </Animated.View>
          )}
        />
      )}

      <Animated.View entering={FadeIn.delay(200)} style={styles.fabWrap}>
        <GradientButton label="+ New Room" onPress={() => setModalOpen(true)} glow={colors.primaryGlow} />
      </Animated.View>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <BlurView intensity={40} tint="dark" style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Create a Room</Text>
            <TextInput
              style={styles.input}
              placeholder="Room name"
              placeholderTextColor={colors.textFaint}
              value={newRoomName}
              onChangeText={setNewRoomName}
            />
            <View style={styles.visibilityRow}>
              <Pressable
                style={[styles.visibilityOption, isPublic && styles.visibilityOptionActive]}
                onPress={() => setIsPublic(true)}
              >
                <Text style={[styles.visibilityText, isPublic && styles.visibilityTextActive]}>🌐 Public</Text>
              </Pressable>
              <Pressable
                style={[styles.visibilityOption, !isPublic && styles.visibilityOptionActive]}
                onPress={() => setIsPublic(false)}
              >
                <Text style={[styles.visibilityText, !isPublic && styles.visibilityTextActive]}>🔒 Private</Text>
              </Pressable>
            </View>
            <GradientButton
              label="Create Room"
              onPress={handleCreate}
              loading={creating}
              disabled={!newRoomName.trim()}
              size="lg"
              style={{ marginTop: spacing(4) }}
            />
            <Pressable onPress={() => setModalOpen(false)} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </BlurView>
      </Modal>
    </Screen>
  );
}

function IconButton({ emoji, onPress }: { emoji: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.iconButtonText}>{emoji}</Text>
    </Pressable>
  );
}

function StatPill({ icon, value, label, tone }: { icon: string; value: number; label: string; tone: "primary" | "gold" | "up" }) {
  const toneColor = tone === "primary" ? colors.primary : tone === "gold" ? colors.gold : colors.up;
  return (
    <Card style={styles.statPill} noPadding>
      <View style={styles.statContent}>
        <Text style={styles.statIcon}>{icon}</Text>
        <Text style={[styles.statValue, { color: toneColor }]}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: spacing(5),
    paddingTop: spacing(2),
  },
  greeting: { ...font.bodySm, color: colors.textFaint },
  title: { ...font.h1, fontSize: 26, color: colors.text, marginTop: 2 },
  headerButtons: { flexDirection: "row", gap: spacing(2) },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: { fontSize: 19 },
  statsRow: {
    flexDirection: "row",
    gap: spacing(2.5),
    paddingHorizontal: spacing(5),
    marginTop: spacing(5),
  },
  statPill: { flex: 1 },
  statContent: { alignItems: "center", paddingVertical: spacing(3) },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: "900" },
  statLabel: { ...font.caption, color: colors.textFaint, marginTop: 2, textTransform: "uppercase" },
  sectionTitle: {
    ...font.h3,
    color: colors.text,
    paddingHorizontal: spacing(5),
    marginTop: spacing(7),
    marginBottom: spacing(3),
  },
  list: { paddingHorizontal: spacing(5), paddingBottom: spacing(24), gap: spacing(3) },
  emptyState: { alignItems: "center", marginTop: spacing(12) },
  emptyEmoji: { fontSize: 40, marginBottom: spacing(2) },
  empty: { color: colors.textFaint, textAlign: "center", lineHeight: 20 },
  roomCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing(4),
    gap: spacing(3),
  },
  roomCardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  roomIconWrap: {},
  roomIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  roomIconText: { color: "#fff", fontWeight: "800", fontSize: 18 },
  roomName: { ...font.h3, color: colors.text, fontSize: 16 },
  roomMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginTop: 4 },
  roomMeta: { ...font.bodySm, color: colors.textFaint },
  chevron: { color: colors.textFaint, fontSize: 26, fontWeight: "300" },
  fabWrap: {
    position: "absolute",
    bottom: spacing(6),
    left: spacing(5),
    right: spacing(5),
  },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing(6),
    paddingTop: spacing(3),
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing(4),
  },
  modalTitle: { ...font.h2, color: colors.text, marginBottom: spacing(4) },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing(3),
  },
  visibilityRow: { flexDirection: "row", gap: spacing(2) },
  visibilityOption: {
    flex: 1,
    paddingVertical: spacing(3),
    borderRadius: radius.md,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visibilityOptionActive: {
    backgroundColor: "rgba(124,92,255,0.16)",
    borderColor: colors.primary,
  },
  visibilityText: { color: colors.textMuted, fontWeight: "700" },
  visibilityTextActive: { color: colors.primary },
  cancelButton: { marginTop: spacing(4), alignItems: "center", paddingVertical: spacing(2) },
  cancelText: { color: colors.textFaint, fontWeight: "600" },
});
