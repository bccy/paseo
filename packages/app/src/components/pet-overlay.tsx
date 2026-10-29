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
 * panel, no mini-games, and no on-screen text — the pet shows standees and
 * motion only. `computeState` still returns dialogue fields; this renderer no
 * longer reads them (`line`/`speak` are simply ignored).
 *
 * Variety: all 79 usable standees are wired to a trigger. `pose-map.ts` owns the
 * asset table and the mapping tables; `resolveOverlayPose` there decides
 * priority. The layers are:
 *   - the state machine's own pose (`running` / `thinking` / `failure` /
 *     `success` / `waiting` / `curious` are never overwritten);
 *   - a tap (whole standee is one button) or a drag — direct interaction;
 *   - while idle only: a recent tool call picks a work-* standee, a recent user
 *     message picks a keyword/meme standee, a completed todo step picks a
 *     celebration standee, and every 3-5 minutes a daily-* / meme-* standee is
 *     picked at random.
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
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShallow } from "zustand/shallow";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { KeyboardTranslateView, useKeyboardShift } from "@/keyboard/shift";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useDraftStore } from "@/stores/draft-store";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { usePetLedgeStore, selectPetLedgeClaim } from "@/stores/pet-ledge-store";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useWorkspaceTabSwitcherStore } from "@/stores/workspace-tab-switcher-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import type { AgentToolCallData, StreamItem, TodoEntry, UserMessageItem } from "@/types/stream";
import {
  IDLE_RANDOM_MAX_MS,
  IDLE_RANDOM_MIN_MS,
  KEYWORD_POSES,
  PAT_HOLD_MS,
  PEEK_POSES,
  PICK_UP_HOLD_MS,
  PICK_UP_POSE,
  POSE_ASSETS,
  celebrationPose,
  clampToBounds,
  isIdleSeriesPose,
  parseStoredPosition,
  BOTTOM_PEEK_SCALE,
  peekShift,
  peekReleaseThreshold,
  peekSnapThreshold,
  pickIdleRandomPose,
  pickRandomMemePose,
  nextPatPose,
  resolveOverlayPose,
  resolveToolPose,
  WORKING_PAT_POSE,
  type PeekEdge,
  type PoseName,
  type StoredPetPosition,
} from "../pets/pose-map";
import {
  foldDragOffsets,
  projectReleasePoint,
  resolveBottomPeekXRange,
  resolveKeyboardTopClamp,
  resolvePetLayerLift,
  resolvePetSpriteScale,
  resolveCancelledDropResting,
  resolveRestBounds,
  resolveSettledDropEdge,
  snapPetToPeekEdge,
} from "../pets/ledge";
import { insertLatestPhotoIntoDraft } from "../pets/pet-latest-photo";
import {
  buildPetSlashCommands,
  type PetSlashCommand,
  type RemoteSlashCommand,
} from "../pets/pet-slash-commands";
import { resolvePetPhotoFeedback } from "../pets/pet-photo-feedback";
import { resolveTapBurstAction, TAP_BURST_WINDOW_MS } from "../pets/pet-taps";
import { PetCommandMenu } from "../pets/pet-command-menu";

// The upstream state machine is a UMD module with no DOM dependencies. Vendored
// verbatim so its pose rules stay byte-identical to the source instead of
// drifting in a hand port. There are no type declarations for it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("../pets/whale-moe-core.js") as {
  computeState: (
    prev: unknown,
    signals: Record<string, unknown>,
    now: number,
    rng: () => number,
  ) => MachineSnapshot;
  matchKeyword: (text: string, enabled: boolean) => string | null;
};

/**
 * The slice of `computeState`'s return value this renderer reads.
 *
 * The module also returns the spoken line and a `speak` flag; the desk pet no
 * longer shows dialogue, so those fields are deliberately not declared/read
 * here. The *complete* previous return value is still fed back in on every tick
 * (see `stateRef`) because the module keeps its own memory inside it.
 */
interface MachineSnapshot {
  pose: string | null;
}

/** On-screen size of the standee, in points. Deliberately smaller than upstream. */
const PET_SIZE = 85;
/** Source pixels per point, used to rescale the upstream pixel amounts. */
const ART_TO_SCREEN = PET_SIZE / 512;

const STORAGE_KEY = "paseo.pet.position.v1";
/**
 * How far the resting *cell* stops short of an edge, in points.
 *
 * The cell is not what the user sees: the 512px standees carry transparent
 * padding on every side (about 12.6pt per side at the shipped size for the
 * default idle art, ~10.1pt for the pick-up pose drawn during a drag), so a
 * 10pt margin here added a second invisible gap on top of the one already in
 * the art — the pet looked like it floated ~23pt away from the edge.
 *
 * 2pt only keeps the drop shadow from being cut off by the window edge. Peek
 * shifts are compensated by `peekShift`, so this value moves the full-body rest
 * position without moving a peek's crop line.
 */
const EDGE_MARGIN = 2;
/** How far from an edge a free drop counts as "hang her there", in points. */
const PEEK_SNAP_PX = peekSnapThreshold(PET_SIZE);
/**
 * How far a drag that *started* on an edge must be pulled to come off it, in
 * points. Larger than `PEEK_SNAP_PX` on purpose — see `PEEK_RELEASE_RATIO`.
 */
const PEEK_RELEASE_PX = peekReleaseThreshold(PET_SIZE);
/**
 * The settle spring.
 *
 * Critically damped on purpose (ζ = 1 needs `damping = 2 * sqrt(stiffness)`; at
 * stiffness 180 that is ~26.8). The old `{ damping: 18, stiffness: 180 }` was
 * underdamped (ζ ≈ 0.67), so the axis crossing the edge overshot the crop line and
 * bounced back, which read as jitter on the input bar.
 */
const SETTLE_SPRING = { damping: 27, stiffness: 180 } as const;
/**
 * How much of the release velocity the settle spring is given.
 *
 * Handing the spring the full velocity is what makes the settle continue the
 * gesture instead of restarting from rest, but a critically damped spring does
 * not stop dead where it is aimed: released with velocity `v` it still travels
 * roughly `v / (ωn * e)` further, which at the shipped spring
 * (`ωn = sqrt(180) ≈ 13.4`) is ~55pt for a 2000pt/s flick. That extra travel is
 * the main reason a small nudge threw the pet across the screen — the flick
 * projection was already accounted for separately.
 *
 * 0.35 keeps the direction and the sense of momentum while cutting that
 * overtravel to ~19pt.
 */
const RELEASE_VELOCITY_SCALE = 0.35;
/**
 * Duration of the non-spring transitions that belong to the same settle: the peek
 * weight (scale + idle damping) and the keyboard top clamp. Long enough to read as
 * motion, short enough not to lag the finger.
 */
const SETTLE_MS = 220;
/**
 * How far ahead a release is projected, in milliseconds.
 *
 * `Gesture.Pan` reports velocity in points per second, so a release glides
 * `velocity * (FLICK_PROJECTION_MS / 1000)` points. The projected point is then
 * measured against the edges with the normal snap threshold, which is what makes a
 * deliberate flick attach while a slow release in the middle of the screen stays
 * put.
 *
 * 60ms, not 140ms. At 140ms a light 800pt/s throw glided 112pt — far enough that
 * a pet released well inside the screen still flew to an edge. 60ms is closer to
 * "the hand stopped, so the pet stops".
 */
