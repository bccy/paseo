/**
 * A floating desk pet that sits above every screen in the app shell.
 *
 * The behaviour is **not** reimplemented: `src/pets/whale-moe-core.js` is the
 * upstream state machine from `Sutera-Diffusus/dsh-whale-musume` (MIT), copied
 * verbatim because it is pure and DOM-free. It owns the dialogue tables and the
 * state -> pose mapping. This file is only the React Native renderer: it feeds
 * that module the host signals it needs, draws the pose it returns, and layers
 * the host-only variety on top (see below).
 *
 * Scope is the automatic companion: no menu, no settings sheet, no growth
 * panel, no mini-games. The product is the standee, the automatic dialogue, and
 * the "different state -> different standee" link. That link is the state
 * machine's `pose` field looked up in `POSE_ASSETS` — it stays, always.
 *
 * Variety (v3): all 79 usable standees are wired to a trigger. `pose-map.ts`
 * owns the asset table and the mapping tables; `resolveOverlayPose` there
 * decides priority. The layers are:
 *   - the state machine's own pose (`running` / `thinking` / `failure` /
 *     `success` / `waiting` / `curious` are never overwritten);
 *   - a tap (whole standee is one button) or a drag — direct interaction;
 *   - while idle only: a recent tool call picks a work-* standee, a recent user
 *     message picks a keyword/meme standee, a completed todo step picks a
 *     celebration standee, and every 3-5 minutes a daily-* / meme-* standee is
 *     picked at random (art only, no extra dialogue).
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
 * The speech bubble is a SIBLING of the standee on the full-screen host layer,
 * not a child of the 96x96 pet view. Two problems came from nesting it:
 *   1. It was laid out outside its parent's bounds (`bottom: PET_SIZE + 10`), so
 *      any ancestor that clips cuts the text instead of moving the bubble.
 *   2. Its width could not be measured against the screen edges, so at the
 *      default bottom-right corner (x = width - PET_SIZE - EDGE_MARGIN) its
 *      right edge ran ~100px past the screen and the tail of every line was
 *      cut off.
 * As a host-layer sibling it tracks the pet through the same animated x/y
 * shared values (so it follows a drag frame-by-frame), flips to the side of the
 * pet that faces the middle of the screen, and clamps itself inside the safe
 * horizontal band using its measured rendered width. It therefore can neither
 * be clipped by a parent nor leave the screen at either edge.
 *
 * @module paseo/components/pet-overlay
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
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
import { useShallow } from "zustand/shallow";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { useWorkspaceStatusesForBadges } from "@/stores/session-store-hooks";
import type { StreamItem, TodoEntry, ToolCallItem, UserMessageItem } from "@/types/stream";
import {
  IDLE_RANDOM_MAX_MS,
  IDLE_RANDOM_MIN_MS,
  KEYWORD_POSES,
  PAT_HOLD_MS,
  PICK_UP_HOLD_MS,
  POSE_ASSETS,
  celebrationPose,
  isIdleSeriesPose,
  pickIdleRandomPose,
  pickPatPose,
  pickRandomMemePose,
  resolveOverlayPose,
  resolveToolPose,
  type PoseName,
} from "../pets/pose-map";

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
  matchKeyword: (text: string, enabled: boolean) => string | null;
};

/** The slice of `computeState`'s return value this renderer reads. */
interface PetState {
  state: string;
  pose: string;
  line: string;
  speak: boolean;
  mode?: string;
}

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
/** Gap between the bubble and the standee, in points. */
const BUBBLE_GAP = 10;
/**
 * Preferred maximum bubble width. The bubble is clamped to the screen anyway,
 * so this only stops a long line from spanning a whole tablet.
 */
const BUBBLE_MAX_WIDTH = 260;
/**
 * A user message older than this did not just arrive (it came from timeline
 * hydration on launch), so it must not trigger a keyword / meme reaction.
 */
const KEYWORD_TRIGGER_MAX_AGE_MS = 5 * 60 * 1000;

interface StoredPosition {
  x: number;
  y: number;
}

/** How much of the most recent todo list is done, and whose list it is. */
interface TodoProgress {
  agentId: string;
  completed: number;
  total: number;
}

