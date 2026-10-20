/**
 * 「戳泡泡」mini-game.
 *
 * The rules are not reimplemented: `whale-moe-core.js` ships the whole state
 * machine (`gameNewState` / `gameTick` / `gamePop` / `gameResult`), including
 * the 4x4 board, spawn cadence, bubble lifetime, bomb and star probabilities
 * and the combo window. This file is the grid and the tap handler.
 *
 * `gameTick` and `gamePop` both return `{ state, events }`; only `state` is
 * drawn, `events` is what the upstream build feeds to particles.
 *
 * @module paseo/pets/bubble-game
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("./whale-moe-core.js") as {
  gameNewState: () => unknown;
  gameTick: (state: unknown, now: number) => { state: GameState };
  gamePop: (state: unknown, cell: number, now: number) => { state: GameState };
  gameResult: (state: unknown) => { grade: string; score?: number };
};

interface Cell {
  kind: string;
  bornAt: number;
}

interface GameState {
  board: (Cell | null)[];
  score: number;
  combo: number;
  comboMax: number;
  remainingMs: number;
  status: string;
}

const GRID = 4;
/** Tick faster than the 500ms spawn interval so pops feel responsive. */
const TICK_MS = 100;

const CELL_EMOJI: Record<string, string> = {
  bubble: "🫧",
  star: "⭐",
  bomb: "💣",
};

export function BubbleGame({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const stateRef = useRef<GameState | null>(null);

  const start = useCallback(() => {
    const next = (core.gameNewState() as unknown) as GameState;
    stateRef.current = next;
    setState(next);
  }, []);

  // Start fresh every time the sheet opens. `start` is a stable useCallback, so
  // this only re-runs when the sheet opens or closes.
  useEffect(() => {
    if (!visible) return;
    start();
    return () => {
      stateRef.current = null;
    };
  }, [visible, start]);

  // Drive the board. The core module owns all timing decisions; this only
  // advances the clock.
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const current = stateRef.current;
      if (current === null || current.status !== "playing") return;
      const next = core.gameTick(current, Date.now()).state;
      stateRef.current = next;
      setState(next);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [visible]);

  const pop = useCallback((cell: number) => {
    const current = stateRef.current;
    if (current === null || current.status !== "playing") return;
    const next = core.gamePop(current, cell, Date.now()).state;
    stateRef.current = next;
    setState(next);
  }, []);

  const ended = state !== null && state.status !== "playing";
  const grade = ended ? core.gameResult(state) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.head}>
            <Text style={styles.title}>戳泡泡</Text>
            <Text style={styles.score}>{state?.score ?? 0} 分</Text>
          </View>
          <Text style={styles.timer}>
            {ended ? "时间到" : `剩余 ${Math.ceil((state?.remainingMs ?? 0) / 1000)} 秒`}
            {state !== null && state.combo > 1 ? ` · ${state.combo} 连击` : ""}
          </Text>
          <View style={styles.grid}>
            {Array.from({ length: GRID * GRID }, (_, cell) => {
              const entry = state?.board[cell] ?? null;
              return (
                <Pressable
                  key={cell}
                  style={[styles.cell, entry ? styles.cellActive : null]}
                  onPress={() => pop(cell)}
                  disabled={ended}
                >
                  <Text style={styles.cellText}>
                    {entry ? (CELL_EMOJI[entry.kind] ?? "🫧") : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {ended ? (
            <Text style={styles.result}>
              结果：{grade?.grade === "win" ? "胜利！" : grade?.grade === "draw" ? "平局" : "再来一次？"}
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  cell: {
    width: "22%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#252a32",
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: { backgroundColor: "#2f3a4c" },
  cellText: { fontSize: 26 },
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
