/**
 * A floating desk pet that sits above every screen in the app shell.
 *
 * The sprite atlas, its per-frame durations and its track list are upstream
 * assets, not ours: they come from `@linxin666/dsh-pet`'s built-in
 * `whale-refined` sprite2d pet (MIT, see `assets/pets/whale-girl/LICENSE`).
 * The sheet is 1536x1872 — 8 columns x 9 rows of 192x208 cells — where each
 * row is one track and the upstream `frames` array `[6, 8, 8, 4, 5, 8, 6, 6, 6]`
 * gives how many leading cells each row uses. Only the renderer is ours,
 * because the upstream one is DOM/CSS.
 *
 * Frame stepping runs on a plain timer: the atlas plays at 2-6 fps, so a timer
 * plus state is enough, and it keeps the per-track duration table out of a
 * worklet. Dragging and the press scale run on the UI thread via Reanimated.
 *
 * @module paseo/components/pet-overlay
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SHEET = require("../../assets/pets/whale-girl/spritesheet.png");

const CELL_W = 192;
const CELL_H = 208;
const COLUMNS = 8;
const ROWS = 9;
const SHEET_W = CELL_W * COLUMNS;
const SHEET_H = CELL_H * ROWS;

/** Cell size on screen: 192x208 at 0.42 is roughly 81x87pt. */
const PET_SCALE = 0.42;
const PET_W = Math.round(CELL_W * PET_SCALE);
const PET_H = Math.round(CELL_H * PET_SCALE);

/**
 * Row index and per-frame durations for each track, in the atlas's own order.
 *
 * `idle` loops; the reaction tracks play once and hand control back. Their
 * `durations` lengths match the upstream `frames` entries for those rows.
 */
const TRACKS = {
  idle: { row: 0, durations: [500, 500, 600, 500, 500, 600], loop: true },
  waving: { row: 3, durations: [450, 450, 450, 450], loop: false },
  jumping: { row: 4, durations: [400, 400, 400, 450, 450], loop: false },
} as const;

type TrackName = keyof typeof TRACKS;

const STORAGE_KEY = "paseo.pet.position.v1";
/** Keep the pet clear of the very edge so nothing is clipped by the window. */
const EDGE_MARGIN = 10;
/** Screens where a pet would be noise rather than company. */
const HIDDEN_ROUTES = new Set(["/welcome", "/pair-scan", "/open-project"]);

interface StoredPosition {
  x: number;
  y: number;
}

/**
 * Play one track and return the current cell index.
 *
 * A looping track wraps forever; a one-shot track calls `onFinished` instead of
 * wrapping, which is how a tap reaction returns the pet to `idle`.
 */
function useTrackFrame(track: TrackName, onFinished: () => void): number {
  const [frame, setFrame] = useState(0);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    const { durations, loop } = TRACKS[track];
    setFrame(0);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;

    const step = () => {
      if (cancelled) return;
      index += 1;
      if (index >= durations.length) {
        if (!loop) {
          finishedRef.current();
          return;
        }
        index = 0;
      }
      setFrame(index);
      timer = setTimeout(step, durations[index]);
    };

    timer = setTimeout(step, durations[0]);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [track]);

  return frame;
}

export function PetOverlay() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const [track, setTrack] = useState<TrackName>("idle");
  const handleFinished = useCallback(() => setTrack("idle"), []);
  const frame = useTrackFrame(track, handleFinished);

  const minX = EDGE_MARGIN;
  const maxX = Math.max(EDGE_MARGIN, width - PET_W - EDGE_MARGIN);
  const minY = insets.top + EDGE_MARGIN;
  const maxY = Math.max(minY, height - PET_H - EDGE_MARGIN);
  const defaultX = maxX;
  const defaultY = Math.min(Math.max(minY, height * 0.58), maxY);

  const x = useSharedValue(defaultX);
  const y = useSharedValue(defaultY);
  const pressScale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  const persist = useCallback((nextX: number, nextY: number) => {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ x: nextX, y: nextY })).catch(() => {
      // Persisting a pet position is best-effort: a failure only costs the
      // position on the next launch.
    });
  }, []);

  const react = useCallback(() => {
    setTrack((current) => (current === "idle" ? "waving" : current));
  }, []);

  // Restore the stored position once on mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || raw === null) return;
        const parsed = JSON.parse(raw) as StoredPosition;
        if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return;
        x.value = Math.min(Math.max(minX, parsed.x), maxX);
        y.value = Math.min(Math.max(minY, parsed.y), maxY);
      })
      .catch(() => {
        // Unreadable storage leaves the pet at its default corner.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose; viewport changes are clamped by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pet on screen when the viewport changes (rotation, split view).
  useEffect(() => {
    x.value = Math.min(Math.max(minX, x.value), maxX);
    y.value = Math.min(Math.max(minY, y.value), maxY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          originX.value = x.value;
          originY.value = y.value;
          pressScale.value = withSpring(1.08, { damping: 20, stiffness: 220 });
        })
        .onUpdate((event) => {
          x.value = originX.value + event.translationX;
          y.value = originY.value + event.translationY;
        })
        .onEnd(() => {
          pressScale.value = withSpring(1, { damping: 20, stiffness: 220 });
          const settledX = Math.min(Math.max(minX, x.value), maxX);
          const settledY = Math.min(Math.max(minY, y.value), maxY);
          x.value = withSpring(settledX, { damping: 18, stiffness: 180 });
          y.value = withSpring(settledY, { damping: 18, stiffness: 180 });
          runOnJS(persist)(settledX, settledY);
        })
        .onFinalize(() => {
          pressScale.value = withSpring(1, { damping: 20, stiffness: 220 });
        }),
    // Shared values are stable identities; this closure only reads and writes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minX, maxX, minY, maxY, persist],
  );

  const tap = useMemo(
    () => Gesture.Tap().maxDistance(12).onEnd(() => runOnJS(react)()),
    [react],
  );

  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: pressScale.value },
    ],
  }));

  if (HIDDEN_ROUTES.has(pathname)) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // itself receives touches.
    <View pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="imagebutton"
          accessibilityLabel="Desk pet"
          style={[styles.pet, animatedStyle]}
        >
          <View style={styles.window}>
            <Image
              source={SHEET}
              // The whole sheet is drawn and shifted so the wanted cell lands in
              // the viewport; `stretch` keeps the atlas's pixel grid aligned with
              // the shift arithmetic instead of rescaling to fit.
              resizeMode="stretch"
              style={[
                styles.sheet,
                {
                  width: SHEET_W * PET_SCALE,
                  height: SHEET_H * PET_SCALE,
                  left: -frame * PET_W,
                  top: -TRACKS[track].row * PET_H,
                },
              ]}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
  },
  pet: {
    position: "absolute",
    width: PET_W,
    height: PET_H,
  },
  window: {
    width: PET_W,
    height: PET_H,
    overflow: "hidden",
  },
  sheet: {
    position: "absolute",
  },
});
