/**
 * A floating desk pet that sits above every screen in the app shell.
 *
 * The behaviour is **not** reimplemented: `src/pets/whale-moe-core.js` is the
 * upstream state machine from `Sutera-Diffusus/dsh-whale-musume` (MIT), copied
 * verbatim because it is pure and DOM-free. It owns the dialogue tables (620
 * lines across 11 banks), the achievement rules, the growth model and the two
 * mini-games. This file is only the React Native renderer: it feeds that module
 * the host signals it needs and draws the `pose` and `line` it returns.
 *
 * The standees are the upstream 512x512 WebP assets (`assets/pets/whale-musume`,
 * MIT — see the LICENSE beside them). They are drawn small on purpose; the
 * upstream page shows them at 200 CSS px, which is too large for a phone.
 *
 * Motion is a port of the upstream CSS keyframes, but the *soft* set that
 * actually wins the cascade there: breathe -4px / 3.4s, sway 0 -> 1.2deg / 6s,
 * hop -8px / 0.6s. The pixel amounts are rescaled out of the standee's 512px
 * space; degrees are kept as authored.
 *
 * @module paseo/components/pet-overlay
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWorkspaceStatusesForBadges } from "@/stores/session-store-hooks";
import { BubbleGame } from "../pets/bubble-game";
import { CatchGame } from "../pets/catch-game";
import { GrowthPanel, type AchievementEntry, type GrowthState } from "../pets/growth-panel";
import { PetMenu, type PetMenuAction } from "../pets/pet-menu";
import { SettingsPanel } from "../pets/settings-panel";
import {
  DEFAULT_SETTINGS,
  loadPetSave,
  savePetSave,
  type PetSave,
  type PetSettings,
} from "../pets/pet-storage";

// The upstream state machine is a UMD module with no DOM dependencies. Vendored
// verbatim so its dialogue tables and rules stay byte-identical to the source
// instead of drifting in a hand port. There are no type declarations for it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("../pets/whale-moe-core.js") as {
  computeState: (
    prev: unknown,
    signals: Record<string, unknown>,
    now: number,
    rng: () => number,
  ) => PetState;
  hitZone: (nx: number, ny: number, poseSet: "full" | "peek") => string;
  POSES: Record<string, string>;
  ACHIEVEMENTS: readonly AchievementEntry[];
  computeGrowth: (
    prev: unknown,
    event: { type: string },
    now: number,
    pats: number,
  ) => { growth: GrowthState; unlocks: string[]; leveledUp: boolean };
  computeWeekSignin: (growth: unknown) => {
    weekSignin: { week: string; days: string[]; rewarded1: boolean; rewarded3: boolean; rewarded7: boolean };
  };
};

/** The slice of `computeState`'s return value this renderer reads. */
interface PetState {
  state: string;
  pose: string;
  line: string;
  speak: boolean;
  mode?: string;
}

