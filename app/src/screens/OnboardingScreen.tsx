import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useSession } from "../lib/SessionContext";
import { colors, radius, font, spacing } from "../theme";
import { Screen } from "../components/ui/Screen";
import { Card } from "../components/ui/Card";
import { GradientButton } from "../components/ui/GradientButton";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

const FEATURES = [
  { emoji: "⚡", text: "Real on-chain calls, settled automatically" },
  { emoji: "🔥", text: "Streaks, XP, and badges with friends" },
  { emoji: "🛡️", text: "Capped risk — never lose more than your stake" },
];

export default function OnboardingScreen({ navigation }: Props) {
  const { loading, error, session, refresh } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await refresh(displayName);
      navigation.replace("RoomList");
    } catch (e) {
      Alert.alert("Couldn't connect", (e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    if (!loading && session) navigation.replace("RoomList");
  }, [loading, session]);

  return (
    <Screen glow="none">
      <LinearGradient colors={colors.gradientHero} style={styles.heroGradient} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInDown.duration(500).springify()} style={styles.hero}>
            <View style={styles.logoBadge}>
              <LinearGradient colors={colors.gradientPrimary} style={styles.logoGradient}>
                <Text style={styles.logoEmoji}>🔥</Text>
              </LinearGradient>
            </View>
            <Text style={styles.logo}>Streakr</Text>
            <Text style={styles.tagline}>
              Call BTC or ETH. Up or Down.{"\n"}Real calls, real streaks.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeIn.delay(200).duration(500)} style={styles.features}>
            {FEATURES.map((f, i) => (
              <View key={f.text} style={styles.featureRow}>
                <Text style={styles.featureEmoji}>{f.emoji}</Text>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(300).duration(500).springify()}>
            <Card style={styles.card}>
              <Text style={styles.label}>Display name (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. satoshi_sim"
                placeholderTextColor={colors.textFaint}
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <GradientButton
                label="Connect Wallet"
                onPress={handleConnect}
                loading={connecting}
                size="lg"
                glow={colors.primaryGlow}
                style={{ marginTop: spacing(2) }}
              />

              <Text style={styles.disclaimer}>
                Creates a Somnia testnet wallet on this device and signs you in. Every call you make is a
                real, wallet-signed transaction on DreamDEX Event Contracts — testnet funds only.
              </Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </Card>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 420,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(6),
    paddingBottom: spacing(10),
  },
  hero: {
    alignItems: "center",
    marginBottom: spacing(8),
  },
  logoBadge: {
    marginBottom: spacing(4),
  },
  logoGradient: {
    width: 76,
    height: 76,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  logoEmoji: {
    fontSize: 36,
  },
  logo: {
    ...font.h1,
    fontSize: 40,
    color: colors.text,
  },
  tagline: {
    ...font.body,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing(2),
    lineHeight: 22,
  },
  features: {
    marginBottom: spacing(8),
    gap: spacing(3),
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(3),
  },
  featureEmoji: {
    fontSize: 20,
    width: 32,
    textAlign: "center",
  },
  featureText: {
    ...font.body,
    color: colors.textMuted,
    flex: 1,
  },
  card: {
    padding: spacing(6),
  },
  label: {
    ...font.caption,
    color: colors.textMuted,
    marginBottom: spacing(2),
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(3.5),
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disclaimer: {
    marginTop: spacing(4),
    fontSize: 12,
    color: colors.textFaint,
    lineHeight: 17,
    textAlign: "center",
  },
  errorText: {
    marginTop: spacing(2),
    color: colors.down,
    fontSize: 13,
    textAlign: "center",
  },
});
