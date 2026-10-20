/**
 * Standee assets and the trigger tables for the desk pet.
 *
 * Two jobs, deliberately kept out of the renderer:
 *   1. the asset table — the upstream 89 `state-*` standees minus ten that have
 *      no honest trigger in Paseo: `festival-*` (the user asked for no festival
 *      art), `weather-*` (Paseo has no weather source) and `balance-low` (no
 *      balance source). That leaves 79;
 *   2. the mapping from host signals to those standees, plus the one pure
 *      resolver that applies them in priority order.
 *
 * `whale-moe-core.js` stays untouched: it returns a `pose` name and this module
 * decides which of the 79 standees that name means and when a decoration layer
 * is allowed to replace an idle pose.
 *
 * Priority (see `resolveOverlayPose`): a tap or a drag always wins (direct
 * interaction), then the state machine's own pose. Two layers may replace it:
 *   - the tool layer refines `running` (work-* for the tool that is running, or
 *     the one that just finished) because `computeState` can only say "running"
 *     generically while the agent works;
 *   - while idle (`idle-cute` / `afk` / `sleep`) the tool / keyword /
 *     celebration / idle-random layers may swap in a different standee.
 * `thinking`, `failure`, `success`, `waiting` and `curious` are never replaced.
 *
 * Every one of the 79 standees has at least one reachable path; the table of
 * paths lives in the task report (asserted by a throwaway coverage script).
 *
 * @module paseo/pets/pose-map
 */

