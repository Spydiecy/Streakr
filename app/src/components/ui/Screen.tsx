import React from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, Edge } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../theme";

interface Props {
  children: React.ReactNode;
  edges?: Edge[];
  glow?: "top" | "none";
}

/** Every screen sits on this: flat dark base + a soft radial-ish glow at the
 *  top so the app doesn't read as a plain black rectangle. */
export function Screen({ children, edges, glow = "top" }: Props) {
  return (
    <View style={styles.root}>
      {glow === "top" ? (
        <LinearGradient
          colors={["rgba(124,92,255,0.16)", "rgba(124,92,255,0)"]}
          style={styles.glow}
          pointerEvents="none"
        />
      ) : null}
      <SafeAreaView style={styles.safe} edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  safe: {
    flex: 1,
  },
});