const POSES = {
  abstract: require("../../assets/pets/whale-musume/dsh-whale-state-abstract.webp"),
  achievement: require("../../assets/pets/whale-musume/dsh-whale-state-achievement.webp"),
  afk: require("../../assets/pets/whale-musume/dsh-whale-state-afk.webp"),
  angry: require("../../assets/pets/whale-musume/dsh-whale-state-angry.webp"),
  "balance-low": require("../../assets/pets/whale-musume/dsh-whale-state-balance-low.webp"),
  blush: require("../../assets/pets/whale-musume/dsh-whale-state-blush.webp"),
  bold: require("../../assets/pets/whale-musume/dsh-whale-state-bold.webp"),
  celebrate: require("../../assets/pets/whale-musume/dsh-whale-state-celebrate.webp"),
  "cool-shades": require("../../assets/pets/whale-musume/dsh-whale-state-cool-shades.webp"),
  curious: require("../../assets/pets/whale-musume/dsh-whale-state-curious.webp"),
  "daily-coffee": require("../../assets/pets/whale-musume/dsh-whale-state-daily-coffee.webp"),
  "daily-cooking": require("../../assets/pets/whale-musume/dsh-whale-state-daily-cooking.webp"),
  "daily-done": require("../../assets/pets/whale-musume/dsh-whale-state-daily-done.webp"),
  "daily-eat": require("../../assets/pets/whale-musume/dsh-whale-state-daily-eat.webp"),
  "daily-fishing": require("../../assets/pets/whale-musume/dsh-whale-state-daily-fishing.webp"),
  "daily-gaming": require("../../assets/pets/whale-musume/dsh-whale-state-daily-gaming.webp"),
  "daily-melt": require("../../assets/pets/whale-musume/dsh-whale-state-daily-melt.webp"),
  "daily-painting": require("../../assets/pets/whale-musume/dsh-whale-state-daily-painting.webp"),
  "daily-pajama": require("../../assets/pets/whale-musume/dsh-whale-state-daily-pajama.webp"),
  "daily-picnic": require("../../assets/pets/whale-musume/dsh-whale-state-daily-picnic.webp"),
  "daily-shower": require("../../assets/pets/whale-musume/dsh-whale-state-daily-shower.webp"),
  "daily-stretch": require("../../assets/pets/whale-musume/dsh-whale-state-daily-stretch.webp"),
  eat: require("../../assets/pets/whale-musume/dsh-whale-state-eat.webp"),
  failure: require("../../assets/pets/whale-musume/dsh-whale-state-failure.webp"),
  "festival-christmas": require("../../assets/pets/whale-musume/dsh-whale-state-festival-christmas.webp"),
  "festival-halloween": require("../../assets/pets/whale-musume/dsh-whale-state-festival-halloween.webp"),
  "festival-mid-autumn": require("../../assets/pets/whale-musume/dsh-whale-state-festival-mid-autumn.webp"),
  "festival-spring": require("../../assets/pets/whale-musume/dsh-whale-state-festival-spring.webp"),
  "game-cheat": require("../../assets/pets/whale-musume/dsh-whale-state-game-cheat.webp"),
  "game-happy": require("../../assets/pets/whale-musume/dsh-whale-state-game-happy.webp"),
  "game-lose": require("../../assets/pets/whale-musume/dsh-whale-state-game-lose.webp"),
  "game-think": require("../../assets/pets/whale-musume/dsh-whale-state-game-think.webp"),
  "game-win": require("../../assets/pets/whale-musume/dsh-whale-state-game-win.webp"),
  greet: require("../../assets/pets/whale-musume/dsh-whale-state-greet.webp"),
  "idle-cute": require("../../assets/pets/whale-musume/dsh-whale-state-idle-cute.webp"),
  levelup: require("../../assets/pets/whale-musume/dsh-whale-state-levelup.webp"),
  "meme-broke": require("../../assets/pets/whale-musume/dsh-whale-state-meme-broke.webp"),
  "meme-cry": require("../../assets/pets/whale-musume/dsh-whale-state-meme-cry.webp"),
  "meme-doge": require("../../assets/pets/whale-musume/dsh-whale-state-meme-doge.webp"),
  "meme-doubt": require("../../assets/pets/whale-musume/dsh-whale-state-meme-doubt.webp"),
  "meme-heart": require("../../assets/pets/whale-musume/dsh-whale-state-meme-heart.webp"),
  "meme-kyun": require("../../assets/pets/whale-musume/dsh-whale-state-meme-kyun.webp"),
  "meme-music": require("../../assets/pets/whale-musume/dsh-whale-state-meme-music.webp"),
  "meme-no": require("../../assets/pets/whale-musume/dsh-whale-state-meme-no.webp"),
  "meme-ojisan": require("../../assets/pets/whale-musume/dsh-whale-state-meme-ojisan.webp"),
  "meme-omg": require("../../assets/pets/whale-musume/dsh-whale-state-meme-omg.webp"),
  "meme-peace": require("../../assets/pets/whale-musume/dsh-whale-state-meme-peace.webp"),
  "meme-shock": require("../../assets/pets/whale-musume/dsh-whale-state-meme-shock.webp"),
  "meme-sike": require("../../assets/pets/whale-musume/dsh-whale-state-meme-sike.webp"),
  "meme-smile-pain": require("../../assets/pets/whale-musume/dsh-whale-state-meme-smile-pain.webp"),
  "meme-smug": require("../../assets/pets/whale-musume/dsh-whale-state-meme-smug.webp"),
  "meme-wakuwaku": require("../../assets/pets/whale-musume/dsh-whale-state-meme-wakuwaku.webp"),
  "meme-worship": require("../../assets/pets/whale-musume/dsh-whale-state-meme-worship.webp"),
  "meme-yes": require("../../assets/pets/whale-musume/dsh-whale-state-meme-yes.webp"),
  night: require("../../assets/pets/whale-musume/dsh-whale-state-night.webp"),
  "pick-up": require("../../assets/pets/whale-musume/dsh-whale-state-pick-up.webp"),
  "react-belly": require("../../assets/pets/whale-musume/dsh-whale-state-react-belly.webp"),
  "react-head": require("../../assets/pets/whale-musume/dsh-whale-state-react-head.webp"),
  "react-tail": require("../../assets/pets/whale-musume/dsh-whale-state-react-tail.webp"),
  running: require("../../assets/pets/whale-musume/dsh-whale-state-running.webp"),
  sleep: require("../../assets/pets/whale-musume/dsh-whale-state-sleep.webp"),
  star: require("../../assets/pets/whale-musume/dsh-whale-state-star.webp"),
  success: require("../../assets/pets/whale-musume/dsh-whale-state-success.webp"),
  sweep: require("../../assets/pets/whale-musume/dsh-whale-state-sweep.webp"),
  "tail-swing": require("../../assets/pets/whale-musume/dsh-whale-state-tail-swing.webp"),
  teasing: require("../../assets/pets/whale-musume/dsh-whale-state-teasing.webp"),
  thinking: require("../../assets/pets/whale-musume/dsh-whale-state-thinking.webp"),
  tool: require("../../assets/pets/whale-musume/dsh-whale-state-tool.webp"),
  valentine: require("../../assets/pets/whale-musume/dsh-whale-state-valentine.webp"),
  waiting: require("../../assets/pets/whale-musume/dsh-whale-state-waiting.webp"),
  "weather-cold": require("../../assets/pets/whale-musume/dsh-whale-state-weather-cold.webp"),
  "weather-rain-happy": require("../../assets/pets/whale-musume/dsh-whale-state-weather-rain-happy.webp"),
  "weather-snow": require("../../assets/pets/whale-musume/dsh-whale-state-weather-snow.webp"),
  "weather-thunder": require("../../assets/pets/whale-musume/dsh-whale-state-weather-thunder.webp"),
  "weather-umbrella": require("../../assets/pets/whale-musume/dsh-whale-state-weather-umbrella.webp"),
  wink: require("../../assets/pets/whale-musume/dsh-whale-state-wink.webp"),
  "work-boss": require("../../assets/pets/whale-musume/dsh-whale-state-work-boss.webp"),
  "work-celebrate": require("../../assets/pets/whale-musume/dsh-whale-state-work-celebrate.webp"),
  "work-deadline": require("../../assets/pets/whale-musume/dsh-whale-state-work-deadline.webp"),
  "work-debug": require("../../assets/pets/whale-musume/dsh-whale-state-work-debug.webp"),
  "work-deploy": require("../../assets/pets/whale-musume/dsh-whale-state-work-deploy.webp"),
  "work-idea": require("../../assets/pets/whale-musume/dsh-whale-state-work-idea.webp"),
  "work-meeting": require("../../assets/pets/whale-musume/dsh-whale-state-work-meeting.webp"),
  "work-pat": require("../../assets/pets/whale-musume/dsh-whale-state-work-pat.webp"),
  "work-ram": require("../../assets/pets/whale-musume/dsh-whale-state-work-ram.webp"),
  "work-review": require("../../assets/pets/whale-musume/dsh-whale-state-work-review.webp"),
  "work-slack": require("../../assets/pets/whale-musume/dsh-whale-state-work-slack.webp"),
  "work-slack-phone": require("../../assets/pets/whale-musume/dsh-whale-state-work-slack-phone.webp"),
  "work-sleep": require("../../assets/pets/whale-musume/dsh-whale-state-work-sleep.webp"),
} as const;

