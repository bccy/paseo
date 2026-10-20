/**
 * The desk pet's settings sheet.
 *
 * Mirrors the upstream plugin's five `readPref` switches 1:1 — `chat` (bubbles),
 * `game` (mini-games), `particles` (emoji bursts), `pet` (show the pet at all)
 * and `zones` (head / belly / tail hit zones). It is deliberately a plain RN
 * Modal rather than a bottom sheet: the pet overlay lives above every screen
 * and must not depend on a specific screen's navigator.
 *
 * @module paseo/pets/settings-panel
 */

import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { DEFAULT_SETTINGS, type PetSettings } from "./pet-storage";

interface SettingsPanelProps {
  visible: boolean;
  settings: PetSettings;
  onChange: (next: PetSettings) => void;
  onClose: () => void;
}

interface ToggleRow {
  key: keyof PetSettings;
  label: string;
  hint: string;
}

const ROWS: readonly ToggleRow[] = [
  { key: "chat", label: "台词气泡", hint: "她说的话，带打字机效果" },
  { key: "zones", label: "分区互动", hint: "点头部 / 肚子 / 尾巴有不同反应" },
  { key: "particles", label: "粒子特效", hint: "互动时冒出星星和表情" },
  { key: "game", label: "小游戏入口", hint: "在菜单里显示戳泡泡和接点心" },
  { key: "pet", label: "显示看板娘", hint: "关掉后她就消失了" },
];

export function SettingsPanel({ visible, settings, onChange, onClose }: SettingsPanelProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>看板娘设置</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {ROWS.map((row) => (
              <View key={row.key} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowHint}>{row.hint}</Text>
                </View>
                <Switch
                  value={settings[row.key]}
                  onValueChange={(value) => onChange({ ...settings, [row.key]: value })}
                  trackColor={{ false: "#3a3f47", true: "#3d7eff" }}
                  thumbColor="#ffffff"
                />
              </View>
            ))}
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>天气 / 余额</Text>
                <Text style={styles.rowHint}>
                  Paseo 没有天气与 DeepSeek 余额数据源，这两项不实现
                </Text>
              </View>
            </View>
          </ScrollView>
          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Exported so the overlay can fall back when a stored save is partial. */
export const FALLBACK_SETTINGS: PetSettings = DEFAULT_SETTINGS;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    padding: 28,
  },
  sheet: {
    borderRadius: 16,
    backgroundColor: "#1c2026",
    paddingVertical: 14,
    paddingHorizontal: 16,
    maxHeight: "80%",
  },
  title: {
    color: "#e8edf4",
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 10,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2b3038",
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: "#dfe6ef",
    fontSize: 14,
  },
  rowHint: {
    color: "#8b94a1",
    fontSize: 12,
    marginTop: 2,
  },
  close: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#2b3038",
    alignItems: "center",
  },
  closeText: {
    color: "#dfe6ef",
    fontSize: 14,
    fontWeight: "500",
  },
});
