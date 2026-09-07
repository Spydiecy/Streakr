import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, Pressable, StyleSheet, Modal, TextInput,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { useWallet } from "../lib/WalletProvider";
import { createRoom, joinRoom, listPublicRooms } from "../lib/firestoreApi";
import type { RoomDoc } from "../lib/types";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { PillButton } from "../components/ui/PillButton";
import { IconTile } from "../components/ui/IconTile";
import { Toggle } from "../components/ui/Toggle";

type Props = NativeStackScreenProps<RootStackParamList, "RoomList">;

export default function RoomListScreen({ navigation }: Props) {
  const { profile, session } = useSession();
  const wallet = useWallet();
  const [rooms, setRooms] = useState<RoomDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRooms(await listPublicRooms());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const join = async (room: RoomDoc) => {
    if (!session) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!room.memberUids.includes(session.user.uid)) await joinRoom(room.roomId, session.user.uid);
    navigation.navigate("Room", { roomId: room.roomId });
  };

  const create = async () => {
    if (!session || !roomName.trim()) return;
    setCreating(true);
    try {
      const id = await createRoom({
        name: roomName.trim(),
        isPublic: visibility === "public",
        createdBy: session.user.uid,
      });
      setOpen(false);
      setRoomName("");
      navigation.navigate("Room", { roomId: id });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Welcome back</Text>
          <Text style={styles.name} numberOfLines={1}>{profile?.displayName ?? "…"}</Text>
        </View>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); navigation.navigate("GlobalLeaderboard"); }}
          style={styles.iconBtn}
        >
          <Text style={styles.iconBtnGlyph}>🏆</Text>
        </Pressable>
        <Pressable
          onPress={() => { Haptics.selectionAsync(); navigation.navigate("Profile"); }}
          style={styles.iconBtn}
        >
          <Text style={styles.iconBtnGlyph}>👤</Text>
        </Pressable>
      </View>

      <FlatList
        data={rooms}
        keyExtractor={(r) => r.roomId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <>
            {/* Hero streak card — the one dominant element */}
            <Animated.View entering={FadeInDown.duration(420)}>
              <Card tone="paper" padded={20} elevated style={styles.heroCard}>
                <View style={styles.heroTop}>
                  <View>
                    <Text style={styles.heroKicker}>Current streak</Text>
                    <View style={styles.heroValueRow}>
                      <Text style={styles.heroValue}>{profile?.currentStreak ?? 0}</Text>
                      <Text style={styles.heroFlame}>🔥</Text>
                    </View>
                  </View>
                  <View style={styles.heroStats}>
                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatV}>{profile?.bestStreak ?? 0}</Text>
                      <Text style={styles.heroStatL}>Best</Text>
                    </View>
                    <View style={styles.heroDivider} />
                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatV}>{profile?.xp ?? 0}</Text>
                      <Text style={styles.heroStatL}>XP</Text>
                    </View>
                    <View style={styles.heroDivider} />
                    <View style={styles.heroStat}>
                      <Text style={styles.heroStatV}>{profile?.badges?.length ?? 0}</Text>
                      <Text style={styles.heroStatL}>Badges</Text>
                    </View>
                  </View>
                </View>
                {wallet.label ? (
                  <View style={styles.walletRow}>
                    <Chip
                      label={wallet.label}
                      tone={wallet.kind === "embedded" ? "onPaper" : "coral"}
                      icon="◈"
                    />
                    <Text style={styles.walletAddr}>
                      {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ""}
                    </Text>
                  </View>
                ) : null}
              </Card>
            </Animated.View>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Public rooms</Text>
              <Text style={styles.sectionCount}>{rooms.length}</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(8) }} />
          ) : (
            <Card style={styles.empty}>
              <Text style={styles.emptyGlyph}>🎯</Text>
              <Text style={styles.emptyTitle}>No rooms yet</Text>
              <Text style={styles.emptyBody}>Create the first one and invite your friends.</Text>
            </Card>
          )
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 55).duration(340)}>
            <Pressable onPress={() => join(item)}>
              {({ pressed }) => (
                <Card style={[styles.roomCard, pressed && styles.pressed]} padded={14}>
                  <IconTile glyph={item.name.charAt(0).toUpperCase()} tone={index % 2 ? "gold" : "accent"} size={46} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.roomMeta}>
                      <Text style={styles.roomMembers}>
                        {item.memberUids.length} member{item.memberUids.length === 1 ? "" : "s"}
                      </Text>
                      {item.activeMarket ? (
                        <Chip label={`${item.activeMarket.symbol} ${item.activeMarket.window}`} tone="accent" />
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Card>
              )}
            </Pressable>
          </Animated.View>
        )}
      />

      {/* Floating CTA */}
      <Animated.View entering={FadeIn.delay(160)} style={styles.fab}>
        <PillButton label="New Room" icon="＋" onPress={() => setOpen(true)} size="lg" full />
      </Animated.View>

      {/* Create sheet */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <BlurView intensity={30} tint="dark" style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>Create a room</Text>
            <TextInput
              style={styles.sheetInput}
              placeholder="Room name"
              placeholderTextColor={colors.textFaint}
              value={roomName}
              onChangeText={setRoomName}
              autoFocus
            />
            <Text style={styles.sheetLabel}>Visibility</Text>
            <Toggle
              options={[
                { value: "public", label: "🌐  Public" },
                { value: "private", label: "🔒  Private" },
              ]}
              value={visibility}
              onChange={setVisibility}
            />
            <PillButton
              label="Create room"
              onPress={create}
              loading={creating}
              disabled={!roomName.trim()}
              size="lg"
              full
              style={{ marginTop: spacing(5) }}
            />
            <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </BlurView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing(2),
    paddingHorizontal: spacing(5), paddingTop: spacing(2), paddingBottom: spacing(4),
  },
  kicker: { ...font.bodySm, color: colors.textFaint },
  name: { ...font.h1, fontSize: 25, color: colors.text, marginTop: 1 },
  iconBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  iconBtnGlyph: { fontSize: 18 },

  list: { paddingHorizontal: spacing(5), paddingBottom: spacing(26), gap: spacing(2.5) },

  heroCard: { marginBottom: spacing(6) },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroKicker: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  heroValueRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  heroValue: { fontSize: 52, fontWeight: "900", color: colors.paperInk, letterSpacing: -2 },
  heroFlame: { fontSize: 26 },
  heroStats: { flexDirection: "row", alignItems: "center", gap: spacing(2.5), marginTop: spacing(2) },
  heroStat: { alignItems: "center" },
  heroStatV: { fontSize: 17, fontWeight: "900", color: colors.paperInk },
  heroStatL: { fontSize: 10, fontWeight: "700", color: colors.paperMuted, textTransform: "uppercase", marginTop: 1 },
  heroDivider: { width: 1, height: 22, backgroundColor: "rgba(10,11,12,0.12)" },
  walletRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing(4), paddingTop: spacing(3.5),
    borderTopWidth: 1, borderTopColor: "rgba(10,11,12,0.08)",
  },
  walletAddr: { ...font.mono, fontSize: 12, color: colors.paperMuted },

  sectionRow: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginBottom: spacing(3) },
  sectionTitle: { ...font.h3, color: colors.text },
  sectionCount: {
    ...font.label, color: colors.textFaint, backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden",
  },

  roomCard: { flexDirection: "row", alignItems: "center", gap: spacing(3) },
  pressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
  roomName: { ...font.h3, fontSize: 15.5, color: colors.text },
  roomMeta: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginTop: 3 },
  roomMembers: { ...font.bodySm, fontSize: 12, color: colors.textFaint },
  chev: { color: colors.textFaint, fontSize: 24, fontWeight: "300" },

  empty: { alignItems: "center", paddingVertical: spacing(9) },
  emptyGlyph: { fontSize: 34, marginBottom: spacing(2) },
  emptyTitle: { ...font.h3, color: colors.text },
  emptyBody: { ...font.bodySm, color: colors.textFaint, marginTop: 4, textAlign: "center" },

  fab: { position: "absolute", bottom: spacing(7), left: spacing(5), right: spacing(5) },

  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    padding: spacing(6), paddingTop: spacing(3),
    borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
  },
  grabber: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.borderBright, alignSelf: "center", marginBottom: spacing(5) },
  sheetTitle: { ...font.h2, color: colors.text, marginBottom: spacing(4) },
  sheetInput: {
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing(4), paddingVertical: spacing(3.5),
    color: colors.text, fontSize: 15.5, fontWeight: "600",
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing(4),
  },
  sheetLabel: { ...font.label, color: colors.textFaint, textTransform: "uppercase", marginBottom: spacing(2) },
  cancel: { alignItems: "center", paddingVertical: spacing(3), marginTop: spacing(1) },
  cancelText: { ...font.body, color: colors.textFaint, fontWeight: "700" },
});
