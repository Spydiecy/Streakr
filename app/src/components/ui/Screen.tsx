import React from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../theme";
import { useResponsive } from "../../lib/useResponsive";

interface Props {
  children: React.ReactNode;
  edges?: Edge[];
  glow?: "accent" | "down" | "none";
  /** Stronger top wash, for the onboarding hero. Renders full-bleed. */
  hero?: boolean;
  constrain?: boolean;
}

/**
 * Screen base.
 *
 * Backdrop layers (glow / hero wash) render at the ROOT, full viewport width,
 * while content is capped to a readable column and centred on wide viewports.
 * Keeping them separate matters: an earlier version rendered the hero gradient
 * inside the constrained column, which on desktop showed up as a hard-edged
 * rectangle floating in the middle of the page instead of a wash.
 */
export function Screen({ children, edges, glow = "accent", hero, constrain = true }: Props) {
  const { isWide, contentMaxWidth } = useResponsive();

  const wash =
    glow === "accent"
      ? (["rgba(197,248,42,0.13)", "rgba(197,248,42,0)"] as const)
      : glow === "down"
        ? (["rgba(255,107,74,0.13)", "rgba(255,107,74,0)"] as const)
        : null;

  return (
    <View style={styles.root}>
      {hero ? <LinearGradient colors={colors.gradHero} style={styles.hero} pointerEvents="none" /> : null}
      {wash ? <LinearGradient colors={wash} style={styles.bloom} pointerEvents="none" /> : null}
      <SafeAreaView style={styles.safe} edges={edges}>
        <View
          style={[
            styles.column,
            constrain && isWide && { maxWidth: contentMaxWidth, width: "100%", alignSelf: "center" },
          ]}
        >
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { position: "absolute", top: 0, left: 0, right: 0, height: 520 },
  bloom: { position: "absolute", top: 0, left: 0, right: 0, height: 340 },
  safe: { flex: 1 },
  column: { flex: 1, width: "100%" },
});