/**
 * The structural slice of the session store this overlay reads. Typing it
 * narrowly keeps the selectors honest: they may not reach for anything else.
 */
interface PetStoreSource {
  sessions: Record<string, SessionState>;
}

/** What the active conversation is doing, reduced to the fields the pet needs. */
interface PetActivity {
  /** Name of the newest tool call in the turn, if the turn has one yet. */
  toolName: string | null;
  /** When that tool call was issued (ms). */
  toolAt: number;
  /** `matchKeyword` id for the newest user message, or null when none matched. */
  keywordId: string | null;
  /** When the newest user message was sent (ms). */
  userAt: number;
  /** The newest stream item is a thought that is still streaming. */
  thought: boolean;
}

const EMPTY_ACTIVITY: PetActivity = {
  toolName: null,
  toolAt: 0,
  keywordId: null,
  userAt: 0,
  thought: false,
};

interface ActiveAgent {
  session: SessionState;
  agentId: string;
}

/** Per-character delay for the typewriter, mirroring the upstream pacing. */
function charDelay(character: string): number {
  if ("，。！？、；：,.!?;:".includes(character)) return 260;
  if (character === " ") return 90;
  return 64;
}

function lastActivityOf(session: SessionState, agentId: string): number {
  const agent = session.agents.get(agentId);
  return (agent?.lastActivityAt ?? agent?.updatedAt)?.getTime() ?? 0;
}

/**
 * The conversation the pet should mirror.
 *
 * The focused agent wins, because that is the screen the user is looking at.
 * With nothing focused (e.g. the project list) the most recently active root
 * agent wins, so the pet still reflects work that is actually running.
 */
function pickActiveAgent(state: PetStoreSource): ActiveAgent | null {
  let focusedBest: ActiveAgent | null = null;
  let focusedAt = Number.NEGATIVE_INFINITY;
  let recentBest: ActiveAgent | null = null;
  let recentAt = Number.NEGATIVE_INFINITY;

  for (const session of Object.values(state.sessions)) {
    const focusedId = session.focusedAgentId;
    if (focusedId !== null && session.agents.has(focusedId)) {
      const at = lastActivityOf(session, focusedId);
      if (at > focusedAt) {
        focusedAt = at;
        focusedBest = { session, agentId: focusedId };
      }
    }
    for (const agent of session.agents.values()) {
      if (agent.archivedAt || agent.parentAgentId) continue;
      const at = (agent.lastActivityAt ?? agent.updatedAt).getTime();
      if (at > recentAt) {
        recentAt = at;
        recentBest = { session, agentId: agent.id };
      }
    }
  }

  return focusedBest ?? recentBest;
}

function toolCallName(item: ToolCallItem): string | null {
  const payload = item.payload;
  if (payload.source === "agent") return payload.data.name;
  return payload.data.toolName;
}

/** Newest tool call of the current turn, or null when the turn issued none yet. */
function latestToolCall(session: SessionState, agentId: string): ToolCallItem | null {
  const streams = [session.agentStreamHead.get(agentId), session.agentStreamTail.get(agentId)];
  for (const items of streams) {
    if (items === undefined) continue;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined) continue;
      if (item.kind === "tool_call") return item;
      // The newest user message marks the start of a new turn: tool calls
      // before it belong to the previous one and must not be shown again.
      if (item.kind === "user_message") return null;
    }
  }
  return null;
}

function latestUserMessage(session: SessionState, agentId: string): UserMessageItem | null {
  const streams = [session.agentStreamHead.get(agentId), session.agentStreamTail.get(agentId)];
  for (const items of streams) {
    if (items === undefined) continue;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined) continue;
      if (item.kind === "user_message") return item;
    }
  }
  return null;
}

function latestStreamItem(session: SessionState, agentId: string): StreamItem | undefined {
  const head = session.agentStreamHead.get(agentId);
  const headLast = head !== undefined && head.length > 0 ? head[head.length - 1] : undefined;
  if (headLast !== undefined) return headLast;
  const tail = session.agentStreamTail.get(agentId);
  return tail !== undefined && tail.length > 0 ? tail[tail.length - 1] : undefined;
}

/**
 * Read the active conversation's stream, reduced to plain values so zustand's
 * shallow comparison keeps the overlay from re-rendering on every streamed
 * token (a streaming delta changes the stream arrays, not these fields).
 */