const FLICK_PROJECTION_MS = 60;
/**
 * The spring UIKit runs the keyboard on, for the iOS keyboard clamp.
 *
 * On iOS the Reanimated keyboard value jumps to its target when the motion starts,
 * while the pet layer rides the native-driver translation frame by frame. Springing
 * the clamp with the keyboard's own physics keeps a pet pushed down from the top in
 * step with the layer instead of landing one keyboard-motion early.
 * `react-native-keyboard-controller` reads the live `CASpringAnimation` off the
 * keyboard layer; these are the values UIKit uses for it, so this is a close
 * approximation, not the measured curve.
 */
const IOS_KEYBOARD_SPRING = { mass: 3, stiffness: 1000, damping: 500 } as const;
/**
 * Cross-fade for a standee swap.
 *
 * The old swap dimmed the whole sprite to 20% and bounced it. `expo-image`'s own
 * `transition` cross-dissolves the two images inside the view instead, so the pet
 * never goes translucent and the frames never flash. Shorter than the old 260ms:
 * a cross-fade reads as a swap, not as an animation to watch.
 */
const POSE_TRANSITION = { duration: 160, timing: "ease-out", effect: "cross-dissolve" } as const;

/** Screens where a pet would be noise rather than company. */
const HIDDEN_ROUTES = new Set(["/welcome", "/pair-scan", "/open-project"]);

/** Upstream soft-set keyframes, rescaled out of the 512px standee space. */
const BREATHE_PX = 4 * ART_TO_SCREEN * 2;
const HOP_PX = 8 * ART_TO_SCREEN * 2;

/** State machine tick. */
const TICK_MS = 500;
/**
 * A user message older than this did not just arrive (it came from timeline
 * hydration on launch), so it must not trigger a keyword / meme reaction.
 */
const KEYWORD_TRIGGER_MAX_AGE_MS = 5 * 60 * 1000;

/** How much of the most recent todo list is done, and whose list it is. */
interface TodoTally {
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
  /**
   * The agent these signals belong to, or `null` when nothing is active.
   *
   * The edge effects below (turn closed, attention rose) are only meaningful within
   * one conversation: switching from a running agent to an idle one closes no turn
   * of the idle one's, but a bare boolean comparison sees "was open, now closed" and
   * fires a spurious success. Carrying the id lets those effects rebuild their
   * baseline on an agent change instead of firing.
   */
  agentId: string | null;
  /** Newest agent tool call that is still executing in the open turn, if any. */
  runningToolName: string | null;
  /** The shell command that running tool is executing (null when unavailable). */
  runningToolCommand: string | null;
  /** When that running tool call started (ms). */
  runningToolAt: number;
  /** Newest agent tool call of any status in the current/last turn. */
  recentToolName: string | null;
  /** The shell command that recent tool ran (null when unavailable). */
  recentToolCommand: string | null;
  /** When that most recent tool call started (ms). */
  recentToolAt: number;
  /** The active turn is open (`agent.turn.phase === "open"`). */
  turnOpen: boolean;
  /** A thought is streaming right now (open turn + newest item is loading). */
  thought: boolean;
  /** `matchKeyword` id for the newest user message, or null when none matched. */
  keywordId: string | null;
  /** When the newest user message was sent (ms). */
  userAt: number;
  /** The active agent's lifecycle status is "error". */
  agentError: boolean;
  /** The active agent is blocked on a pending permission request. */
  hasPendingPermission: boolean;
  /** The active agent flags that it wants the user's attention. */
  requiresAttention: boolean;
}

const EMPTY_ACTIVITY: PetActivity = {
  agentId: null,
  runningToolName: null,
  runningToolCommand: null,
  runningToolAt: 0,
  recentToolName: null,
  recentToolCommand: null,
  recentToolAt: 0,
  turnOpen: false,
  thought: false,
  keywordId: null,
  userAt: 0,
  agentError: false,
  hasPendingPermission: false,
  requiresAttention: false,
};

