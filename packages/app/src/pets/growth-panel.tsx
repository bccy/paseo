/**
 * The growth / achievement sheet.
 *
 * Every number and label here comes out of `whale-moe-core.js`: `computeGrowth`
 * owns mood / affinity / satiety / level, `ACHIEVEMENTS` owns the 39 entries and
 * `computeWeekSignin` owns the weekly sign-in week. This file only draws them.
 *
 * @module paseo/pets/growth-panel
 */

import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

/** The shape the core module keeps under `growth`. */
export interface GrowthState {
  mood: number;
  affinity: number;
  satiety: number;
  lastSignin: string;
  signinStreak: number;
  achievements: string[];
  level: number;
}

export interface AchievementEntry {
  id: string;
  icon: string;
  name: string;
  desc: string;
}

interface GrowthPanelProps {
  visible: boolean;
  growth: GrowthState | null;
  achievements: readonly AchievementEntry[];
  weekSignin: { week: string; days: string[]; rewarded1: boolean; rewarded3: boolean; rewarded7: boolean } | null;
  onClose: () => void;
}

const MOOD_MAX = 100;
const AFFINITY_MAX = 10000;
const SATIETY_MAX = 100;

function Meter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const ratio = Math.max(0, Math.min(1, value / max));
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterValue}>
          {Math.round(value)} / {max}
        </Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function GrowthPanel({ visible, growth, achievements, weekSignin, onClose }: GrowthPanelProps) {
  const unlocked = useMemo(() => new Set(growth?.achievements ?? []), [growth]);
  const signedIn = useMemo(() => new Set(weekSignin?.days ?? []), [weekSignin]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.head}>
            <Text style={styles.title}>鲸鱼娘养成</Text>
            <Text style={styles.level}>Lv.{growth?.level ?? 1}</Text>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Meter label="心情" value={growth?.mood ?? 0} max={MOOD_MAX} color="#f2a94b" />
            <Meter label="亲密度" value={growth?.affinity ?? 0} max={AFFINITY_MAX} color="#e86a8f" />
            <Meter label="饱食度" value={growth?.satiety ?? 0} max={SATIETY_MAX} color="#4bb87a" />

            <Text style={styles.section}>本周签到</Text>
            <View style={styles.weekRow}>
              {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                <View
                  key={day}
                  style={[styles.day, signedIn.has(day) ? styles.dayOn : null]}
                >
                  <Text style={[styles.dayText, signedIn.has(day) ? styles.dayTextOn : null]}>
                    {day}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={styles.streak}>连续签到 {growth?.signinStreak ?? 0} 天</Text>

            <Text style={styles.section}>
              成就 {unlocked.size} / {achievements.length}
            </Text>
            {achievements.map((entry) => {
              const done = unlocked.has(entry.id);
              return (
                <View key={entry.id} style={[styles.achievement, done ? null : styles.achievementOff]}>
                  <Text style={styles.achievementIcon}>{done ? entry.icon : "🔒"}</Text>
                  <View style={styles.achievementText}>
                    <Text style={[styles.achievementName, done ? null : styles.dim]}>{entry.name}</Text>
                    <Text style={[styles.achievementDesc, done ? null : styles.dim]}>{entry.desc}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    padding: 24,
  },
  sheet: {
    borderRadius: 16,
    backgroundColor: "#1c2026",
    paddingVertical: 14,
    paddingHorizontal: 16,
    maxHeight: "82%",
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: { color: "#e8edf4", fontSize: 17, fontWeight: "600" },
  level: { color: "#7fb2ff", fontSize: 15, fontWeight: "600" },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 6 },
  meter: { marginBottom: 10 },
  meterHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  meterLabel: { color: "#dfe6ef", fontSize: 13 },
  meterValue: { color: "#8b94a1", fontSize: 12 },
  meterTrack: { height: 7, borderRadius: 4, backgroundColor: "#2b3038", overflow: "hidden" },
  meterFill: { height: 7, borderRadius: 4 },
  section: { color: "#8b94a1", fontSize: 12, marginTop: 10, marginBottom: 6 },
  weekRow: { flexDirection: "row", gap: 6 },
  day: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#252a32",
    alignItems: "center",
  },
  dayOn: { backgroundColor: "#3d7eff" },
  dayText: { color: "#8b94a1", fontSize: 13 },
  dayTextOn: { color: "#ffffff", fontWeight: "600" },
  streak: { color: "#8b94a1", fontSize: 12, marginTop: 6 },
  achievement: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2b3038",
  },
  achievementOff: { opacity: 0.55 },
  achievementIcon: { fontSize: 19, width: 30 },
  achievementText: { flex: 1 },
  achievementName: { color: "#dfe6ef", fontSize: 13 },
  achievementDesc: { color: "#8b94a1", fontSize: 11, marginTop: 1 },
  dim: { color: "#6f7885" },
  close: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#2b3038",
    alignItems: "center",
  },
  closeText: { color: "#dfe6ef", fontSize: 14, fontWeight: "500" },
});