function selectPetActivity(state: PetStoreSource): PetActivity {
  const active = pickActiveAgent(state);
  if (active === null) return EMPTY_ACTIVITY;
  const { session, agentId } = active;

  const userMessage = latestUserMessage(session, agentId);
  const userAt = userMessage?.timestamp.getTime() ?? 0;
  const toolCall = latestToolCall(session, agentId);
  const toolAt = toolCall?.timestamp.getTime() ?? 0;
  // A tool call from before the newest user message belongs to the previous
  // turn; using it would replay the wrong standee for the new message.
  const toolName = toolCall !== null && toolAt >= userAt ? toolCallName(toolCall) : null;
  const latest = latestStreamItem(session, agentId);
  const keywordId = userMessage === null ? null : core.matchKeyword(userMessage.text, true);

  return {
    toolName,
    toolAt: toolName === null ? 0 : toolAt,
    keywordId,
    userAt,
    thought: latest?.kind === "thought",
  };
}

/** A todo list plus the agent it belongs to. */
interface TodoListSnapshot {
  agentId: string;
  tasks: readonly TodoEntry[];
}

/**
 * The todo list of the most recently active agent that has one.
 *
 * Agents with sub-agents can carry a task list of their own, and a busy
 * sub-agent would otherwise win every activity comparison and make the
 * progress bar jump between lists. Root agents are therefore preferred; a
 * sub-agent list is only used when no root agent has tasks at all.
 *
 * The owning agent id travels with the list because the progress announcement
 * below needs it: a jump from one agent's list to another's is not forward
 * progress. The snapshot holds one of the arrays already stored in the map (so
 * zustand's shallow comparison keeps the overlay from re-rendering on unrelated
 * store updates) and the agent id that array belongs to.
 */
function selectMostRecentTodoList(state: PetStoreSource): TodoListSnapshot | null {
  let rootList: TodoListSnapshot | null = null;
  let rootActivity = Number.NEGATIVE_INFINITY;
  let otherList: TodoListSnapshot | null = null;
  let otherActivity = Number.NEGATIVE_INFINITY;

  for (const session of Object.values(state.sessions)) {
    for (const [agentId, tasks] of session.agentTasks) {
      if (tasks.length === 0) continue;
      const agent = session.agents.get(agentId);
      if (agent?.archivedAt) continue;
      const activity = (agent?.lastActivityAt ?? agent?.updatedAt)?.getTime() ?? 0;
      if (!agent?.parentAgentId) {
        if (activity > rootActivity) {
          rootActivity = activity;
          rootList = { agentId, tasks };
        }
      } else if (activity > otherActivity) {
        otherActivity = activity;
        otherList = { agentId, tasks };
      }
    }
  }

  return rootList ?? otherList;
}