type PoseName = keyof typeof POSES;

/** On-screen size of the standee, in points. Deliberately smaller than upstream. */
const PET_SIZE = 96;
/** Source pixels per point, used to rescale the upstream pixel amounts. */
const ART_TO_SCREEN = PET_SIZE / 512;

const STORAGE_KEY = "paseo.pet.position.v1";
/** Keep the pet clear of the very edge so nothing is clipped by the window. */
const EDGE_MARGIN = 10;
/** Screens where a pet would be noise rather than company. */
const HIDDEN_ROUTES = new Set(["/welcome", "/pair-scan", "/open-project"]);

/** Upstream soft-set keyframes, rescaled out of the 512px standee space. */
const BREATHE_PX = 4 * ART_TO_SCREEN * 2;
const HOP_PX = 8 * ART_TO_SCREEN * 2;
/** Upstream wm-pose-in: translateY(4px) + scale(1.04) -> identity. */
const POSE_IN_PX = 4 * ART_TO_SCREEN * 2;

/** State machine tick. The module itself rate-limits speech (`SPEECH_GAP_MS`). */
const TICK_MS = 500;
/** How long a finished line stays on screen before the bubble fades. */
const BUBBLE_HOLD_MS = 4500;

interface StoredPosition {
  x: number;
  y: number;
}

