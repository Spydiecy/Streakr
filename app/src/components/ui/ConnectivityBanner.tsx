import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { colors, radius, font, spacing } from "../../theme";
import { Icon } from "./Icon";
import { isFirestoreBlocked, subscribeFirestoreHealth } from "../../lib/firestoreHealth";

/**
 * One persistent line explaining that the database is unreachable.
 *
 * Exists because the failure it describes is otherwise invisible from inside the
 * app. When an ad or privacy blocker blocks firestore.googleapis.com, the
 * Firestore SDK behaves as if the device were offline: writes go into a local
 * queue and retry indefinitely, so nothing rejects in a way a screen would
 * naturally surface. The user sees rooms that won't save and a spinner that
 * never resolves, with the only real evidence buried in the browser console as
 * `net::ERR_BLOCKED_BY_CLIENT`.
 *
 * Blockers are common enough among the crypto-adjacent audience this app is for
 * that "your extension is doing this" is genuinely the most likely explanation,
 * and it's not something the app can work around — only name.
 */
export function ConnectivityBanner() {
  const [blocked, setBlocked] = useState(isFirestoreBlocked);

  useEffect(() => subscribeFirestoreHealth(setBlocked), []);

  if (!blocked) return null;

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Icon name="lock" size={13} color={colors.down} />
      <Text style={styles.text}>
        {Platform.OS === "web"
          ? "Can't reach the database — an ad or privacy blocker is likely blocking googleapis.com. Allow this site, then reload."
          : "Can't reach the database. Check your connection."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    marginHorizontal: spacing(3),
    marginBottom: spacing(2),
    paddingVertical: spacing(2.5),
    paddingHorizontal: spacing(3.5),
    borderRadius: radius.md,
    backgroundColor: colors.downWash,
    borderWidth: 1,
    borderColor: "rgba(255,90,64,0.3)",
  },
  text: { ...font.bodySm, fontSize: 12, color: colors.text, flex: 1, lineHeight: 16.5 },
});
