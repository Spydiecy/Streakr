import React from "react";
import { View, Text, Modal, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { colors, radius, font, spacing } from "../../theme";
import { PillButton } from "./PillButton";

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirmation sheet.
 *
 * Exists because `Alert.alert` with buttons does not work on react-native-web —
 * the callbacks never fire, so a "Disconnect wallet?" confirm silently did
 * nothing on the web build (which is Streakr's primary demo surface). This
 * renders real pressables, so it behaves identically on web and native.
 *
 * Plain informational Alerts are fine to keep; it's specifically the
 * multi-button / callback form that doesn't survive the web target.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <BlurView intensity={26} tint="dark" style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <PillButton
            label={confirmLabel}
            onPress={onConfirm}
            tone={destructive ? "down" : "accent"}
            size="md"
            full
            style={{ marginTop: spacing(5) }}
          />
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing(6) },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.bgRaised,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(6),
  },
  title: { ...font.h3, color: colors.text, textAlign: "center" },
  body: { ...font.bodySm, color: colors.textMuted, textAlign: "center", marginTop: spacing(2), lineHeight: 19 },
  cancel: { alignItems: "center", paddingVertical: spacing(3), marginTop: spacing(1) },
  cancelText: { ...font.body, color: colors.textFaint, fontWeight: "700" },
});
