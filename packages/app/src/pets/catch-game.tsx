/**
 * 「接点心」mini-game.
 *
 * Rules come from `whale-moe-core.js` (`catchNewState` / `catchTick` /
 * `catchMove` / `catchResult`): a basket that slides along the bottom, falling
 * cakes / stars / bombs, and a 30s clock. This file draws the falling items and
 * turns a horizontal pan into `catchMove`.
 *
 * @module paseo/pets/catch-game
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("./whale-moe-core.js") as {
  catchNewState: () => unknown;
  catchTick: (state: unknown, now: number) => { state: CatchState };
  catchMove: (state: unknown, basketX: number) => CatchState;
  catchResult: (state: unknown) => { grade: string; caught?: number };
};

interface FallingItem {
  x: number;
  y: number;
  kind: string;
  resolved: boolean;
}

interface CatchState {
  items: FallingItem[];
  basketX: number;
  score: number;
  caught: number;
  missed: number;
  remainingMs: number;
  status: string;
}

const TICK_MS = 100;
/** Field height as a fraction of the sheet, matching the core's y space. */
const FIELD_HEIGHT = 260;
const BASKET_WIDTH = 64;

const ITEM_EMOJI: Record<string, string> = {
  cake: "🍰",
  star: "⭐",
  bomb: "💣",
};

export function CatchGame({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [state, setState] = useState<CatchState | null>(null);
  const stateRef = useRef<CatchState | null>(null);
  const [fieldWidth, setFieldWidth] = useState(0);

  const start = useCallback(() => {
    const next = (core.catchNewState() as unknown) as CatchState;
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!visible) return;
    start();
    return () => {
      stateRef.current = null;
    };
  }, [visible, start]);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const current = stateRef.current;
      if (current === null || current.status !== "playing") return;
      const next = core.catchTick(current, Date.now()).state;
      stateRef.current = next;
      setState(next);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [visible]);

  // A horizontal pan moves the basket; the core clamps it to [0.02, 0.98].
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_event, gesture) => {
        const current = stateRef.current;
        if (current === null || current.status !== "playing") return;
        const width = fieldWidthRef.current;
        if (width <= 0) return;
        const next = core.catchMove(current, gesture.moveX / width);
        stateRef.current = next;
        setState(next);
      },
    }),
  ).current;
  const fieldWidthRef = useRef(0);

  const ended = state !== null && state.status !== "playing";
  const result = ended ? core.catchResult(state) : null;
  const basketLeft = (state?.basketX ?? 0.5) * fieldWidth - BASKET_WIDTH / 2;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.head}>
            <Text style={styles.title}>接点心</Text>
            <Text style={styles.score}>{state?.score ?? 0} 分</Text>
          </View>
          <Text style={styles.timer}>
            {ended
              ? "时间到"
              : `剩余 ${Math.ceil((state?.remainingMs ?? 0) / 1000)} 秒 · 接到 ${state?.caught ?? 0} · 漏掉 ${state?.missed ?? 0}`}
          </Text>
          <View
            style={styles.field}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              fieldWidthRef.current = width;
              setFieldWidth(width);
            }}
            {...panResponder.panHandlers}
          >
            {(state?.items ?? []).map((item, index) =>
              item.resolved ? null : (
                <Text
                  key={`${index}-${item.kind}`}
                  style={[
                    styles.item,
                    {
                      left: item.x * fieldWidth - 12,
                      top: item.y * FIELD_HEIGHT,
                    },
                  ]}
                >
                  {ITEM_EMOJI[item.kind] ?? "🍰"}
                </Text>
              ),
            )}
            <View style={[styles.basket, { left: Math.max(0, basketLeft) }]}>
              <Text style={styles.basketText}>🧺</Text>
            </View>
          </View>
          {ended ? (
            <Text style={styles.result}>
              结果：{result?.grade === "win" ? "胜利！" : result?.grade === "draw" ? "平局" : "再来一次？"}
            </Text>
          ) : null}
          <Pressable style={styles.button} onPress={start}>
            <Text style={styles.buttonText}>{ended ? "再来一局" : "重新开始"}</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.closeButton]} onPress={onClose}>
            <Text style={styles.buttonText}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    backgroundColor: "#1c2026",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { color: "#e8edf4", fontSize: 17, fontWeight: "600" },
  score: { color: "#7fb2ff", fontSize: 15, fontWeight: "600" },
  timer: { color: "#8b94a1", fontSize: 12, marginTop: 4, marginBottom: 10 },
  field: {
    height: FIELD_HEIGHT,
    borderRadius: 12,
    backgroundColor: "#14171c",
    overflow: "hidden",
  },
  item: { position: "absolute", fontSize: 22 },
  basket: { position: "absolute", bottom: 4, width: BASKET_WIDTH, alignItems: "center" },
  basketText: { fontSize: 34 },
  result: { color: "#dfe6ef", fontSize: 14, textAlign: "center", marginTop: 10 },
  button: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#3d7eff",
    alignItems: "center",
  },
  closeButton: { backgroundColor: "#2b3038" },
  buttonText: { color: "#ffffff", fontSize: 14, fontWeight: "500" },
});
