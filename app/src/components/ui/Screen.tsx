import React from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../theme";

interface Props {
  children: React.ReactNode;
  edges?: Edge[];
  glow?: "accent" | "down" | "none";
}

/** Screen base: near-black canvas with a soft accent bloom at the top so the
 *  app never reads as a flat black rectangle. */
export function Screen({ children, edges, glow = "accent" }: Props) {
  const wash =
    glow === "accent"
      ? (["rgba(197,248,42,0.13)", "rgba(197,248,42,0)"] as const)
      : glow === "down"
        ? (["rgba(255,107,74,0.13)", "rgba(255,107,74,0)"] as const)
        : null;

  return (
    <View style={styles.root}>
      {wash ? <LinearGradient colors={wash} style={styles.bloom} pointerEvents="none" /> : null}
      <SafeAreaView style={styles.safe} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bloom: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  safe: { flex: 1 },
});
