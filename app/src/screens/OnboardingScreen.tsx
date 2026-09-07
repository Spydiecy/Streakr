import React, { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useWallet } from "../lib/WalletProvider";
import { useSession } from "../lib/SessionContext";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { PillButton } from "../components/ui/PillButton";
import { IconTile } from "../components/ui/IconTile";
import { Icon } from "../components/ui/Icon";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

const PERKS = [
  { icon: "bolt" as const, tone: "accent" as const, title: "Real on-chain calls", body: "Signed on DreamDEX, settled automatically" },
  { icon: "streak" as const, tone: "gold" as const, title: "Streaks & badges", body: "Build a run, climb the room board" },
  { icon: "shield" as const, tone: "ink" as const, title: "Capped downside", body: "Never lose more than your stake" },
];

export default function OnboardingScreen({ navigation }: Props) {
  const wallet = useWallet();
  const { session, error, setDisplayName } = useSession();
  const [name, setName] = useState("");

  // Once a wallet is connected AND the Firebase session is attached, go in.
  useEffect(() => {
    if (wallet.isConnected && session) navigation.replace("RoomList");
  }, [wallet.isConnected, session, navigation]);

  const handleConnect = () => {
    if (name.trim()) setDisplayName(name.trim());
    wallet.connect();
  };

  const handleDemo = () => {
    if (name.trim()) setDisplayName(name.trim());
    wallet.useEmbedded();
  };

  return (
    <Screen glow="none" hero>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(500).springify()} style={styles.brandBlock}>
            <LinearGradient colors={colors.gradAccent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.mark}>
              <Icon name="streak" size={34} color={colors.onAccent} />
            </LinearGradient>
            <Text style={styles.wordmark}>Streakr</Text>
            <Text style={styles.tagline}>Call it. Own the streak.</Text>
            <Chip label="Somnia Testnet" tone="accent" icon="live" align="center" style={{ marginTop: spacing(3) }} />
          </Animated.View>

          <Animated.View entering={FadeIn.delay(180).duration(450)} style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p.title} style={styles.perkRow}>
                <IconTile icon={p.icon} tone={p.tone} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.perkTitle}>{p.title}</Text>
                  <Text style={styles.perkBody}>{p.body}</Text>
                </View>
              </View>
            ))}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(280).duration(450).springify()}>
            <Card tone="paper" padded={20} elevated>
              <Text style={styles.cardKicker}>Get started</Text>
              <Text style={styles.cardTitle}>Connect your wallet</Text>

              <TextInput
                style={styles.input}
                placeholder="Display name (optional)"
                placeholderTextColor={colors.paperMuted}
                value={name}
                onChangeText={setName}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <PillButton
                label={wallet.supportsExternal ? "Connect Wallet" : "Create Device Wallet"}
                icon="wallet"
                onPress={handleConnect}
                loading={wallet.connecting}
                size="lg"
                full
                style={{ marginTop: spacing(3) }}
              />

              {wallet.supportsExternal ? (
                <>
                  <View style={styles.orRow}>
                    <View style={styles.rule} />
                    <Text style={styles.orText}>or</Text>
                    <View style={styles.rule} />
                  </View>
                  <Pressable onPress={handleDemo} style={styles.demoBtn}>
                    <Text style={styles.demoText}>Use the pre-funded demo wallet</Text>
                  </Pressable>
                  <Text style={styles.demoHint}>
                    An external wallet won't hold Somnia testnet STT or tUSDC, so the demo wallet is the
                    fastest way to run a full call cycle.
                  </Text>
                </>
              ) : (
                <Text style={styles.demoHint}>
                  Creates a testnet wallet in this device's keychain. Every call is a real signed
                  transaction — testnet funds only.
                </Text>
              )}

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </Card>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing(6), paddingBottom: spacing(10) },
  brandBlock: { alignItems: "center", marginBottom: spacing(9) },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
  },
  markGlyph: { fontSize: 34 },
  wordmark: { ...font.display, color: colors.text, marginTop: spacing(4) },
  tagline: { ...font.body, color: colors.textMuted, marginTop: spacing(1) },
  perks: { gap: spacing(4), marginBottom: spacing(9) },
  perkRow: { flexDirection: "row", alignItems: "center", gap: spacing(3.5) },
  perkTitle: { ...font.h3, fontSize: 15, color: colors.text },
  perkBody: { ...font.bodySm, color: colors.textFaint, marginTop: 2 },
  cardKicker: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  cardTitle: { ...font.h2, color: colors.paperInk, marginTop: spacing(1.5), marginBottom: spacing(4) },
  input: {
    backgroundColor: "rgba(10,11,12,0.05)",
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.paperInk,
    fontSize: 15,
    fontWeight: "600",
  },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing(3), marginVertical: spacing(4) },
  rule: { flex: 1, height: 1, backgroundColor: "rgba(10,11,12,0.1)" },
  orText: { ...font.label, color: colors.paperMuted, textTransform: "uppercase" },
  demoBtn: { alignItems: "center", paddingVertical: spacing(2) },
  demoText: { ...font.body, color: colors.paperInk, fontWeight: "800", textDecorationLine: "underline" },
  demoHint: { marginTop: spacing(3), fontSize: 12, lineHeight: 17, color: colors.paperMuted, textAlign: "center" },
  error: { marginTop: spacing(3), color: colors.down, fontSize: 12.5, textAlign: "center" },
});