export const POSE_ASSETS = {
  abstract: require("../../assets/pets/whale-musume/dsh-whale-state-abstract.webp"),
  achievement: require("../../assets/pets/whale-musume/dsh-whale-state-achievement.webp"),
  afk: require("../../assets/pets/whale-musume/dsh-whale-state-afk.webp"),
  angry: require("../../assets/pets/whale-musume/dsh-whale-state-angry.webp"),
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

export type PoseName = keyof typeof POSE_ASSETS;

/** The standees `computeState` may return for a quiet pet. */
const IDLE_SERIES_POSES: readonly string[] = ["idle-cute", "afk", "sleep"];

export function isIdleSeriesPose(pose: string | null | undefined): boolean {
  return pose !== null && pose !== undefined && IDLE_SERIES_POSES.includes(pose);
}

/**
 * Core `matchKeyword` id -> standee. `whale-moe-core.js` owns the keyword table
 * (29 ids); this maps each id onto art. The tool / deploy / meeting / review /
 * ddl ids line up with the tool-name mapping on purpose.
 */
export const KEYWORD_POSES: Readonly<Record<string, PoseName>> = {
  thanks: "wink",
  tired: "work-sleep",
  hungry: "eat",
  goodnight: "sleep",
  cheer: "work-celebrate",
  help: "tool",
  praise: "cool-shades",
  hug: "blush",
  cute: "tail-swing",
  morning: "greet",
  worker: "angry",
  slack: "work-slack",
  ddl: "work-deadline",
  cake: "work-boss",
  crazy: "meme-shock",
  flag: "abstract",
  bugtalk: "game-lose",
  kyun: "meme-heart",
  omg: "meme-omg",
  doge: "teasing",
  sike: "bold",
  worship: "meme-worship",
  peace: "meme-peace",
  doubt: "game-think",
  wakuwaku: "meme-wakuwaku",
  smilepain: "meme-smile-pain",
  ojisan: "meme-ojisan",
  deploy: "work-deploy",
  meeting: "work-meeting",
  review: "work-review",
};

interface ToolPoseRule {
  readonly pattern: RegExp;
  readonly pose: PoseName;
}

/**
 * Tool name (lowercased, matched by substring) -> standee. First match wins, so
 * the more specific rules (`deploy`, `playwright`, `clean`) sit above the broad
 * shell/exec family. Unmatched tool names fall back to the generic `tool`
 * standee, which is also what keeps that asset reachable.
 */
export const TOOL_POSE_RULES: readonly ToolPoseRule[] = [
  { pattern: /deploy|publish|release|git push|push|ship|gh /i, pose: "work-deploy" },
  { pattern: /playwright|e2e|browser|simulat|automat/i, pose: "game-cheat" },
  { pattern: /clean|format|lint|prettier|sweep|garbage|prune/i, pose: "sweep" },
  { pattern: /test|review|typecheck|tsc|type-check/i, pose: "work-review" },
  { pattern: /debug|trace|inspect|log/i, pose: "work-debug" },
  { pattern: /search|plan|todo|think|explore|glob|grep|fetch|read|list|find/i, pose: "work-idea" },
  { pattern: /write|edit|apply_patch|patch|notebook/i, pose: "work-meeting" },
  { pattern: /memory|context|compact|cache|remember/i, pose: "work-ram" },
  { pattern: /task|agent|spawn|subagent|orchestr/i, pose: "work-boss" },
  { pattern: /slack|message|notify|comment|chat/i, pose: "work-slack" },
  { pattern: /sleep|wait|background|timeout|delay|cron|schedule/i, pose: "work-sleep" },
  { pattern: /bash|shell|exec|command|terminal|npm|pnpm|yarn|git|node|python/i, pose: "work-slack-phone" },
];

/**
 * Command text (the `command` field of a `shell` tool-call detail) -> standee.
 *
 * Some standees are only reachable through what a shell tool actually runs:
 * `sweep` (lint / clean / format) and `work-deploy` (git push / deploy /
 * publish) never appear in the 161 real tool names the audit collected. Only
 * shell details carry a command, so this layer simply does not apply to other
 * tool kinds.
 */
export const COMMAND_POSE_RULES: readonly ToolPoseRule[] = [
  { pattern: /\b(?:git\s+push|git\s+tag\s+-d|deploy|deployment|publish|release|ship)\b/i, pose: "work-deploy" },
  { pattern: /\b(?:clean|lint|linting|format|fmt|prettier|eslint|stylelint|clang-format|goimports)\b/i, pose: "sweep" },
];

/**
 * Map a tool call onto a standee.
 *
 * `toolName` is the provider tool name; `commandText` is the shell command the
 * call ran (`null` for non-shell tools or when the detail is unavailable — the
 * caller degrades to name-only matching instead of failing).
 *
 * Order: command text first (a `bash` call running `git push` is a deploy, not
 * generic shell), then the tool-name table, then the generic `tool` standee.
 */
export function resolveToolPose(
  toolName: string | null,
  commandText: string | null = null,
): PoseName | null {
  if (toolName === null) return null;
  if (commandText !== null) {
    const command = commandText.toLowerCase();
    for (const rule of COMMAND_POSE_RULES) {
      if (rule.pattern.test(command)) return rule.pose;
    }
  }
  const name = toolName.toLowerCase();
  for (const rule of TOOL_POSE_RULES) {
    if (rule.pattern.test(name)) return rule.pose;
  }
  return "tool";
}

/** Tap reactions. The whole standee is one button, so these rotate per tap. */
export const PAT_POSES: readonly PoseName[] = ["react-head", "react-belly", "react-tail"];

/** Tap while a workspace is busy gets the working pat. */
export const WORKING_PAT_POSE: PoseName = "work-pat";

/** Dragging the pet lifts her. */
export const PICK_UP_POSE: PoseName = "pick-up";

/**
 * A user message that matched no keyword still deserves a reaction: pick one of
 * the meme standees at random. This is also the path that keeps all 18 memes
 * reachable, not just the ones with a keyword.
 */
export const RANDOM_MEME_POSES: readonly PoseName[] = [
  "meme-broke",
  "meme-cry",
  "meme-doge",
  "meme-doubt",
  "meme-heart",
  "meme-kyun",
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
  "meme-yes",
];

/**
 * What a quiet pet may switch to every 3-5 minutes. Daily-life standees are the
 * bulk (they have no other trigger at all); a few mild memes keep it from being
 * only coffee and pajamas.
 */
export const IDLE_RANDOM_POSES: readonly PoseName[] = [
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
  "meme-music",
  "meme-yes",
  "meme-no",
  "meme-broke",
  "meme-smug",
  "meme-kyun",
];

/** Rotated per completed todo step; the finished list gets its own pose. */
export const CELEBRATION_POSES: readonly PoseName[] = [
  "star",
  "levelup",
  "celebrate",
  "valentine",
  "game-win",
  "game-happy",
];

export const ALL_DONE_POSE: PoseName = "achievement";

/** How long a one-shot reaction pose stays up. */
export const PAT_HOLD_MS = 1400;
export const PICK_UP_HOLD_MS = 600;
/** How long after a tool call / user message / completed step the pose is valid. */
export const TOOL_POSE_WINDOW_MS = 60000;
export const KEYWORD_POSE_WINDOW_MS = 120000;
export const CELEBRATION_WINDOW_MS = 120000;
/** Idle variety cadence and hold time. */
export const IDLE_RANDOM_MIN_MS = 180000;
export const IDLE_RANDOM_MAX_MS = 300000;
/**
 * How long one idle-variety pick stays up. After this the standee falls back to
 * the quiet poses (`afk` / night `sleep`), otherwise a single pick would hide
 * them until the next 3-5 minute draw.
 */
export const IDLE_RANDOM_HOLD_MS = 60000;

export function pickPatPose(isWorking: boolean, rng: () => number = Math.random): PoseName {
  if (isWorking) return WORKING_PAT_POSE;
  const index = Math.floor(rng() * PAT_POSES.length);
  return PAT_POSES[Math.min(PAT_POSES.length - 1, Math.max(0, index))] ?? WORKING_PAT_POSE;
}

export function pickRandomMemePose(rng: () => number = Math.random): PoseName {
  const index = Math.floor(rng() * RANDOM_MEME_POSES.length);
  return RANDOM_MEME_POSES[Math.min(RANDOM_MEME_POSES.length - 1, Math.max(0, index))] ?? "meme-yes";
}

export function pickIdleRandomPose(rng: () => number = Math.random): PoseName {
  const index = Math.floor(rng() * IDLE_RANDOM_POSES.length);
  return IDLE_RANDOM_POSES[Math.min(IDLE_RANDOM_POSES.length - 1, Math.max(0, index))] ?? "daily-coffee";
}

export function celebrationPose(completed: number, allDone: boolean): PoseName {
  if (allDone) return ALL_DONE_POSE;
  const index = (Math.max(1, completed) - 1) % CELEBRATION_POSES.length;
  return CELEBRATION_POSES[index] ?? ALL_DONE_POSE;
}

/** Late evening through early morning: a night standee instead of idle-cute. */
export function isNightHour(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

export interface OverlayPoseContext {
  now: number;
  /** Local hour, 0-23. */
  hour: number;
  /** The pose `computeState` returned for this tick. */
  statePose: string | null;
  /** A drag is in progress (or just ended). */
  dragging: boolean;
  pat: { pose: PoseName; until: number } | null;
  /** The tool executing right now (`status: "running"`); no recency window. */
  tool: { pose: PoseName | null; at: number } | null;
  /** The newest tool call of any status, used through the 60s windows. */
  recentTool: { pose: PoseName | null; at: number } | null;
  keyword: { pose: PoseName; at: number } | null;
  celebration: { pose: PoseName; at: number } | null;
  /** Latest idle-variety pick, cleared by any interaction. */
  idleRandom: { pose: PoseName; pickedAt: number } | null;
}

/**
 * Resolve the standee to draw for this tick.
 *
 * Priority, most binding first:
 *
 * | computeState pose                                  | tool layer (work-*)          | keyword / celebration / idle-random |
 * |----------------------------------------------------|------------------------------|--------------------------------------|
 * | (a pat or a drag)                                  | wins over everything (direct input) |                               |
 * | `running`                                          | MAY refine: running tool -> recent tool (60s) -> generic `running` | never |
 * | `idle-cute` / `afk` / `sleep`                      | MAY refine: recent tool (60s) | MAY replace (idleRandom for 60s)     |
 * | `thinking` / `failure` / `success` / `waiting` / `curious` / anything else | never | never |
 *
 * `running` is refined because `computeState` can only say "running"
 * generically; while the agent works the tool name is the useful information.
 * The running tool has no recency window (a long build must keep its standee);
 * when it finishes, the recent-tool window smooths the boundary so the standee
 * does not flicker back to the generic `running` for a moment.
 *
 * `idleRandom` expires after IDLE_RANDOM_HOLD_MS so the quiet poses (`afk`, and
 * `sleep` at night) are visible between the 3-5 minute draws.
 */
export function resolveOverlayPose(context: OverlayPoseContext): PoseName {
  const { now } = context;

  // Direct interaction answers immediately, whatever the state machine says.
  if (context.dragging) return PICK_UP_POSE;
  if (context.pat !== null && now < context.pat.until) return context.pat.pose;

  const statePose = normalizeStatePose(context.statePose);
  const tool = context.tool;
  const recentTool = context.recentTool;
  const recentToolPose =
    recentTool !== null &&
    recentTool.pose !== null &&
    now - recentTool.at <= TOOL_POSE_WINDOW_MS
      ? recentTool.pose
      : null;

  // While working, the tool layer may refine the generic running standee.
  if (statePose === "running") {
    const runningPose = tool !== null && tool.pose !== null ? tool.pose : null;
    return runningPose ?? recentToolPose ?? "running";
  }
  // Every other non-idle pose is protected from every decoration layer.
  if (!isIdleSeriesPose(statePose)) return statePose;

  if (recentToolPose !== null) return recentToolPose;
  if (context.keyword !== null && now - context.keyword.at <= KEYWORD_POSE_WINDOW_MS) {
    return context.keyword.pose;
  }
  if (context.celebration !== null && now - context.celebration.at <= CELEBRATION_WINDOW_MS) {
    return context.celebration.pose;
  }
  if (
    context.idleRandom !== null &&
    now - context.idleRandom.pickedAt <= IDLE_RANDOM_HOLD_MS
  ) {
    return context.idleRandom.pose;
  }

  if (statePose === "afk" || statePose === "sleep") {
    return isNightHour(context.hour) ? "sleep" : "afk";
  }
  return isNightHour(context.hour) ? "night" : "idle-cute";
}

/** Unknown or `null` state poses fall back to the idle standee. */
function normalizeStatePose(pose: string | null): PoseName {
  if (pose !== null && pose in POSE_ASSETS) return pose as PoseName;
  return "idle-cute";
}