export function PetOverlay() {
  const { width, height } = useWindowDimensions();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const pathname = usePathname();

  // Host signals: Paseo's own workspace buckets, mapped onto the names the
  // upstream state machine expects. `thinking` has no bucket of its own; the
  // tick derives it from the stream (a thought item streaming in an open turn).
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

  // The active conversation's newest tool call / user message / thought.
  const activity = useSessionStore(useShallow(selectPetActivity));
  const activityRef = useRef(activity);
  activityRef.current = activity;

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
  const liveLineRef = useRef(petState.line);
  liveLineRef.current = petState.line;

  // ---- todo progress -------------------------------------------------------
  // The task list is drawn as a thin bar in the bubble; a change in the number
  // of completed steps is also reported as a spoken line and a celebration pose.
  const todoList = useSessionStore(useShallow(selectMostRecentTodoList));
  const todoProgress = useMemo<TodoProgress | null>(() => {
    if (todoList === null) return null;
    const { agentId, tasks } = todoList;
    if (tasks.length === 0) return null;
    let completed = 0;
    for (const task of tasks) {
      if (task.completed) completed += 1;
    }
    return { agentId, completed, total: tasks.length };
  }, [todoList]);

  // ---- pose trigger state --------------------------------------------------
  // These are refs, not state: the 500ms tick resolves the pose and is the only
  // place that repaints, so the trigger effects must not each cause a render.
  /** Latest keyword / random-meme reaction to a user message. */
  const keywordPoseRef = useRef<{ pose: PoseName; at: number } | null>(null);
  /** Latest celebration pose for a completed todo step. */
  const celebrationRef = useRef<{ pose: PoseName; at: number } | null>(null);
  /** Latest 3-5 minute idle-variety pick; cleared by any interaction. */
  const idleRandomRef = useRef<{ pose: PoseName; pickedAt: number } | null>(null);
  /** Active pat reaction. */
  const patPoseRef = useRef<{ pose: PoseName; until: number } | null>(null);
  /** While dragging (and briefly after) the pickup standee wins. */
  const draggingRef = useRef(false);
  const dragUntilRef = useRef(0);
  /** Last direct touch; drives the upstream AFK clock. */
  const lastInteractionRef = useRef(Date.now());
  /** Last stream activity (tool call / user message); gates idle variety. */
  const lastStreamActivityRef = useRef(0);
  /** Last user message the keyword layer reacted to. */
  const lastKeywordUserAtRef = useRef(0);
  /** Timestamp of the last workspace that entered the done bucket. */
  const successAtRef = useRef(0);
  const sawDoneWorkspaceRef = useRef(false);
  /** Previous todo baseline: whose list it was and how far it had got. */
  const announcedTodoRef = useRef<{ agentId: string; completed: number } | null>(null);
  const progressLineIdRef = useRef(0);

  // A workspace finishing is the one positive event Paseo reports; feed it to
  // the state machine's success window so her success standee can appear.
  useEffect(() => {
    const hasDone = workspaceStatuses.includes("done");
    if (hasDone && !sawDoneWorkspaceRef.current) {
      successAtRef.current = Date.now();
    }
    sawDoneWorkspaceRef.current = hasDone;
  }, [workspaceStatuses]);

  // One-shot line that overrides the state machine's own dialogue. The module
  // is vendored and must not be modified, so the progress line is layered on
  // top in the renderer instead. The same event picks a celebration standee.
  const [progressLine, setProgressLine] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (todoProgress === null) {
      announcedTodoRef.current = null;
      return;
    }
    const previous = announcedTodoRef.current;
    // The baseline always follows the newest list, so the next comparison is
    // against the same agent's numbers.
    announcedTodoRef.current = {
      agentId: todoProgress.agentId,
      completed: todoProgress.completed,
    };
    // Announce only real forward progress inside one agent's own list. A fresh
    // list (first hydration) and a jump to another agent's list both rebuild the
    // baseline without speaking: "第 N 步完成了" must never describe a list that
    // simply replaced the one being watched.
    if (previous === null || previous.agentId !== todoProgress.agentId) return;
    if (todoProgress.completed <= previous.completed) return;
    const remaining = todoProgress.total - todoProgress.completed;
    const text =
      remaining <= 0
        ? `全部 ${todoProgress.total} 步都完成啦，收工！`
        : `第 ${todoProgress.completed} 步完成了，还剩 ${remaining} 个`;
    progressLineIdRef.current += 1;
    setProgressLine({ id: progressLineIdRef.current, text });
    celebrationRef.current = {
      pose: celebrationPose(todoProgress.completed, remaining <= 0),
      at: Date.now(),
    };
    idleRandomRef.current = null;
  }, [todoProgress]);

  // A new user message: react to what was said (keyword standee, or a random
  // meme when nothing matched) and reset the idle-variety layer.
  useEffect(() => {
    if (activity.userAt <= 0 || activity.userAt === lastKeywordUserAtRef.current) return;
    lastKeywordUserAtRef.current = activity.userAt;
    lastStreamActivityRef.current = Math.max(lastStreamActivityRef.current, activity.userAt);
    idleRandomRef.current = null;
    // Timeline hydration on launch replays old messages; a two-day-old "晚安"
    // must not put her to bed the moment the app opens.
    if (Date.now() - activity.userAt > KEYWORD_TRIGGER_MAX_AGE_MS) return;
    const matched: PoseName | undefined =
      activity.keywordId === null ? undefined : KEYWORD_POSES[activity.keywordId];
    keywordPoseRef.current = {
      pose: matched ?? pickRandomMemePose(),
      at: Date.now(),
    };
  }, [activity.userAt, activity.keywordId]);

  // Tool activity is not a user message, but it does mean "not idle".
  useEffect(() => {
    if (activity.toolAt <= 0) return;
    lastStreamActivityRef.current = Math.max(lastStreamActivityRef.current, activity.toolAt);
    idleRandomRef.current = null;
  }, [activity.toolAt]);

  // Idle variety: every 3-5 minutes, if the pet has been genuinely quiet, swap
  // in a daily-life / meme standee. Art only — it never speaks on its own.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = IDLE_RANDOM_MIN_MS + Math.random() * (IDLE_RANDOM_MAX_MS - IDLE_RANDOM_MIN_MS);
      timer = setTimeout(() => {
        const rawPose = (stateRef.current as PetState | undefined)?.pose;
        const lastActivity = Math.max(lastInteractionRef.current, lastStreamActivityRef.current);
        if (
          rawPose !== undefined &&
          isIdleSeriesPose(rawPose) &&
          Date.now() - lastActivity >= IDLE_RANDOM_MIN_MS
        ) {
          idleRandomRef.current = { pose: pickIdleRandomPose(), pickedAt: Date.now() };
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  // ---- state machine tick --------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const activityNow = activityRef.current;
      // A workspace bucket says only that a turn is open. While a thought item
      // is streaming she is thinking, not running a tool: split that out so the
      // state machine itself picks the thinking standee.
      const workspaceRunning = signalsRef.current.tool === true;
      const thinking = workspaceRunning && activityNow.thought;
      const next = core.computeState(
        stateRef.current,
        {
          ...signalsRef.current,
          tool: workspaceRunning && !thinking,
          thinking,
          // A pat resets the upstream idle clock; so does real work in the
          // active conversation, so she does not doze off mid-turn. The
          // workspace buckets carry no interaction timestamp of their own.
          lastInteraction: Math.max(lastInteractionRef.current, lastStreamActivityRef.current),
          // The module only accepts a success inside its own 2s window, so a
          // stale timestamp is harmless.
          successAt: successAtRef.current,
        },
        now,
        Math.random,
      );
      stateRef.current = next;
      const pose = resolveOverlayPose({
        now,
        hour: new Date(now).getHours(),
        statePose: next.pose,
        dragging: now < dragUntilRef.current,
        pat: patPoseRef.current,
        tool:
          activityNow.toolName === null
            ? null
            : { pose: resolveToolPose(activityNow.toolName), at: activityNow.toolAt },
        keyword: keywordPoseRef.current,
        celebration: celebrationRef.current,
        idleRandom: idleRandomRef.current,
      });
      // Repaint only when something the renderer draws actually changed; the
      // state machine ticks every 500ms and the pose layer keeps updating, so
      // this comparison is what keeps the overlay from re-rendering constantly.
      setPetState((current) => {
        const drawn: PetState = { ...next, pose };
        return current.pose === drawn.pose &&
          current.line === drawn.line &&
          current.speak === drawn.speak
          ? current
          : drawn;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // The state machine's own line, unless a progress line is currently speaking.
  const displayLine = progressLine === null ? petState.line : progressLine.text;
  const progressLineId = progressLine === null ? null : progressLine.id;
  // `computeState` returns `line: ""` on every tick that did not produce a new
  // line — speech is rate-limited to SPEECH_GAP_MS (6000ms) while this renderer
  // ticks every TICK_MS (500ms) — so `displayLine` is empty for most ticks.
  // Keying the typewriter off `displayLine` directly made each of those empty
  // ticks re-run the effect below, whose cleanup cleared the in-flight typing /
  // hold timers: the bubble froze on the first few characters and never hid
  // (the reported "text cut off" bug). Keep the last real line and fall back to
  // it on empty ticks, so `bubbleLine` only changes when a genuinely new line
  // arrives and the timers are left alone in between.
  const lastNonEmptyLineRef = useRef<string>("");
  const bubbleLine = displayLine || lastNonEmptyLineRef.current;

  // Typewriter: reveal the current line character by character, then hold it.
  //
  // The bubble's lifetime is owned by the hold timer, NOT by `speak`: the state
  // machine reports `speak: true` only on the tick that produced a new line and
  // flips it back on the next one. Only a *change of line* starts a bubble.
  const [typed, setTyped] = useState("");
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const lastLineRef = useRef<string>("");
  useEffect(() => {
    const line = bubbleLine;
    if (!line) return;
    // Two independent sources: a progress line is identified by its id, a
    // state-machine line by its text. Keeping the id in the key means a later
    // progress line with identical text still counts as new, while a repeat of
    // the current line (from either source) is ignored.
    const lineKey = progressLineId === null ? line : `progress:${progressLineId}:${line}`;
    if (lineKey === lastLineRef.current) return;
    lastLineRef.current = lineKey;
    lastNonEmptyLineRef.current = line;
    setBubbleVisible(true);
    setTyped("");
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      index += 1;
      setTyped(line.slice(0, index));
      if (index < line.length) {
        timer = setTimeout(step, charDelay(line[index - 1] ?? ""));
      } else {
        timer = setTimeout(() => {
          setBubbleVisible(false);
          // Hand the bubble back to the state machine after a progress line.
          // Both guards are synced to whatever line is live right now, so that
          // line is not typed out as if it had just happened, and the bubble
          // stays hidden until a genuinely new line arrives.
          if (progressLineId !== null) {
            lastLineRef.current = liveLineRef.current;
            lastNonEmptyLineRef.current = liveLineRef.current;
            setProgressLine(null);
          }
        }, BUBBLE_HOLD_MS);
      }
    };
    timer = setTimeout(step, 0);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bubbleLine, progressLineId]);

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

  // Measured size of the bubble. It lives on the host layer as an absolute
  // child of the full-screen view, so its rendered width has to be fed back in
  // before it can be clamped against the screen edges.
  const bubbleWidth = useSharedValue(0);
  const bubbleHeight = useSharedValue(0);

  const minX = EDGE_MARGIN;
  const maxX = Math.max(EDGE_MARGIN, width - PET_SIZE - EDGE_MARGIN);
  const minY = topInset + EDGE_MARGIN;
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

  /** Play wm-hop once. */
  const playHop = useCallback(() => {
    hop.value = 0;
    hop.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }),
    );
  }, [hop]);

  /**
   * A tap anywhere on the standee is a pat. The whole 96pt cell is one button:
   * the upstream build's head / belly / tail hit zones are intentionally gone.
   * Tapping plays the hop, resets the upstream idle clock, and picks a reaction
   * standee — one of the three react-* poses, or the working pat while a
   * workspace is busy.
   */
  const react = useCallback(() => {
    const now = Date.now();
    lastInteractionRef.current = now;
    const rawPose = (stateRef.current as PetState | undefined)?.pose;
    const working = rawPose === "running" || rawPose === "thinking";
    patPoseRef.current = { pose: pickPatPose(working), until: now + PAT_HOLD_MS };
    idleRandomRef.current = null;
    playHop();
  }, [playHop]);

  const dragStarted = useCallback(() => {
    draggingRef.current = true;
    dragUntilRef.current = Number.POSITIVE_INFINITY;
    idleRandomRef.current = null;
  }, []);

  const dragEnded = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragUntilRef.current = Date.now() + PICK_UP_HOLD_MS;
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          originX.value = x.value;
          originY.value = y.value;
          pressScale.value = withSpring(1.08, { damping: 20, stiffness: 220 });
          runOnJS(dragStarted)();
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
          runOnJS(dragEnded)();
        }),
    // Shared values are stable identities; this closure only reads and writes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minX, maxX, minY, maxY, persist, dragStarted, dragEnded],
  );

  const tap = useMemo(() => Gesture.Tap().maxDistance(12).onEnd(() => runOnJS(react)()), [react]);

  // A drag must not be mistaken for a tap. The long-press menu used to win over
  // both; with the menu gone the pan/tap pair is all that is left.
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

  // State -> pose -> standee. `computeState` (and the trigger layer) produce an
  // upstream pose name; `POSE_ASSETS` maps it to one of the 79 standees. This
  // link is the product: different states must look different.
  const standee = POSE_ASSETS[petState.pose as PoseName] ?? POSE_ASSETS["idle-cute"];

  /**
   * Place the bubble relative to the *current* animated pet position.
   *
   * The bubble is a child of the full-screen host, positioned at (0, 0) and
   * moved with transforms, so its layout size is untouched by where the pet is.
   * Each frame:
   *   - flip: a pet in the right half opens the bubble leftwards (bubble right
   *     edge on the pet's right edge), a pet in the left half rightwards
   *     (bubble left edge on the pet's left edge);
   *   - clamp: keep the bubble inside [EDGE_MARGIN, width - EDGE_MARGIN] using
   *     its measured width, which is what actually prevents clipping;
   *   - above the standee, or below it when there is no room above.
   */
  const bubbleStyle = useAnimatedStyle(() => {
    const measuredWidth = bubbleWidth.value;
    const measuredHeight = bubbleHeight.value;
    const petX = x.value;
    const petY = y.value;

    const opensLeft = petX + PET_SIZE / 2 > width / 2;
    const preferredLeft = opensLeft ? petX + PET_SIZE - measuredWidth : petX;
    const clampedLeft = Math.max(
      EDGE_MARGIN,
      Math.min(preferredLeft, width - EDGE_MARGIN - measuredWidth),
    );

    const aboveTop = petY - BUBBLE_GAP - measuredHeight;
    const belowTop = petY + PET_SIZE + BUBBLE_GAP;
    const preferredTop = aboveTop >= topInset + EDGE_MARGIN ? aboveTop : belowTop;
    const clampedTop = Math.max(
      topInset + EDGE_MARGIN,
      Math.min(preferredTop, height - bottomInset - EDGE_MARGIN - measuredHeight),
    );

    return {
      // Keep the bubble invisible until its size is known; otherwise it would
      // flash at the top-left corner for a frame before the first layout pass.
      opacity: measuredWidth > 0 ? 1 : 0,
      transform: [{ translateX: clampedLeft }, { translateY: clampedTop }],
    };
  }, [width, height, topInset, bottomInset]);

  const measureBubble = useCallback(
    (event: LayoutChangeEvent) => {
      bubbleWidth.value = event.nativeEvent.layout.width;
      bubbleHeight.value = event.nativeEvent.layout.height;
    },
    [bubbleWidth, bubbleHeight],
  );

  // Forget the last measurement when the bubble hides: the next line can be a
  // different width, and the bubble is invisible (opacity 0) until `onLayout`
  // reports the new size, so it never flashes at the old one.
  useEffect(() => {
    if (bubbleVisible) return;
    bubbleWidth.value = 0;
    bubbleHeight.value = 0;
  }, [bubbleVisible, bubbleWidth, bubbleHeight]);

  // The bubble may never be wider than the band the clamp above can place it
  // in, even on a narrow phone.
  const bubbleMaxWidth = Math.max(140, Math.min(BUBBLE_MAX_WIDTH, width - 2 * EDGE_MARGIN));
  const progressRatio =
    todoProgress === null ? 0 : todoProgress.completed / Math.max(1, todoProgress.total);

  if (HIDDEN_ROUTES.has(pathname)) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // receives touches. The bubble is a sibling here, on purpose — see the
    // module note about clipping.
    <View pointerEvents="box-none" style={styles.host}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityRole="imagebutton"
          accessibilityLabel="Desk pet"
          style={[styles.pet, petStyle]}
        >
          <Image source={standee} contentFit="contain" style={[styles.standee, styles.shadow]} />
        </Animated.View>
      </GestureDetector>
      {bubbleVisible && typed ? (
        <Animated.View
          onLayout={measureBubble}
          pointerEvents="none"
          style={[styles.bubble, { maxWidth: bubbleMaxWidth }, bubbleStyle]}
        >
          <Text style={styles.bubbleText}>{typed}</Text>
          {todoProgress !== null ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
            </View>
          ) : null}
        </Animated.View>
      ) : null}
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
  // Positioned from `bubbleStyle`; (0, 0) here is only the anchor the transform
  // is applied to. No fixed width: the text sizes it, `maxWidth` wraps it.
  bubble: {
    position: "absolute",
    left: 0,
    top: 0,
    flexShrink: 0,
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
  progressTrack: {
    height: 3,
    marginTop: 6,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "rgba(232, 237, 244, 0.2)",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "#8fbcff",
  },
});
