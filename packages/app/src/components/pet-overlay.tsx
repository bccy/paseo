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

import { useQuery } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { DshIcon } from "@/components/icons/dsh-icon";
import {
  Archive,
  Cpu,
  Minimize2,
  SlidersHorizontal,
  SquarePen,
  SquareTerminal,
  Target,
  Undo2,
  type LucideIcon,
} from "lucide-react-native";
import { usePathname } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
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
import { useUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useDraftStore } from "@/stores/draft-store";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
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
  PICK_UP_HOLD_MS,
  POSE_ASSETS,
  celebrationPose,
  isIdleSeriesPose,
  pickIdleRandomPose,
  pickRandomMemePose,
  nextPatPose,
  resolveOverlayPose,
  resolveToolPose,
  WORKING_PAT_POSE,
  type PoseName,
} from "../pets/pose-map";
import { insertLatestPhotoIntoDraft } from "../pets/pet-latest-photo";
import {
  buildPetSlashCommands,
  type PetSlashCommand,
  type RemoteSlashCommand,
} from "../pets/pet-slash-commands";
import { resolveTapBurstAction, TAP_BURST_WINDOW_MS } from "../pets/pet-taps";

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
const PET_SIZE = 96;
/** Source pixels per point, used to rescale the upstream pixel amounts. */
const ART_TO_SCREEN = PET_SIZE / 512;

const STORAGE_KEY = "paseo.pet.position.v1";
/** Keep the pet clear of the very edge so nothing is clipped by the window. */
const EDGE_MARGIN = 10;
/**
 * Vertical space reserved at the bottom for the composer. The pet must never
 * rest below the input bar: when the keyboard opens the bar rises with it, and
 * a standee parked at the bottom would end up hidden behind the keyboard.
 */
const COMPOSER_GUARD = 64;
/** Screens where a pet would be noise rather than company. */
const HIDDEN_ROUTES = new Set(["/welcome", "/pair-scan", "/open-project"]);

/** Paseo's own mark, so its commands are visually distinct from DSH's. */
const PASEO_MARK = require("../../assets/images/favicon-light.png");

/**
 * Icon per slash command. Known command names get a matching glyph; anything
 * else falls back to the generic prompt icon instead of vanishing.
 */
const COMMAND_ICONS: Readonly<Record<string, LucideIcon>> = {
  exit: Archive,
  quit: Archive,
  q: Archive,
  "replace-agent-with-draft": SquarePen,
  goal: Target,
  rewind: Undo2,
  model: Cpu,
  mode: SlidersHorizontal,
  compact: Minimize2,
};

function iconForCommand(name: string): LucideIcon {
  return COMMAND_ICONS[name] ?? SquareTerminal;
}

/** Upstream soft-set keyframes, rescaled out of the 512px standee space. */
const BREATHE_PX = 4 * ART_TO_SCREEN * 2;
const HOP_PX = 8 * ART_TO_SCREEN * 2;
/** Upstream wm-pose-in: translateY(4px) + scale(1.04) -> identity. */
const POSE_IN_PX = 4 * ART_TO_SCREEN * 2;

