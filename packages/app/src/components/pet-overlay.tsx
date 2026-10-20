/**
 * A floating desk pet that sits above every screen in the app shell.
 *
 * Art and motion are upstream, not ours. All 90 standees come from
 * `Sutera-Diffusus/dsh-whale-musume` (MIT — see the LICENSE beside the assets),
 * 512x512 transparent WebP files, one per mood. The motion is a port of that
 * project's CSS keyframes, which drive a *static* standee continuously instead
 * of stepping a sprite sheet. That is the point: the sprite-sheet pet this
 * replaced had ~2 fps of source frames and read as stutter, while these
 * keyframes interpolate.
 *
 * Ported from `assets/dsh-whale-moe.css`:
 *   wm-breathe  0%/100% translateY(0)   50% translateY(-3px)
 *   wm-sway     0%/100% rotate(0)       25% rotate(1.2deg) translateX(1px)
 *                                       75% rotate(-1.2deg) translateX(-1px)
 *   wm-hop      0% translateY(0) scale(1) rotate(0)
 *               45% translateY(-14px) scale(1.04, 0.96) rotate(-3deg)
 *   wm-pose-in  from opacity .2 translateY(4px) scale(1.04)   to opacity 1
 *
 * Those are CSS pixels in the standee's own 512px space, so translations are
 * rescaled to PET_SIZE and then lifted, because a literal 3px breathe is under
 * a point on screen. Rotations are kept as authored — degrees do not scale.
 *
 * The pose is chosen by four layers, most specific first:
 *   1. a tap reaction (`react-head`, `wink`, …), held briefly
 *   2. an idle easter egg (`meme-*`, `daily-*`, `game-*`), shown between turns
 *   3. the calendar (`night`, `festival-*`)
 *   4. live agent activity from the session store (`tool`, `waiting`, `failure`)
 *
 * @module paseo/components/pet-overlay
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
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

/**
 * Every standee shipped by the upstream project, keyed by the part of its file
 * name after `dsh-whale-`. `require` needs static paths, so this table is
 * spelled out rather than generated.
 */
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

/** On-screen size of the standee; the art itself is 512x512 with padding. */
const PET_SIZE = 96;
/** Source pixels per point, used to rescale the upstream pixel amounts. */
const ART_TO_SCREEN = PET_SIZE / 512;

const STORAGE_KEY = "paseo.pet.position.v1";
/** Keep the pet clear of the very edge so nothing is clipped by the window. */
const EDGE_MARGIN = 10;
/** Screens where a pet would be noise rather than company. */
const HIDDEN_ROUTES = new Set(["/welcome", "/pair-scan", "/open-project"]);

/** Breathe: upstream -3px at 512, lifted so it is still readable at 96pt. */
const BREATHE_PX = Math.max(1.6, 3 * ART_TO_SCREEN * 3);
/** Hop: upstream -14px at 512, rescaled the same way. */
const HOP_PX = Math.max(7, 14 * ART_TO_SCREEN * 3);
/** Pose change: upstream translateY(4px) at 512. */
const POSE_IN_PX = Math.max(3, 4 * ART_TO_SCREEN * 3);

/** How long a tap reaction or an easter egg holds before the pose is re-derived. */
const REACTION_MS = 1600;
const EASTER_EGG_MS = 6000;
/** Idle window between easter eggs. */
const EGG_MIN_MS = 45_000;
const EGG_MAX_MS = 120_000;

/**
 * Live agent activity -> standee. Only buckets that describe something actually
 * happening appear here, in the store's own priority order. `done` is
 * deliberately absent: it is the bucket's *fallback* (the last `return` of
 * `deriveAgentStateBucket` in `@getpaseo/protocol`), so it means "nothing is
 * happening", not "just finished". Mapping it to a pose would leave the pet
 * celebrating forever whenever a workspace is merely idle.
 */
const ACTIVITY_POSES: ReadonlyArray<{ status: string; pose: PoseName }> = [
  { status: "needs_input", pose: "waiting" },
  { status: "failed", pose: "failure" },
  { status: "running", pose: "tool" },
  { status: "attention", pose: "curious" },
];

/** Tap reactions, picked at random so repeated taps do not repeat the same art. */
const REACTION_POSES: readonly PoseName[] = [
  "react-head",
  "react-belly",
  "react-tail",
  "tail-swing",
  "wink",
  "blush",
  "teasing",
  "pick-up",
  "greet",
  "meme-heart",
  "meme-kyun",
  "meme-yes",
];

/**
 * Easter eggs shown while nothing is running: the meme, daily-life and game
 * sets, plus the moods Paseo has no data for. `balance-low` and the
 * `weather-*` standees are deliberately absent — Paseo knows neither balance
 * nor weather, so showing them would be fiction.
 */
const EASTER_EGG_POSES: readonly PoseName[] = [
  "meme-broke",
  "meme-cry",
  "meme-doge",
  "meme-doubt",
  "meme-music",
  "meme-no",
  "meme-ojisan",
  "meme-omg",
  "meme-peace",
  "meme-shock",
  "meme-sike",
  "meme-smile-pain",
  "meme-smug",
  "meme-wakuwaku",
  "meme-worship",
  "daily-coffee",
  "daily-cooking",
  "daily-done",
  "daily-eat",
  "daily-fishing",
  "daily-gaming",
  "daily-melt",
  "daily-painting",
  "daily-pajama",
  "daily-picnic",
  "daily-shower",
  "daily-stretch",
  "eat",
  "game-cheat",
  "game-happy",
  "game-lose",
  "game-think",
  "game-win",
  "levelup",
  "star",
  "achievement",
  "success",
  "sweep",
  "cool-shades",
  "bold",
  "angry",
  "sleep",
  "afk",
  "abstract",
  "valentine",
  "running",
  "thinking",
  "work-idea",
  "work-review",
  "work-debug",
  "work-deploy",
  "work-meeting",
  "work-slack",
  "work-slack-phone",
  "work-boss",
  "work-ram",
  "work-pat",
  "work-sleep",
  "work-deadline",
  "work-celebrate",
  "festival-mid-autumn",
  "festival-spring",
];