interface ActiveAgent {
  session: SessionState;
  agentId: string;
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

interface AgentToolMoment {
  name: string;
  /** Shell command the call ran, when the detail is a `shell` detail. */
  command: string | null;
  at: number;
}

/**
 * The shell command a tool call ran, if its detail carries one.
 *
 * `ToolCallDetail` is a discriminated union and only the `shell` variant has a
 * `command`; every other kind (read / edit / search / fetch / ...) returns null,
 * in which case the pose mapping falls back to the tool name.
 */
function toolCommandText(data: AgentToolCallData): string | null {
  const detail: unknown = data.detail;
  if (detail === null || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  return record.type === "shell" && typeof record.command === "string" ? record.command : null;
}

/**
 * Newest agent tool call of the current/last turn that `accept` matches.
 *
 * Only agent tool calls count (orchestrator calls are host bookkeeping). The
 * walk stops at a user message from another turn; a **steering** message was
 * sent into the open turn (`turnId === openTurnId`) while the tool it steers is
 * still the current one, so the scan continues past it.
 */
function latestAgentToolCall(
  session: SessionState,
  agentId: string,
  openTurnId: string | null,
  accept: (data: AgentToolCallData) => boolean,
): AgentToolMoment | null {
  const streams = [session.agentStreamHead.get(agentId), session.agentStreamTail.get(agentId)];
  for (const items of streams) {
    if (items === undefined) continue;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item === undefined) continue;
      if (item.kind === "user_message") {
        if (openTurnId !== null && item.turnId === openTurnId) continue;
        return null;
      }
      if (item.kind !== "tool_call") continue;
      if (item.payload.source !== "agent") continue;
      if (!accept(item.payload.data)) continue;
      return {
        name: item.payload.data.name,
        command: toolCommandText(item.payload.data),
        at: item.timestamp.getTime(),
      };
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
/** Whether the agent's newest stream item is a thought still streaming. */
function isThoughtStreaming(session: SessionState, agentId: string, turnOpen: boolean): boolean {
  if (!turnOpen) return false;
  const latest = latestStreamItem(session, agentId);
  return latest !== undefined && latest.kind === "thought" && latest.status === "loading";
}

/**
 * The tool calls the pet mirrors: the one executing now (if any) and the newest of
 * any status.
 *
 * A tool only counts as "running" while its own status says so AND its turn is
 * still open — a canceled turn may leave a stale `running` flag in the stream. The
 * newest call of any status feeds the "just did this" standee and smooths the
 * running -> finished boundary.
 */
function selectToolMoments(
  session: SessionState,
  agentId: string,
  turnOpen: boolean,
  openTurnId: string | null,
): { running: AgentToolMoment | null; recent: AgentToolMoment | null } {
  return {
    running: turnOpen
      ? latestAgentToolCall(session, agentId, openTurnId, (data) => data.status === "running")
      : null,
    recent: latestAgentToolCall(session, agentId, openTurnId, () => true),
  };
}

/** The flat tool fields, so `selectPetActivity` stays under the complexity cap. */
function toolFields(tools: {
  running: AgentToolMoment | null;
  recent: AgentToolMoment | null;
}): Pick<
  PetActivity,
  | "runningToolName"
  | "runningToolCommand"
  | "runningToolAt"
  | "recentToolName"
  | "recentToolCommand"
  | "recentToolAt"
> {
  return {
    runningToolName: tools.running?.name ?? null,
    runningToolCommand: tools.running?.command ?? null,
    runningToolAt: tools.running?.at ?? 0,
    recentToolName: tools.recent?.name ?? null,
    recentToolCommand: tools.recent?.command ?? null,
    recentToolAt: tools.recent?.at ?? 0,
  };
}

/** The keyword id for the newest user message, or `null` when nothing matched. */
function keywordIdOf(userMessage: UserMessageItem | null): string | null {
  return userMessage === null ? null : core.matchKeyword(userMessage.text, true);
}

function selectPetActivity(state: PetStoreSource): PetActivity {
  const active = pickActiveAgent(state);
  if (active === null) return EMPTY_ACTIVITY;
  const { session, agentId } = active;

  const userMessage = latestUserMessage(session, agentId);
  // Turn + agent state of the conversation the pet mirrors. Signals are read
  // from this agent only — the old workspace-bucket union let another project,
  // terminal or sub-agent light the pet up.
  const agent = session.agents.get(agentId);
  const turn = agent?.turn;
  const turnOpen = turn?.phase === "open";
  const openTurnId = turnOpen ? (turn?.turnId ?? null) : null;
  const tools = selectToolMoments(session, agentId, turnOpen, openTurnId);

  return {
    ...toolFields(tools),
    agentId,
    turnOpen,
    thought: isThoughtStreaming(session, agentId, turnOpen),
    keywordId: keywordIdOf(userMessage),
    userAt: userMessage?.timestamp.getTime() ?? 0,
    agentError: agent?.status === "error",
    hasPendingPermission: (agent?.pendingPermissions.length ?? 0) > 0,
    requiresAttention: agent?.requiresAttention === true,
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
  const toast = useToast();
  const pathname = usePathname();

  // The active conversation's running/recent tool call, user message, thought
  // and agent state — every signal below is scoped to this agent.
  const activity = useSessionStore(useShallow(selectPetActivity));
  const activityRef = useRef(activity);
  activityRef.current = activity;

  // The state machine carries its own memory (idle clock, line counters) inside
  // the previous return value, so the complete object must be fed back in on
  // every tick — even though this renderer only reads its `pose`.
  const stateRef = useRef<unknown>(undefined);
  if (stateRef.current === undefined) {
    stateRef.current = core.computeState(undefined, {}, Date.now(), Math.random);
  }

  const [petPose, setPetPose] = useState<PoseName>(() => {
    const initial = (stateRef.current as MachineSnapshot).pose;
    return initial !== null && initial in POSE_ASSETS ? (initial as PoseName) : "idle-cute";
  });

  // ---- todo progress -------------------------------------------------------
  // No progress bar is drawn; the only thing the task list still drives is the
  // celebration standee on a completed step.
  const todoList = useSessionStore(useShallow(selectMostRecentTodoList));
  const todoTally = useMemo<TodoTally | null>(() => {
    if (todoList === null) return null;
    const { agentId, tasks } = todoList;
    if (tasks.length === 0) return null;
    let completed = 0;
    for (const task of tasks) {
      if (task.completed) completed += 1;
    }
    return { agentId, completed, total: tasks.length };
  }, [todoList]);

  // ---- focused chat + command menu -----------------------------------------
  // The overlay lives outside the composer, so its actions resolve the focused
  // chat through the same global stores the "add file to chat" flow uses. The
  // active workspace wins; the last-visited workspace keeps the actions usable
  // from screens without a workspace route (e.g. the project list).
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const chatSelection = activeWorkspaceSelection ?? lastWorkspaceSelection;
  const workspaceKey = chatSelection ? buildWorkspaceTabPersistenceKey(chatSelection) : null;
  const workspaceLayout = useWorkspaceLayoutStore((state) =>
    workspaceKey === null ? undefined : state.layoutByWorkspace[workspaceKey],
  );
  const focusedChat = useMemo(
    () =>
      chatSelection === null
        ? null
        : resolveFocusedChatTarget({ serverId: chatSelection.serverId, layout: workspaceLayout }),
    [chatSelection, workspaceLayout],
  );
  const focusedDraftKeyRef = useRef<string | null>(null);
  focusedDraftKeyRef.current = focusedChat?.draftKey ?? null;

  // Server-side slash commands (model, mode, compact, …). The composer queries
  // these through a hook that only runs inside a retained panel; the pet sits at
  // the app root, so it asks the daemon client for the focused agent directly.
  const petServerId = chatSelection?.serverId ?? "";
  const petAgentId = focusedChat?.agentId ?? null;
  const petHostClient = useHostRuntimeClient(petServerId);
  // `useFetchQuery` rather than a bare `useQuery`: this file is not allowed to
  // import `@tanstack/react-query` directly (lint: no-restricted-imports). The
  // fetch variant is the plain one-shot read this is — nothing pushes updates for
  // a daemon's command list.
  const { data: remoteSlashCommands } = useFetchQuery({
    queryKey: ["pet-slash-commands", petServerId, petAgentId],
    queryFn: async (): Promise<RemoteSlashCommand[]> => {
      if (petHostClient === null || petAgentId === null) return [];
      const response = await petHostClient.listCommands({ agentId: petAgentId });
      return response.commands as RemoteSlashCommand[];
    },
    enabled: petHostClient !== null && petAgentId !== null,
    staleTimeMs: 60_000,
    dataShape: "list",
  });

  const [commandMenuVisible, setCommandMenuVisible] = useState(false);
  const slashCommands = useMemo<PetSlashCommand[]>(
    () => buildPetSlashCommands(remoteSlashCommands ?? []),
    [remoteSlashCommands],
  );

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
  /** Monotonic pat counter; drives the non-repeating standee rotation. */
  const patRotationRef = useRef(0);
  /** While dragging (and briefly after) the pickup standee wins. */
  const draggingRef = useRef(false);
  const dragUntilRef = useRef(0);
  /** Last direct touch; drives the upstream AFK clock. */
  const lastInteractionRef = useRef(Date.now());
  /** Last stream activity (tool call / user message); gates idle variety. */
  const lastStreamActivityRef = useRef(0);
  /**
   * Per-agent baseline for the keyword layer: the newest `userAt` already reacted
   * to.
   *
   * A single global timestamp was wrong in both directions. Going A -> B -> A
   * replayed A's old message as if it were new (its timestamp differed from B's, so
   * the dedupe missed it); and a genuinely new message could be skipped if its
   * timestamp happened to match. Keying on the agent makes "new" mean "this agent's
   * newest message advanced".
   */
  const lastKeywordUserAtByAgentRef = useRef(new Map<string, number>());
  /** Set on the open -> closed turn edge; the module shows success for 2s. */
  const successAtRef = useRef(0);
  /** Set on a fresh user message / attention rising edge (6s curious window). */
  const curiousAtRef = useRef(0);
  /**
   * Edge baselines, tagged with the agent they belong to.
   *
   * A bare boolean is not enough: switching from a running agent A to an idle
   * agent B looks like "turn was open, now closed" and fired a spurious success,
   * and the same for attention. The id makes an agent change rebuild the baseline
   * silently instead of producing an edge.
   */
  const previousTurnOpenRef = useRef<{ agentId: string | null; open: boolean }>({
    agentId: null,
    open: false,
  });
  const previousRequiresAttentionRef = useRef<{ agentId: string | null; requiring: boolean }>({
    agentId: null,
    requiring: false,
  });
  /** Previous todo baseline: whose list it was and how far it had got. */
  const previousTodoRef = useRef<{ agentId: string; completed: number } | null>(null);

  // Success is an *edge*: the active turn going open -> closed (the previous
  // implementation watched a `done` bucket that was already true at launch and
  // then stayed true, so the success standee was effectively unreachable).
  // Scoped to one agent: an agent change only rebuilds the baseline.
  useEffect(() => {
    const previous = previousTurnOpenRef.current;
    previousTurnOpenRef.current = { agentId: activity.agentId, open: activity.turnOpen };
    if (previous.agentId !== activity.agentId) return;
    if (previous.open && !activity.turnOpen) successAtRef.current = Date.now();
  }, [activity.agentId, activity.turnOpen]);

  // Curiosity is an *edge* too: the agent starting to require attention, again
  // scoped to one agent.
  useEffect(() => {
    const previous = previousRequiresAttentionRef.current;
    previousRequiresAttentionRef.current = {
      agentId: activity.agentId,
      requiring: activity.requiresAttention,
    };
    if (previous.agentId !== activity.agentId) return;
    if (activity.requiresAttention && !previous.requiring) curiousAtRef.current = Date.now();
  }, [activity.agentId, activity.requiresAttention]);

  // A completed todo step swaps in a celebration standee. Only real forward
  // progress inside one agent's own list counts: a fresh list (first hydration)
  // and a jump to another agent's list both rebuild the baseline silently.
  useEffect(() => {
    if (todoTally === null) {
      previousTodoRef.current = null;
      return;
    }
    const previous = previousTodoRef.current;
    // The baseline always follows the newest list, so the next comparison is
    // against the same agent's numbers.
    previousTodoRef.current = {
      agentId: todoTally.agentId,
      completed: todoTally.completed,
    };
    if (previous === null || previous.agentId !== todoTally.agentId) return;
    if (todoTally.completed <= previous.completed) return;
    celebrationRef.current = {
      pose: celebrationPose(todoTally.completed, todoTally.completed >= todoTally.total),
      at: Date.now(),
    };
    idleRandomRef.current = null;
  }, [todoTally]);

  // A new user message: react to what was said (keyword standee, or a random
  // meme when nothing matched) and reset the idle-variety layer.
  //
  // Deduped per agent. The first sighting of an agent counts as "new" only
  // when its message is recent: switching to a conversation whose newest message is
  // hours old must not replay a reaction, while switching to one the user just
  // typed into should.
  useEffect(() => {
    const agentId = activity.agentId;
    if (agentId === null || activity.userAt <= 0) return;
    const baselines = lastKeywordUserAtByAgentRef.current;
    const previous = baselines.get(agentId);
    if (previous !== undefined && activity.userAt <= previous) return;
    baselines.set(agentId, activity.userAt);
    lastStreamActivityRef.current = Math.max(lastStreamActivityRef.current, activity.userAt);
    idleRandomRef.current = null;
    // Timeline hydration on launch replays old messages; a two-day-old "晚安"
    // must not put her to bed the moment the app opens. A first sighting of an
    // agent uses the same window, so a stale conversation stays quiet.
    if (Date.now() - activity.userAt > KEYWORD_TRIGGER_MAX_AGE_MS) return;
    // The user just spoke to this conversation: a rising edge for curiosity.
    curiousAtRef.current = Date.now();
    const matched: PoseName | undefined =
      activity.keywordId === null ? undefined : KEYWORD_POSES[activity.keywordId];
    keywordPoseRef.current = {
      pose: matched ?? pickRandomMemePose(),
      at: Date.now(),
    };
  }, [activity.agentId, activity.userAt, activity.keywordId]);

  // Tool activity is not a user message, but it does mean "not idle".
  useEffect(() => {
    if (activity.recentToolAt <= 0) return;
    lastStreamActivityRef.current = Math.max(lastStreamActivityRef.current, activity.recentToolAt);
    idleRandomRef.current = null;
  }, [activity.recentToolAt]);

  // Idle variety: every 3-5 minutes, if the pet has been genuinely quiet, swap
  // in a daily-life / meme standee. Art only — no dialogue is displayed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = IDLE_RANDOM_MIN_MS + Math.random() * (IDLE_RANDOM_MAX_MS - IDLE_RANDOM_MIN_MS);
      timer = setTimeout(() => {
        const rawPose = (stateRef.current as MachineSnapshot | undefined)?.pose;
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
      // `thinking` = a thought is streaming in the open turn.
      const thinking = activityNow.thought;
      // A pending permission is the agent waiting on the user; it must win over
      // the round-level busy fallback below so `waiting` is actually visible.
      const waiting = activityNow.hasPendingPermission;
      // `tool` = a tool is executing right now, OR the turn is open and the
      // agent is neither thinking nor waiting (pure text generation). The
      // fallback is what keeps the pet in the "working" standee for a whole
      // turn instead of dropping to idle between tool calls.
      const tool =
        !waiting && (activityNow.runningToolName !== null || (activityNow.turnOpen && !thinking));
      if (activityNow.turnOpen) {
        // Keep the "last activity" clock fresh while the turn is open, so she
        // does not drop straight into the AFK pose when the turn ends.
        lastStreamActivityRef.current = now;
      }
      const next = core.computeState(
        stateRef.current,
        {
          tool,
          thinking,
          waiting,
          error: activityNow.agentError,
          curiousAt: curiousAtRef.current,
          successAt: successAtRef.current,
          denseCode: false,
          petDisabled: false,
          // A pat resets the upstream idle clock; an open turn does too, so she
          // does not doze off while the agent is still working.
          lastInteraction: activityNow.turnOpen
            ? now
            : Math.max(lastInteractionRef.current, lastStreamActivityRef.current),
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
        // Two separate inputs: the running tool (no recency window) and the
        // newest call of any status (the 60s "just finished" window).
        tool:
          activityNow.runningToolName === null
            ? null
            : {
                pose: resolveToolPose(activityNow.runningToolName, activityNow.runningToolCommand),
                at: activityNow.runningToolAt,
              },
        recentTool:
          activityNow.recentToolName === null
            ? null
            : {
                pose: resolveToolPose(activityNow.recentToolName, activityNow.recentToolCommand),
                at: activityNow.recentToolAt,
              },
        keyword: keywordPoseRef.current,
        celebration: celebrationRef.current,
        idleRandom: idleRandomRef.current,
      });
      // Repaint only when the standee actually changes; the state machine ticks
      // every 500ms and the pose layer keeps updating, so this comparison is what
      // keeps the overlay from re-rendering constantly.
      setPetPose((current) => (current === pose ? current : pose));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Motion drivers. `breathe` and `sway` loop forever; `hop` is a one-shot
  // retriggered by a tap. A pose change is a cross-fade inside the `Image`, not a
  // transform on this view, so there is no third one-shot here any more.
  const breathe = useSharedValue(0);
  const sway = useSharedValue(0);
  const hop = useSharedValue(0);
  /**
   * A 0 -> 1 "settle" that eases the idle damping while she hangs off any edge.
   *
   * It used to switch instantly, so landing and leaving both snapped. The
   * breathing and the sway read it together; the bottom peek's shrink has its own
   * weight below.
   */
  const peekWeight = useSharedValue(0);
  /**
   * The bottom peek's own 0 -> 1 settle, for its 90% shrink.
   *
   * Separate from `peekWeight` because only the bottom peek shrinks: driving the
   * scale off the shared weight shrank the side peeks too.
   */
  const bottomWeight = useSharedValue(0);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  // Extra offset applied on top of `x`/`y` while she hangs off an edge. Kept as
  // its own pair of shared values so the *stored* position stays the plain
  // resting cell: leaving the edge only animates these back to zero instead of
  // having to un-bake a shift out of the saved coordinates.
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  /** Which edge the drag started from, so the drop handler can tell a pull-away from a nudge. */
  const dragStartEdge = useSharedValue<PeekEdge | null>(null);
  /**
   * Whether `onEnd` already placed the cell.
   *
   * `onFinalize` runs after `onEnd` on every gesture, cancelled or not, and it
   * reads `x`/`y` — which a spring assignment has already reset to its *start*
   * value. Settling again from there overwrites the snapped target, leaving the
   * standee up to a threshold away from the edge it just attached to.
   */
  const dragSettled = useSharedValue(false);
  /**
   * The keyboard-driven clamp, in points.
   *
   * The pet layer rides the composer's translation (see `petTranslation`), so
   * opening the keyboard moves the pet *up* and one parked near the top would leave
   * the window. It goes back to zero when the keyboard closes, which puts the pet
   * back where the user left her with no remembered "pre-keyboard" position that
   * could go stale.
   *
   * It follows `keyboard/shift`'s `shift`, not `layoutShift`: `layoutShift` keeps
   * the opening reservation until the closing motion has ended, so a clamped pet
   * would ride down with the layer and pop back up afterwards.
   *
   * `shift` behaves differently per platform (`react-native-keyboard-controller`
   * writes its Reanimated values on `onKeyboardMoveStart` on iOS and on every
   * `onKeyboardMove` on Android). On Android it is the per-frame driver the layer
   * itself rides, so the clamp is assigned directly. On iOS it jumps to the target
   * when the motion starts while the layer animates on the native driver, so the
   * clamp springs there instead — see `IOS_KEYBOARD_SPRING`.
   *
   * The raw shift is then converted to the pet layer's own lift
   * (`resolvePetLayerLift`), because a centered dock lifts its form by
   * `shift - bottomClearance` and a layer with no claim does not move at all.
   */
  const { shift: keyboardShift } = useKeyboardShift();
  const keyboardClamp = useSharedValue(0);
  /**
   * The lift the clamp was computed against.
   *
   * The clamp is a function of both the keyboard and where the pet currently is, so
   * it is recomputed when either moves: the keyboard's own motion, and the end of a
   * drag or settle (a pet dragged up while the keyboard is open must not be pushed
   * off the top).
   */
  const clampLift = useSharedValue(0);

  // The composer that owns the visible input box reports its ledge; the pet layer
  // reproduces that composer's own keyboard translation so every coordinate here
  // lives in the keyboard-closed frame.
  const ledgeClaim = usePetLedgeStore(selectPetLedgeClaim);
  const ledge = ledgeClaim?.ledge ?? null;
  /**
   * The `KeyboardTranslateView` props the pet layer is wrapped in.
   *
   * Same object the dock hands its own view, so both move on the same driver. With
   * no composer claiming the ledge (settings, the project list) nothing translates
   * and the pet simply stays put.
   */
  const petTranslation = useMemo(
    () => ledgeClaim?.translation ?? { enabled: false, bottomClearance: 0 },
    [ledgeClaim],
  );
  /**
   * `petTranslation` for the keyboard reaction.
   *
   * A worklet captures a snapshot of what it closes over when the handler is first
   * serialised, so reading the memo directly would pin the translation from the
   * first render. The ref is the live value: the reaction re-reads it on every
   * keyboard change, which is exactly when the claim can have moved to another
   * composer with a different clearance.
   */
  const petTranslationRef = useRef(petTranslation);
  petTranslationRef.current = petTranslation;

  const bounds = useMemo(
    () =>
      resolveRestBounds({
        width,
        height,
        size: PET_SIZE,
        edgeMargin: EDGE_MARGIN,
        topInset,
        bottomInset,
        ledge,
      }),
    [width, height, topInset, bottomInset, ledge],
  );
  const { minX, maxX, minY, maxY } = bounds;
  /**
   * How far a bottom peek's cell may travel sideways.
   *
   * A centered form does not span the screen, so without this the peek hangs in
   * the air beside the input box instead of on it.
   */
  const bottomPeekX = useMemo(
    () => resolveBottomPeekXRange({ ledge, size: PET_SIZE, minX, maxX }),
    [ledge, minX, maxX],
  );
  /**
   * Bounds and the peek range, as a shared value.
   *
   * The pan gesture must not be rebuilt when they change: a new gesture object
   * mid-drag is cancelled by RNGH, which is what made a viewport change (a
   * multi-line draft, the keyboard, a rotation) drop the pet out of the user's
   * hand. The gesture therefore closes over this one stable value.
   */
  const boundsShared = useSharedValue({ minX, maxX, minY, maxY });
  const bottomPeekXShared = useSharedValue(bottomPeekX);
  useEffect(() => {
    boundsShared.value = { minX, maxX, minY, maxY };
    bottomPeekXShared.value = bottomPeekX;
  }, [boundsShared, bottomPeekXShared, minX, maxX, minY, maxY, bottomPeekX]);

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

  const persist = useCallback((nextX: number, nextY: number, edge: PeekEdge | null) => {
    // A full-body position is written without the field at all, so a build from
    // before the edge feature reads the same record unchanged.
    const stored: StoredPetPosition =
      edge === null ? { x: nextX, y: nextY, edge: null } : { x: nextX, y: nextY, edge };
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => {
      // Persisting a pet position is best-effort: a failure only costs the
      // position on the next launch.
    });
  }, []);

  /**
   * The peek edge as React state, for the standee the renderer draws.
   *
   * The animation side of the snap lives in shared values; this mirror exists
   * only because picking the art is a React render, not a style. A drag clears
   * it immediately (a lifted pet is full-body), and the drop sets it again.
   *
   * The UI-thread shared value is the truth (see `peekEdgeShared`); this is only a
   * projection of it for the render, written from `applyPeek` and the drop
   * handler. Nothing writes the shared value from here, so a slow JS render can
   * never overwrite an edge the gesture already chose.
   */
  const [peekEdge, setPeekEdge] = useState<PeekEdge | null>(null);
  /**
   * The edge, in a form the gesture worklets can actually read.
   *
   * A plain ref does not work here: worklets capture a *clone* of whatever they
   * close over, so the UI thread keeps the `.current` it saw when the handler was
   * first serialised — which is `null`, before any drop. Writing the ref later
   * never reaches it, which silently killed every branch that asked "did this
   * drag start on an edge".
   *
   * This is the single source of truth for the edge. JS state mirrors it one-way
   * for the standee choice; the effect that used to write *back* into it is gone,
   * because it could land after `onEnd` had already set a new edge and overwrite
   * it with a stale `null`.
   */
  const peekEdgeShared = useSharedValue<PeekEdge | null>(null);
  /** Drop the peek on the JS side too, without touching the shared truth. */
  const clearPeek = useCallback(() => setPeekEdge(null), []);

  /**
   * Apply an edge without a drag: restore, and any path that re-settles the cell.
   *
   * The weights are animated rather than assigned so the bottom peek's 90% scale
   * and the idle damping arrive with the cell instead of snapping.
   */
  const applyPeek = useCallback(
    (edge: PeekEdge | null, nextX: number, nextY: number) => {
      const shift = peekShift(edge, PET_SIZE, EDGE_MARGIN);
      shiftX.value = shift.x;
      shiftY.value = shift.y;
      peekWeight.value = withTiming(edge === null ? 0 : 1, { duration: SETTLE_MS });
      bottomWeight.value = withTiming(edge === "bottom" ? 1 : 0, { duration: SETTLE_MS });
      x.value = nextX;
      y.value = nextY;
      peekEdgeShared.value = edge;
      setPeekEdge(edge);
    },
    // Shared values are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Restore the stored position once on mount.
  //
  // The record keeps its old meaning: `x`/`y` are the resting cell of a full-body
  // pet, and `edge` names the edge she hangs from. Both are keyboard-independent —
  // the ledge is a measured ledge in keyboard-closed space, so an old record
  // restores onto whatever the current input box is, exactly as it did before.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || raw === null) return undefined;
        // Parsing lives in `pose-map` so the upgrade path (a record written
        // before the edge feature existed) is covered by its own tests.
        const stored = parseStoredPosition(raw);
        if (stored === null) return undefined;
        // Read the live bounds, not this mount-time closure: the composer usually
        // reports its ledge before storage answers, and a bottom peek restored
        // against the pre-ledge bounds (or outside the input box's columns) would
        // stay there, since nothing else changes afterwards to re-settle it.
        const liveBounds = boundsShared.value;
        const resting = snapPetToPeekEdge(
          stored.edge,
          clampToBounds(stored, liveBounds),
          liveBounds,
          bottomPeekXShared.value,
        );
        applyPeek(stored.edge, resting.x, resting.y);
        return undefined;
      })
      .catch(() => {
        // Unreadable storage just leaves the pet at its default corner.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only on purpose; viewport changes are settled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default corner on first layout, then follow the bounds when they change.
  //
  // A bounds change is not an assignment any more. The keyboard no longer moves
  // `maxY` at all (the pet layer is translated with the composer instead), so what
  // is left is a real layout change: a multi-line draft growing the input box, the
  // attachment tray, a rotation. Assigning `x`/`y` there cancelled the settle
  // spring that was still running and made the pet jump; a spring to the new
  // resting point keeps a drop in flight intact and still ends up in the right
  // place.
  const placed = useRef(false);
  useEffect(() => {
    if (!placed.current) {
      placed.current = true;
      x.value = Math.min(Math.max(minX, x.value || maxX), maxX);
      y.value = Math.min(Math.max(minY, y.value || Math.min(height * 0.62, maxY)), maxY);
      return;
    }
    // A drag owns `x`/`y` while it is in flight: assigning here would fight the
    // finger (and the drop reads the freshest `boundsShared` anyway).
    if (draggingRef.current) return;
    const edge = peekEdgeShared.value;
    const resting = snapPetToPeekEdge(
      edge,
      clampToBounds({ x: x.value, y: y.value }, bounds),
      bounds,
      bottomPeekX,
    );
    // Both axes spring: this fires on a real layout change (a multi-line draft, the
    // attachment tray, a rotation), and a spring keeps a settle that is still
    // animating intact instead of snapping it. The along-the-edge axis is already
    // inside `resting`, so the spring target *is* the clamped value — there is no
    // separate "clamp immediately" step.
    x.value = withSpring(resting.x, SETTLE_SPRING);
    y.value = withSpring(resting.y, SETTLE_SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, height, bottomPeekX]);

  // Keep the keyboard clamp in step with the pet layer's own lift, on the UI
  // thread: the reaction converts `shift` to the layer's lift and recomputes the
  // clamp from the pet's current `y`. Nothing round-trips through React.
  const isIos = Platform.OS === "ios";
  useAnimatedReaction(
    () => keyboardShift.value,
    (rawShift) => {
      const lift = resolvePetLayerLift({
        shift: rawShift,
        enabled: petTranslationRef.current.enabled,
        bottomClearance: petTranslationRef.current.bottomClearance,
      });
      clampLift.value = lift;
      const clamp = resolveKeyboardTopClamp({
        y: y.value,
        lift,
        topInset,
        edgeMargin: EDGE_MARGIN,
      });
      keyboardClamp.value = isIos ? withSpring(clamp, IOS_KEYBOARD_SPRING) : clamp;
    },
    [isIos, keyboardShift, topInset],
  );
  // A drag or a settle moves `y` while the keyboard may be open, so the clamp has
  // to be recomputed for the new resting spot (a pet dragged to the top must not be
  // shoved off it). Reading `y` per frame would defeat the point, so this fires on
  // the discrete end of the interaction instead.
  //
  // It springs rather than assigns: the drop's own spring is still moving `y`, and
  // a clamp that appeared in one frame would jump the pet ahead of it.
  const refreshKeyboardClamp = useCallback(() => {
    keyboardClamp.value = withSpring(
      resolveKeyboardTopClamp({
        y: y.value,
        lift: clampLift.value,
        topInset,
        edgeMargin: EDGE_MARGIN,
      }),
      SETTLE_SPRING,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topInset]);

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
   *
   * The reaction standee is computed and applied **here**, not by the 500ms
   * state-machine tick (waiting for the tick made every tap feel laggy). The
   * same pose goes into `patPoseRef` so the tick's `resolveOverlayPose` keeps it
   * until the hold expires.
   *
   * Consecutive pats rotate through `PAT_TAP_POSES` instead of picking randomly:
   * with only three random standees taps repeated often enough to look like
   * nothing happened. While the agent is busy the working pat still wins.
   */
  const react = useCallback(() => {
    const now = Date.now();
    lastInteractionRef.current = now;
    const rawPose = (stateRef.current as MachineSnapshot | undefined)?.pose;
    const working = rawPose === "running" || rawPose === "thinking";
    const rotation = patRotationRef.current;
    patRotationRef.current = rotation + 1;
    const pose = working ? WORKING_PAT_POSE : nextPatPose(rotation);
    patPoseRef.current = { pose, until: now + PAT_HOLD_MS };
    idleRandomRef.current = null;
    playHop();
    // Apply immediately instead of waiting for the next tick.
    setPetPose((current) => (current === pose ? current : pose));
  }, [playHop]);

  // ---- tap bursts, photo, command center, command menu ---------------------
  // Counting instead of `Exclusive(doubleTap, singleTap)`: a single tap must pat
  // immediately; a burst is only *upgraded* to a double (photo) or triple
  // (command center) once the 300ms window closes.
  // The count lives in a ref, not state: nothing renders from it, and keeping it
  // out of state keeps `handleTapEnd` (and therefore the gesture object) stable
  // across taps.
  const tapBurstCountRef = useRef(0);
  const tapBurstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTapBurst = useCallback(() => {
    tapBurstCountRef.current = 0;
    if (tapBurstTimerRef.current !== null) {
      clearTimeout(tapBurstTimerRef.current);
      tapBurstTimerRef.current = null;
    }
  }, []);

  /**
   * Double tap: put the newest photo into the focused draft.
   *
   * The result is reported instead of discarded: otherwise a missing permission or
   * an empty library looks identical to doing nothing.
   */
  const insertLatestPhoto = useCallback(() => {
    void insertLatestPhotoIntoDraft(focusedDraftKeyRef.current).then((result) => {
      const feedback = resolvePetPhotoFeedback(result);
      if (feedback === null) return undefined;
      toast.show(feedback.message, { variant: feedback.variant });
      return undefined;
    });
  }, [toast]);

  const openWorkspaceTabSwitcher = useCallback(() => {
    // Triple tap mirrors the compact header's [3] button: it opens the
    // workspace tab panel, not the desktop Command Center.
    useWorkspaceTabSwitcherStore.getState().open();
  }, []);

  const openCommandMenu = useCallback(() => {
    resetTapBurst();
    setCommandMenuVisible(true);
  }, [resetTapBurst]);

  const closeCommandMenu = useCallback(() => setCommandMenuVisible(false), []);

  const selectSlashCommand = useCallback((command: PetSlashCommand) => {
    setCommandMenuVisible(false);
    const draftKey = focusedDraftKeyRef.current;
    if (draftKey === null) return;
    useDraftStore.getState().requestTextInsert({ draftKey, text: command.insert });
  }, []);

  const handleTapEnd = useCallback(() => {
    tapBurstCountRef.current += 1;
    const nextCount = tapBurstCountRef.current;
    if (tapBurstTimerRef.current !== null) clearTimeout(tapBurstTimerRef.current);
    // The first tap reacts right away; only the upgrade waits for the window.
    if (nextCount === 1) react();
    tapBurstTimerRef.current = setTimeout(() => {
      const count = tapBurstCountRef.current;
      tapBurstCountRef.current = 0;
      tapBurstTimerRef.current = null;
      const action = resolveTapBurstAction(count);
      if (action === "double") insertLatestPhoto();
      else if (action === "triple") openWorkspaceTabSwitcher();
    }, TAP_BURST_WINDOW_MS);
  }, [insertLatestPhoto, openWorkspaceTabSwitcher, react]);

  // Never leave a burst timer behind when the overlay unmounts.
  useEffect(() => {
    return () => {
      if (tapBurstTimerRef.current !== null) clearTimeout(tapBurstTimerRef.current);
    };
  }, []);

  const dragStarted = useCallback(() => {
    draggingRef.current = true;
    dragUntilRef.current = Number.POSITIVE_INFINITY;
    idleRandomRef.current = null;
    // A drag is not a click: drop any pending burst count.
    resetTapBurst();
    // Apply the pick-up standee now instead of waiting for the 500ms state-machine
    // tick. Waiting meant the pet kept the previous standee for up to half a second
    // after the finger had already grabbed her, and then swapped — a visible hitch
    // at the start of every drag. `react()` already sets its own pose this way.
    setPetPose((current) => (current === PICK_UP_POSE ? current : PICK_UP_POSE));
  }, [resetTapBurst]);

  const dragEnded = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragUntilRef.current = Date.now() + PICK_UP_HOLD_MS;
    // The drop may have moved the pet while the keyboard is open, so the top clamp
    // is recomputed for the new resting spot.
    refreshKeyboardClamp();
  }, [refreshKeyboardClamp]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          // Fold the render offsets into the cell before tracking the finger. The
          // art is drawn at `x + shiftX`, `y + shiftY + keyboardClamp`, so moving
          // the same amounts from those into `x`/`y` leaves it exactly where the
          // user grabbed it. Without this the standee jumps by the offsets the
          // moment the drag starts (a dragged pet is always full-body, and its
          // clamp is recomputed only after the drop).
          //
          // The clamp is the one that used to bite hardest: a pet held 257pt down
          // by the keyboard would be grabbed at its rendered position, `y` would
          // stay at the un-clamped value, and the drop would then recompute the
          // clamp from the *new* position and fling it upward by the old amount.
          x.value = x.value + shiftX.value;
          y.value = foldDragOffsets({
            y: y.value,
            clamp: keyboardClamp.value,
            shiftY: shiftY.value,
          });
          shiftX.value = 0;
          shiftY.value = 0;
          keyboardClamp.value = 0;
          // Animated, not assigned: a peek dropped within the last few hundred
          // milliseconds is still easing its weight up, and snapping it to zero
          // here is a visible twitch at the moment of the grab.
          peekWeight.value = withTiming(0, { duration: SETTLE_MS });
          bottomWeight.value = withTiming(0, { duration: SETTLE_MS });
          originX.value = x.value;
          originY.value = y.value;
          pressScale.value = withSpring(1.08, { damping: 20, stiffness: 220 });
          dragStartEdge.value = peekEdgeShared.value;
          dragSettled.value = false;
          runOnJS(dragStarted)();
          runOnJS(clearPeek)();
        })
        .onUpdate((event) => {
          x.value = originX.value + event.translationX;
          y.value = originY.value + event.translationY;
        })
        .onEnd((event) => {
          // Read the bounds from the shared copy: the gesture object must not be
          // rebuilt when they change, or RNGH cancels a drag that is in flight
          // (a multi-line draft growing the input box is enough to do it).
          const restBounds = boundsShared.value;
          const peekX = bottomPeekXShared.value;
          const startedOn = dragStartEdge.value;
          dragStartEdge.value = null;
          const clamped = {
            x: Math.min(Math.max(restBounds.minX, x.value), restBounds.maxX),
            y: Math.min(Math.max(restBounds.minY, y.value), restBounds.maxY),
          };
          // A drag that starts on a peek edge is measured by how far it moved away
          // from that edge, not by where the clamped cell ended up. `onStart` folds
          // the peek offset into `x`, so a left peek begins the drag at x = -23.2 —
          // 25.205pt outside `minX`. Judging the absolute position there means the
          // user must pull that far before the threshold is met, which is what made
          // the pet feel stuck to the edge. Pulling `PEEK_RELEASE_PX` away releases
          // it, which is a longer pull than the distance that attaches it.
          //
          // A free drag also takes the release velocity into account, so a flick
          // towards an edge attaches even when it stopped short of the threshold.
          const edge = resolveSettledDropEdge({
            startedOn,
            translationX: event.translationX,
            translationY: event.translationY,
            velocityX: event.velocityX,
            velocityY: event.velocityY,
            position: { x: x.value, y: y.value },
            bounds: restBounds,
            threshold: PEEK_SNAP_PX,
            releaseThreshold: PEEK_RELEASE_PX,
            projectionMs: FLICK_PROJECTION_MS,
          });
          // `snapPetToPeekEdge` clamps as well: a free drop at the window border is
          // not on any edge, and a bottom peek is additionally kept inside the
          // input box's columns.
          //
          // A free drop rests where the glide would end, not where the finger lifted.
          // The spring carries the release velocity, so aiming it back at the lift
          // point made a thrown pet overshoot and rubber-band back to it.
          const resting =
            edge === null
              ? projectReleasePoint({
                  position: { x: x.value, y: y.value },
                  velocityX: event.velocityX,
                  velocityY: event.velocityY,
                  projectionMs: FLICK_PROJECTION_MS,
                  bounds: restBounds,
                })
              : snapPetToPeekEdge(edge, clamped, restBounds, peekX);
          // `peekShift` already compensates for the bottom peek's 90% scale, so it
          // takes the unscaled size; passing a scaled size applied the shrink twice
          // and left the crop line ~1.2pt above the input box.
          const shift = peekShift(edge, PET_SIZE, EDGE_MARGIN);
          // The release velocity is handed to the spring so the settle continues the
          // gesture instead of restarting from rest, scaled down because a
          // critically damped spring adds its own overtravel on top (see
          // `RELEASE_VELOCITY_SCALE`). `overshootClamping` on the axis that crosses
          // the edge: a critically damped spring is only non-overshooting when it
          // starts from zero velocity, and a real flick has plenty, so without the
          // clamp the crop line would ride past the input box's top edge and come
          // back.
          const crossesY = edge === "bottom" || shift.y !== 0;
          const crossesX = edge === "left" || edge === "right" || shift.x !== 0;
          x.value = withSpring(resting.x, {
            ...SETTLE_SPRING,
            velocity: event.velocityX * RELEASE_VELOCITY_SCALE,
            overshootClamping: crossesX,
          });
          y.value = withSpring(resting.y, {
            ...SETTLE_SPRING,
            velocity: event.velocityY * RELEASE_VELOCITY_SCALE,
            overshootClamping: crossesY,
          });
          shiftX.value = withSpring(shift.x, SETTLE_SPRING);
          shiftY.value = withSpring(shift.y, SETTLE_SPRING);
          peekWeight.value = withTiming(edge === null ? 0 : 1, { duration: SETTLE_MS });
          bottomWeight.value = withTiming(edge === "bottom" ? 1 : 0, { duration: SETTLE_MS });
          // The shared value is the truth for the edge. It is written here on the
          // UI thread, and `setPeekEdge` only mirrors it for the standee render, so
          // a grab in the same frame reads the right answer and a slow JS render
          // cannot overwrite it.
          peekEdgeShared.value = edge;
          dragSettled.value = true;
          runOnJS(persist)(resting.x, resting.y, edge);
          runOnJS(setPeekEdge)(edge);
        })
        .onFinalize(() => {
          pressScale.value = withSpring(1, { damping: 20, stiffness: 220 });
          // A cancelled pan never reaches `onEnd`, so nothing has clamped the
          // cell yet: `onStart` folded the peek offset in, which leaves e.g. a
          // left peek at x = -23.205 — outside the bounds — and the peek state
          // was already cleared, so it would stay there. `onEnd` has normally
          // already settled it; re-clamping is a no-op in that case.
          if (!dragSettled.value) {
            // Restore the edge the drag *started* on, not the shared value: `onEnd`
            // can have rewritten that in this same frame, and `onStart` already
            // cleared the JS mirror, zeroed the shift and started easing the weight
            // to zero. Restoring the cell alone would leave the art (full-body, at
            // weight 0) sitting on a peek's cell while the shared edge still said
            // "hanging on the ledge". `onEnd` normally already settled it, in
            // which case `dragSettled` is true and none of this runs.
            const startedOn = dragStartEdge.value;
            const resting = resolveCancelledDropResting({
              position: { x: x.value, y: y.value },
              startedOn,
              bounds: boundsShared.value,
              bottomPeekX: bottomPeekXShared.value,
            });
            x.value = withSpring(resting.x, SETTLE_SPRING);
            y.value = withSpring(resting.y, SETTLE_SPRING);
            if (startedOn !== null) {
              const shift = peekShift(startedOn, PET_SIZE, EDGE_MARGIN);
              shiftX.value = withSpring(shift.x, SETTLE_SPRING);
              shiftY.value = withSpring(shift.y, SETTLE_SPRING);
              peekWeight.value = withTiming(1, { duration: SETTLE_MS });
              bottomWeight.value = withTiming(startedOn === "bottom" ? 1 : 0, {
                duration: SETTLE_MS,
              });
              peekEdgeShared.value = startedOn;
              runOnJS(setPeekEdge)(startedOn);
            } else {
              peekWeight.value = withTiming(0, { duration: SETTLE_MS });
            }
          }
          runOnJS(dragEnded)();
        }),
    // Shared values are stable identities; this closure only reads and writes them.
    // The bounds deliberately travel through `boundsShared` instead of being
    // dependencies, so a viewport change cannot rebuild the gesture mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persist, dragStarted, dragEnded, clearPeek],
  );

  // Long press opens the slash-command menu. `Exclusive` gives it priority over
  // the tap, so holding the standee never fires a pat on release.
  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(450)
        .onStart(() => {
          runOnJS(openCommandMenu)();
        }),
    [openCommandMenu],
  );

  // `onEnd(event, success)`: RNGH also calls `onEnd` for canceled gestures, so
  // the count must only advance when the tap actually succeeded.
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(12)
        .onEnd((_event, success) => {
          if (success) runOnJS(handleTapEnd)();
        }),
    [handleTapEnd],
  );

  // Priority: long press -> drag -> tap. A drag must not be mistaken for a tap.
  const gesture = useMemo(() => Gesture.Exclusive(longPress, pan, tap), [longPress, pan, tap]);

  const petStyle = useAnimatedStyle(() => {
    // The idle loops are damped while she hangs off an edge: a ledge that
    // breathes and tilts stops reading as attached to the composer bar. The
    // hop stays at full strength so pats still answer from a peek.
    const idle = 1 - peekWeight.value;
    // No `opacity` term. The old swap dimmed the whole sprite to 20% and bounced it
    // on every pose change; a peek draws an art set that does not change with
    // `petPose`, so those dims fired for no visible reason (once when
    // `PICK_UP_HOLD_MS` expired after a drop, then on every state-machine change
    // while she hung there). The swap is a cross-fade inside the `Image` instead
    // (see `POSE_TRANSITION`).
    //
    // The idle damping and the bottom peek's shrink read eased weights rather than
    // the edge itself, so landing on an edge and leaving it no longer snap.
    return {
      transform: [
        { translateX: x.value + shiftX.value },
        {
          translateY:
            y.value +
            shiftY.value +
            keyboardClamp.value -
            breathe.value * BREATHE_PX * idle -
            hop.value * HOP_PX,
        },
        { rotate: `${sway.value * 1.2 * idle}deg` },
        {
          // Eased on `bottomWeight` rather than read off the current edge, so the
          // bottom peek shrinks and grows continuously, side peeks never shrink, and
          // a dragged pet is always full size even while `peekEdgeShared` still
          // names the edge it was grabbed from.
          scale: resolvePetSpriteScale({
            pressScale: pressScale.value,
            bottomWeight: bottomWeight.value,
            bottomScale: BOTTOM_PEEK_SCALE,
          }),
        },
      ],
    };
  });

  // State -> pose -> standee. `computeState` (and the trigger layer) produce an
  // upstream pose name; `POSE_ASSETS` maps it to one of the 79 standees. This
  // link is the product: different states must look different.
  //
  // A pet hanging off an edge draws its peek standee instead. The peek family
  // is a separate art set, not a state pose: `resolveOverlayPose` keeps running
  // underneath (so leaving the edge lands on the pose the state machine wanted
  // all along) and this only decides what is drawn.
  const standee =
    peekEdge === null
      ? (POSE_ASSETS[petPose] ?? POSE_ASSETS["idle-cute"])
      : POSE_ASSETS[PEEK_POSES[peekEdge]];

  if (HIDDEN_ROUTES.has(pathname)) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // receives touches.
    <View pointerEvents="box-none" style={spriteStyles.host}>
      {/*
        The whole pet rides the owning composer's own keyboard translation: same
        `KeyboardTranslateView` props, same driver, so a bottom peek stays welded
        to the input box frame for frame instead of being teleported by a JS
        keyboard event. It also means every coordinate below is in the
        keyboard-closed frame, which is what the reported ledge is in.

        With no composer claiming the ledge the translation is disabled and the
        pet does not move at all.
      */}
      <KeyboardTranslateView {...petTranslation} pointerEvents="box-none" style={spriteStyles.host}>
        <GestureDetector gesture={gesture}>
          <Animated.View
            accessibilityRole="imagebutton"
            accessibilityLabel="桌宠"
            accessibilityHint="点按互动，双击加入最新照片，三击打开标签面板，长按打开命令菜单"
            style={[spriteStyles.pet, petStyle]}
          >
            {/*
              `transition` cross-fades the swap instead of fading the sprite out
              and back in: the old whole-view fade to 20% read as a flicker, and
              it fired for poses a peeked pet does not even draw.
            */}
            <Image
              source={standee}
              contentFit="contain"
              transition={POSE_TRANSITION}
              style={[spriteStyles.standee, spriteStyles.shadow]}
            />
          </Animated.View>
        </GestureDetector>
      </KeyboardTranslateView>
      <PetCommandMenu
        visible={commandMenuVisible}
        commands={slashCommands}
        onSelect={selectSlashCommand}
        onClose={closeCommandMenu}
        bottomInset={bottomInset}
        windowHeight={height}
      />
    </View>
  );
}

/**
 * Plain React Native styles for the sprite itself, plus Unistyles for the one
 * themed surface (the slash-command sheet).
 *
 * `docs/unistyles.md` bans `useUnistyles()`: the hook subscribes the whole overlay
 * to every Unistyles runtime change, and it returned a fresh `theme` object each
 * cycle, which re-rendered the pet (and every `useMemo` that took a theme value)
 * on unrelated changes. A `StyleSheet.create((theme) => ...)` factory is tracked by
 * the Babel plugin instead, so the sheet follows the theme with no React render.
 *
 * The sprite styles stay in a plain `StyleSheet.create`: they land on a Reanimated
 * view, which must not carry theme-driven Unistyles (same doc), and nothing in
 * them is themed.
 */
const spriteStyles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
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
});