/** State machine tick. */
const TICK_MS = 500;
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
function selectPetActivity(state: PetStoreSource): PetActivity {
  const active = pickActiveAgent(state);
  if (active === null) return EMPTY_ACTIVITY;
  const { session, agentId } = active;

  const userMessage = latestUserMessage(session, agentId);
  const userAt = userMessage?.timestamp.getTime() ?? 0;

  // Turn + agent state of the conversation the pet mirrors. Signals are read
  // from this agent only — the old workspace-bucket union let another project,
  // terminal or sub-agent light the pet up.
  const agent = session.agents.get(agentId);
  const turn = agent?.turn;
  const turnOpen = turn?.phase === "open";
  const openTurnId = turn !== undefined && turn.phase === "open" ? (turn.turnId ?? null) : null;

  // A tool is only "running" while its own status says so AND its turn is still
  // open — a canceled turn may leave a stale `running` flag in the stream.
  const runningTool = turnOpen
    ? latestAgentToolCall(session, agentId, openTurnId, (data) => data.status === "running")
    : null;
  // The most recent tool call of any status feeds the "just did this" standee
  // (and smooths the running -> finished boundary).
  const recentTool = latestAgentToolCall(session, agentId, openTurnId, () => true);

  const latest = latestStreamItem(session, agentId);
  // Streaming thought = the newest stream item is a thought that has not been
  // finalized yet, inside an open turn.
  const thought =
    turnOpen && latest !== undefined && latest.kind === "thought" && latest.status === "loading";
  const keywordId = userMessage === null ? null : core.matchKeyword(userMessage.text, true);

  return {
    runningToolName: runningTool?.name ?? null,
    runningToolCommand: runningTool?.command ?? null,
    runningToolAt: runningTool?.at ?? 0,
    recentToolName: recentTool?.name ?? null,
    recentToolCommand: recentTool?.command ?? null,
    recentToolAt: recentTool?.at ?? 0,
    turnOpen,
    thought,
    keywordId,
    userAt,
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
  // The command sheet is the one piece of UI the pet draws, so it uses the app
  // theme instead of hard-coded colours: it has to look like the rest of Paseo,
  // including in light mode.
  const { theme } = useUnistyles();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
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
  const { data: remoteSlashCommands } = useQuery({
    queryKey: ["pet-slash-commands", petServerId, petAgentId],
    queryFn: async (): Promise<RemoteSlashCommand[]> => {
      if (petHostClient === null || petAgentId === null) return [];
      const response = await petHostClient.listCommands({ agentId: petAgentId });
      return response.commands as RemoteSlashCommand[];
    },
    enabled: petHostClient !== null && petAgentId !== null,
    staleTime: 60_000,
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
  /** Last user message the keyword layer reacted to. */
  const lastKeywordUserAtRef = useRef(0);
  /** Set on the open -> closed turn edge; the module shows success for 2s. */
  const successAtRef = useRef(0);
  /** Set on a fresh user message / attention rising edge (6s curious window). */
  const curiousAtRef = useRef(0);
  const previousTurnOpenRef = useRef(false);
  const previousRequiresAttentionRef = useRef(false);
  /** Previous todo baseline: whose list it was and how far it had got. */
  const previousTodoRef = useRef<{ agentId: string; completed: number } | null>(null);

  // Success is an *edge*: the active turn going open -> closed (the previous
  // implementation watched a `done` bucket that was already true at launch and
  // then stayed true, so the success standee was effectively unreachable).
  useEffect(() => {
    const wasOpen = previousTurnOpenRef.current;
    previousTurnOpenRef.current = activity.turnOpen;
    if (wasOpen && !activity.turnOpen) successAtRef.current = Date.now();
  }, [activity.turnOpen]);

  // Curiosity is an *edge* too: the agent starting to require attention.
  useEffect(() => {
    const wasRequiring = previousRequiresAttentionRef.current;
    previousRequiresAttentionRef.current = activity.requiresAttention;
    if (activity.requiresAttention && !wasRequiring) curiousAtRef.current = Date.now();
  }, [activity.requiresAttention]);

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
      pose: celebrationPose(
        todoTally.completed,
        todoTally.completed >= todoTally.total,
      ),
      at: Date.now(),
    };
    idleRandomRef.current = null;
  }, [todoTally]);

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
    // The user just spoke to this conversation: a rising edge for curiosity.
    curiousAtRef.current = Date.now();
    const matched: PoseName | undefined =
      activity.keywordId === null ? undefined : KEYWORD_POSES[activity.keywordId];
    keywordPoseRef.current = {
      pose: matched ?? pickRandomMemePose(),
      at: Date.now(),
    };
  }, [activity.userAt, activity.keywordId]);

  // Tool activity is not a user message, but it does mean "not idle".
  useEffect(() => {
    if (activity.recentToolAt <= 0) return;
    lastStreamActivityRef.current = Math.max(
      lastStreamActivityRef.current,
      activity.recentToolAt,
    );
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

  // The composer owns the bottom of the screen and rises with the keyboard.
  // Track the keyboard so the pet can be clamped above the input bar instead of
  // ending up hidden behind it, and remember where she was so closing the
  // keyboard puts her back instead of leaving her parked in the lifted spot.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const preKeyboardYRef = useRef<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", (event) => {
      if (preKeyboardYRef.current === null) preKeyboardYRef.current = y.value;
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [y]);

  const minX = EDGE_MARGIN;
  const maxX = Math.max(EDGE_MARGIN, width - PET_SIZE - EDGE_MARGIN);
  const minY = topInset + EDGE_MARGIN;
  const maxY = Math.max(
    minY,
    height - PET_SIZE - EDGE_MARGIN - COMPOSER_GUARD - keyboardHeight,
  );

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
  const lastPose = useRef<PoseName>(petPose);
  useEffect(() => {
    if (lastPose.current === petPose) return;
    lastPose.current = petPose;
    poseIn.value = 0;
    poseIn.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [petPose, poseIn]);

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
    // The keyboard shift is temporary: restoring the remembered position on
    // close keeps the pet where the user left her instead of stranding her in
    // the lifted spot. Dragging while the keyboard is open overwrites the
    // memory on the next open, so this cannot fight a deliberate move.
    if (keyboardHeight > 0) {
      y.value = Math.min(Math.max(minY, y.value), maxY);
    } else if (preKeyboardYRef.current !== null) {
      y.value = Math.min(Math.max(minY, preKeyboardYRef.current), maxY);
      preKeyboardYRef.current = null;
    } else {
      y.value = Math.min(Math.max(minY, y.value), maxY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, height, keyboardHeight]);

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

  const insertLatestPhoto = useCallback(() => {
    void insertLatestPhotoIntoDraft(focusedDraftKeyRef.current);
  }, []);

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

  const selectSlashCommand = useCallback(
    (command: PetSlashCommand) => {
      setCommandMenuVisible(false);
      const draftKey = focusedDraftKeyRef.current;
      if (draftKey === null) return;
      useDraftStore.getState().requestTextInsert({ draftKey, text: command.insert });
    },
    [],
  );

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
  }, [resetTapBurst]);

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
  const standee = POSE_ASSETS[petPose] ?? POSE_ASSETS["idle-cute"];

  if (HIDDEN_ROUTES.has(pathname)) return null;

  return (
    // `box-none` keeps the rest of the screen interactive: only the pet cell
    // receives touches.
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
      {commandMenuVisible ? (
        <View style={[styles.menuBackdrop, { paddingBottom: bottomInset + 12 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭命令菜单"
            onPress={closeCommandMenu}
            style={styles.menuDismiss}
          />
          <Pressable
            style={[
              styles.menuSheet,
              { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
            ]}
            onPress={() => undefined}
          >
            <Text
              style={[
                styles.menuTitle,
                { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
              ]}
            >
              桌宠命令（选中后填入输入框）
            </Text>
            {/* The daemon can report a long command list, so the sheet scrolls
                inside a capped height instead of growing past the screen top. */}
            <ScrollView
              style={{ maxHeight: Math.min(height * 0.55, 420) }}
              contentContainerStyle={styles.menuScrollContent}
              showsVerticalScrollIndicator
            >
              {slashCommands.map((command) => {
                const Icon = iconForCommand(command.name);
                // The row scrolls, so the ScrollView has to own the gesture: a
                // Pressable wrapping it would swallow the horizontal drag before
                // the scroll view ever sees it. The Pressable therefore sits
                // inside, sized to the content it is meant to activate.
                return (
                  <ScrollView
                    horizontal
                    key={command.name}
                    showsHorizontalScrollIndicator={false}
                    style={styles.menuItemScroll}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${command.label}：填入 ${command.insert}`}
                      onPress={() => selectSlashCommand(command)}
                      style={({ pressed }) => [
                        styles.menuItem,
                        pressed ? { backgroundColor: theme.colors.border } : null,
                      ]}
                    >
                      <View style={styles.menuItemRow}>
                        {command.source === "paseo" ? (
                          <Image
                            source={PASEO_MARK}
                            style={styles.menuItemMark}
                            contentFit="contain"
                          />
                        ) : (
                          <DshIcon size={16} />
                        )}
                        <Text
                          style={[
                            styles.menuItemLabel,
                            { color: theme.colors.foreground, fontSize: theme.fontSize.content },
                          ]}
                        >
                          {command.label}
                        </Text>
                      </View>
                    </Pressable>
                  </ScrollView>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭命令菜单"
              onPress={closeCommandMenu}
              style={styles.menuItem}
            >
              <Text
                style={[
                  styles.menuCancelLabel,
                  { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.content },
                ]}
              >
                取消
              </Text>
            </Pressable>
          </Pressable>
        </View>
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
  // Slash-command sheet (long press). Plain views on purpose: the pet overlay
  // must not depend on a specific screen's bottom-sheet provider. Colours come
  // from the app theme at the call site so the sheet matches the rest of Paseo,
  // including light mode.
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  menuDismiss: {
    ...StyleSheet.absoluteFillObject,
  },
  menuSheet: {
    marginHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  menuTitle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  menuScrollContent: {
    paddingBottom: 4,
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  menuItemMark: {
    width: 16,
    height: 16,
    marginTop: 2,
  },
  menuItemScroll: {
    flexGrow: 0,
  },
  menuItemLabel: {
    flexShrink: 0,
  },
  menuCancelLabel: {
    textAlign: "center",
  },
});