/** Per-character delay for the typewriter, mirroring the upstream pacing. */
function charDelay(character: string): number {
  if ("，。！？、；：,.!?;:".includes(character)) return 260;
  if (character === " ") return 90;
  return 64;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function PetOverlay() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Host signals: Paseo's own workspace buckets, mapped onto the names the
  // upstream state machine expects. `thinking` has no direct bucket, so it
  // stays false rather than being guessed at.
  const workspaceStatuses = useWorkspaceStatusesForBadges();
  const signals = useMemo<Record<string, unknown>>(() => {
    const seen = new Set(workspaceStatuses);
    return {
      tool: seen.has("running"),
      waiting: seen.has("needs_input"),
      error: seen.has("failed"),
      curiousAt: seen.has("attention") ? Date.now() : undefined,
      denseCode: false,
      petDisabled: false,
    };
  }, [workspaceStatuses]);
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  // The state machine carries its own memory (lastSpeechAt, streak, lineCount),
  // so the previous return value must be fed back in on every tick.
  // Holds the *complete* previous return value. `computeState` keeps its own
  // memory (lastSpeechAt, streak, lineCount) inside that object, so storing only
  // the fields this renderer draws would silently break its speech rate limit.
  const stateRef = useRef<unknown>(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = core.computeState(undefined, {}, Date.now(), Math.random);
  }

  const [petState, setPetState] = useState<PetState>(stateRef.current as PetState);

  // ---- save + panels -------------------------------------------------------
  // The save owns the five upstream preferences plus the opaque growth/game
  // blobs; the panels below write back through `persistSave`.
  const [save, setSave] = useState<PetSave | null>(null);
  const saveRef = useRef<PetSave | null>(null);
  const [panel, setPanel] = useState<"menu" | PetMenuAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPetSave().then((loaded) => {
      if (cancelled) return;
      saveRef.current = loaded;
      setSave(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const settings = save?.settings ?? DEFAULT_SETTINGS;
  const persistSave = useCallback((next: PetSave) => {
    saveRef.current = next;
    setSave(next);
    void savePetSave(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = core.computeState(stateRef.current, signalsRef.current, Date.now(), Math.random);
      stateRef.current = next;
      // Repaint only when something the renderer draws actually changed; the
      // module ticks every 500ms and would otherwise re-render constantly.
      setPetState((current) =>
        current.pose === next.pose && current.line === next.line && current.speak === next.speak
          ? current
          : next,
      );
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Typewriter: reveal the current line character by character, then hold it.
  //
  // The bubble's lifetime is owned by the hold timer, NOT by `speak`. The state
  // machine ticks every TICK_MS and reports `speak: true` only on the tick that
  // produced a new line, flipping it back to false on the next one — keying the
  // bubble off `speak` therefore dismissed it after a single tick, before the
  // typewriter had even finished. Only a *change of line* starts a bubble.
  const [typed, setTyped] = useState("");
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const lastLineRef = useRef<string>("");
  useEffect(() => {
    const line = petState.line;
    if (!line || line === lastLineRef.current) return;
    lastLineRef.current = line;
    setBubbleVisible(true);
    setTyped("");
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      index += 1;
      setTyped(line.slice(0, index));
      if (index < line.length) {
        timer = setTimeout(step, charDelay(line[index - 1]));
      } else {
        timer = setTimeout(() => setBubbleVisible(false), BUBBLE_HOLD_MS);
      }
    };
    timer = setTimeout(step, 0);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [petState.line]);

  // Motion drivers. `breathe` and `sway` loop forever; `hop` and `poseIn` are
  // one-shots retriggered by a tap or a pose change.
  const breathe = useSharedValue(0);
  const sway = useSharedValue(0);
  const hop = useSharedValue(0);
  const poseIn = useSharedValue(1);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);

  const minX = EDGE_MARGIN;
  const maxX = Math.max(EDGE_MARGIN, width - PET_SIZE - EDGE_MARGIN);
  const minY = insets.top + EDGE_MARGIN;
  const maxY = Math.max(minY, height - PET_SIZE - EDGE_MARGIN);

  // Upstream soft set: wm-breathe (-4px over 3.4s) and wm-sway (0 -> 1.2deg / 6s).
  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    sway.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breathe, sway]);

  // Upstream swap: 140ms press-down, change, 480ms rebound. Approximated with a
  // single pose-in so the swap does not queue two animations per change.
  const lastPose = useRef<string>(petState.pose);
  useEffect(() => {
    if (lastPose.current === petState.pose) return;
    lastPose.current = petState.pose;
    poseIn.value = 0;
    poseIn.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [petState.pose, poseIn]);

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
        // Unreadable storage just leaves the pet at its default corner.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose; viewport changes are clamped by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default corner on first layout, then re-clamp on viewport changes.
  const placed = useRef(false);
  useEffect(() => {
    if (!placed.current) {
      placed.current = true;
      x.value = Math.min(Math.max(minX, x.value || maxX), maxX);
      y.value = Math.min(Math.max(minY, y.value || Math.min(height * 0.62, maxY)), maxY);
      return;
    }
    x.value = Math.min(Math.max(minX, x.value), maxX);
    y.value = Math.min(Math.max(minY, y.value), maxY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, height]);

  const persist = useCallback((nextX: number, nextY: number) => {
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ x: nextX, y: nextY })).catch(() => {
      // Persisting a pet position is best-effort: a failure only costs the
      // position on the next launch.
    });
  }, []);

  /** Record one growth interaction (mood/affinity) and persist it. */
  const recordGrowth = useCallback(
    (type: string) => {
      const current = saveRef.current;
      if (current === null) return;
      const result = core.computeGrowth(current.growth, { type }, Date.now(), 1);
      persistSave({ ...current, growth: result.growth });
    },
    [persistSave],
  );

  /** Play wm-hop once. */
  const playHop = useCallback(() => {
    hop.value = 0;
    hop.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }),
    );
  }, [hop]);

  /**
   * A tap. The upstream build splits this into head / belly / tail hit zones
   * (`hitZone`), but this renderer has no pointer coordinates inside a gesture
   * callback without extra plumbing, so it plays the generic reaction.
   */
  const react = useCallback(() => {
    playHop();
    recordGrowth("pat");
  }, [playHop, recordGrowth]);

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

  const tap = useMemo(() => Gesture.Tap().maxDistance(12).onEnd(() => runOnJS(react)()), [react]);

  // Long-press opens the menu: phones have no right-click, which is what the
  // upstream build binds its context menu to.
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(450)
        .onStart(() => runOnJS(setPanel)("menu")),
    [],
  );

  // Long-press must win over the tap, and a drag must not open the menu.
  const gesture = useMemo(
    () => Gesture.Exclusive(longPress, pan, tap),
    [longPress, pan, tap],
  );

  /** Route a menu pick to the right sheet. */
  const handleAction = useCallback((action: PetMenuAction) => setPanel(action), []);

  const petStyle = useAnimatedStyle(() => ({
    opacity: 0.2 + 0.8 * poseIn.value,
    transform: [
      { translateX: x.value },
      {
        translateY:
          y.value - breathe.value * BREATHE_PX - hop.value * HOP_PX + (1 - poseIn.value) * POSE_IN_PX,
      },
      { rotate: `${sway.value * 1.2}deg` },
      { scale: pressScale.value * (1 + (1 - poseIn.value) * 0.04) },
    ],
  }));

  // The upstream standee name is already the suffix of its file name, so an
  // unknown pose (a newer upstream mood) falls back to the idle standee.
  const standee = POSES[petState.pose as PoseName] ?? POSES["idle-cute"];

  // `pet` is the upstream "show the pet at all" switch; turning it off is the
  // whole hide mechanism, so honour it here rather than only in the settings UI.
  if (HIDDEN_ROUTES.has(pathname) || !settings.pet) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // and its bubble receive touches.
    <View pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="imagebutton"
          accessibilityLabel="Desk pet"
          style={[styles.pet, petStyle]}
        >
          <Image source={standee} contentFit="contain" style={[styles.standee, styles.shadow]} />
          {bubbleVisible && typed && settings.chat ? (
            <View style={styles.bubble} pointerEvents="none">
              <Text style={styles.bubbleText}>{typed}</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
      <PetMenu
        visible={panel === "menu"}
        gamesEnabled={settings.game}
        onAction={handleAction}
        onClose={() => setPanel(null)}
      />
      <SettingsPanel
        visible={panel === "settings"}
        settings={settings}
        onChange={(next: PetSettings) => {
          const current = saveRef.current;
          if (current === null) return;
          persistSave({ ...current, settings: next });
        }}
        onClose={() => setPanel(null)}
      />
      <GrowthPanel
        visible={panel === "growth"}
        growth={(save?.growth as GrowthState | null) ?? null}
        achievements={core.ACHIEVEMENTS}
        weekSignin={save?.growth ? core.computeWeekSignin(save.growth).weekSignin : null}
        onClose={() => setPanel(null)}
      />
      <BubbleGame visible={panel === "bubble-game"} onClose={() => setPanel(null)} />
      <CatchGame visible={panel === "catch-game"} onClose={() => setPanel(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
  },
  pet: {
    position: "absolute",
    left: 0,
    top: 0,
    width: PET_SIZE,
    height: PET_SIZE,
  },
  standee: {
    width: PET_SIZE,
    height: PET_SIZE,
  },
  // Upstream: drop-shadow(0 6px 8px 22%). RN/iOS spells the same thing out.
  shadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
  },
  bubble: {
    position: "absolute",
    bottom: PET_SIZE + 10,
    left: -40,
    minWidth: PET_SIZE,
    maxWidth: 250,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(28, 32, 38, 0.94)",
  },
  bubbleText: {
    color: "#e8edf4",
    fontSize: 13,
    lineHeight: 18,
  },
});