/**
 * Calendar poses. Only fixed-date holidays are automated: mid-autumn and
 * spring festival follow the lunar calendar, which needs a table we do not
 * have, so those two standees are reachable through the easter-egg pool.
 */
function calendarPose(now: Date): PoseName | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = now.getHours();
  if (month === 12 && day >= 20 && day <= 26) return "festival-christmas";
  if (month === 10 && day >= 25 && day <= 31) return "festival-halloween";
  if (hour >= 23 || hour < 6) return "night";
  return null;
}

interface StoredPosition {
  x: number;
  y: number;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function PetOverlay() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Live agent activity across every workspace this client knows about.
  const workspaceStatuses = useWorkspaceStatusesForBadges();

  const [reaction, setReaction] = useState<PoseName | null>(null);
  const [celebration, setCelebration] = useState<PoseName | null>(null);
  const [egg, setEgg] = useState<PoseName | null>(null);
  const [clockPose, setClockPose] = useState<PoseName | null>(() => calendarPose(new Date()));

  /**
   * The winning activity bucket, in the store's own priority order, or null
   * when no workspace reports one. Kept as the raw bucket name so the
   * running -> done edge can be observed below.
   */
  const activityBucket = useMemo<string | null>(() => {
    const seen = new Set(workspaceStatuses);
    for (const entry of ACTIVITY_POSES) {
      if (seen.has(entry.status)) return entry.status;
    }
    return null;
  }, [workspaceStatuses]);

  /** Anything that is not an active bucket rests at the idle standee. */
  const activityPose = useMemo<PoseName>(() => {
    const entry = ACTIVITY_POSES.find((candidate) => candidate.status === activityBucket);
    return entry?.pose ?? "idle-cute";
  }, [activityBucket]);

  const pose: PoseName = reaction ?? celebration ?? egg ?? clockPose ?? activityPose;

  // Celebrate on the running -> done edge only. `done` is the resting bucket, so
  // a level-triggered mapping would celebrate forever; this is edge-triggered.
  const previousBucket = useRef<string | null>(null);
  useEffect(() => {
    const wasRunning = previousBucket.current === "running";
    previousBucket.current = activityBucket;
    if (!wasRunning || activityBucket !== "done") return;
    setCelebration("celebrate");
    const timer = setTimeout(() => setCelebration(null), 2500);
    return () => clearTimeout(timer);
  }, [activityBucket]);

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

  // Idle motion: wm-breathe (0 -> -3px -> 0) and wm-sway (0 -> +1.2deg -> -1.2deg).
  // `withRepeat(..., -1, true)` reverses each cycle, matching the CSS 0/50/100 pairs.
  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    sway.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breathe, sway]);

  // Play wm-pose-in whenever the standee actually changes.
  const lastPose = useRef<PoseName>(pose);
  useEffect(() => {
    if (lastPose.current === pose) return;
    lastPose.current = pose;
    poseIn.value = 0;
    poseIn.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [pose, poseIn]);

  // Recompute the calendar pose on the minute so the pet crosses midnight and
  // holiday boundaries without a relaunch.
  useEffect(() => {
    const timer = setInterval(() => setClockPose(calendarPose(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Easter eggs only while no agent is working, so she never changes pose
  // mid-turn. The timeout is re-rolled each cycle to avoid a metronome feel.
  useEffect(() => {
    if (activityPose !== "idle-cute") return;
    let eggTimer: ReturnType<typeof setTimeout> | undefined;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const delay = EGG_MIN_MS + Math.random() * (EGG_MAX_MS - EGG_MIN_MS);
      eggTimer = setTimeout(() => {
        if (cancelled) return;
        setEgg(pickRandom(EASTER_EGG_POSES));
        clearTimer = setTimeout(() => {
          setEgg(null);
          schedule();
        }, EASTER_EGG_MS);
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      if (eggTimer !== undefined) clearTimeout(eggTimer);
      if (clearTimer !== undefined) clearTimeout(clearTimer);
    };
  }, [activityPose]);

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

  /** Play wm-hop once. */
  const playHop = useCallback(() => {
    hop.value = 0;
    hop.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
    );
  }, [hop]);

  /** A tap: a random reaction plus a hop, then back to the derived pose. */
  const react = useCallback(() => {
    setEgg(null);
    setReaction(pickRandom(REACTION_POSES));
    playHop();
    setTimeout(() => setReaction(null), REACTION_MS);
  }, [playHop]);

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

  const gesture = useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

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

  if (HIDDEN_ROUTES.has(pathname)) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // itself receives touches.
    <View pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="imagebutton"
          accessibilityLabel="Desk pet"
          style={[styles.pet, petStyle]}
        >
          <Image source={POSES[pose]} contentFit="contain" style={styles.standee} />
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
    left: 0,
    top: 0,
    width: PET_SIZE,
    height: PET_SIZE,
  },
  standee: {
    width: PET_SIZE,
    height: PET_SIZE,
  },
});
