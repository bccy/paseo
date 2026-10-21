/**
 * Pure helpers for the desk pet's long-press slash-command menu.
 *
 * Kept out of the renderer so the menu table can be exercised without React
 * Native: this module has no runtime dependencies (the slash-command module it
 * reads is a plain constant table).
 *
 * @module paseo/pets/pet-slash-commands
 */

import { CLIENT_SLASH_COMMANDS } from "@/client-slash-commands";

export interface PetSlashCommand {
  /** English command name without the slash, e.g. `clear`. */
  readonly name: string;
  /** Exactly what is inserted into the composer, e.g. `/clear`. */
  readonly insert: string;
  /** Chinese label shown in the pet's command menu. */
  readonly label: string;
  /** Which layer this command belongs to. */
  readonly source: PetSlashCommandSource;
}

/** A command as the daemon reports it (`listCommands`). */
export interface RemoteSlashCommand {
  readonly name: string;
  readonly description: string;
}

/**
 * Where a menu entry comes from. Paseo's own commands are handled by the app;
 * the daemon's (agent) commands are the DSH side. The menu badges the two
 * differently so a user can tell which layer a slash command belongs to.
 */
export type PetSlashCommandSource = "paseo" | "dsh";

/** Chinese labels for the local client-side slash commands. */
const CLIENT_COMMAND_LABELS: Readonly<Record<string, string>> = {
  "archive-agent": "归档当前会话",
  "replace-agent-with-draft": "清空并新建会话",
};

/**
 * Chinese labels for the agent commands the daemon reports in English. Only the
 * known ones are translated; an unknown command keeps the daemon's own wording
 * rather than showing a made-up translation.
 */
const REMOTE_COMMAND_LABELS: Readonly<Record<string, string>> = {
  goal: "目标",
  goals: "目标列表",
  rewind: "回退对话",
  undo: "撤销",
  model: "切换模型",
  mode: "切换模式",
  plan: "计划模式",
  build: "构建模式",
  compact: "压缩上下文",
  clear: "清空对话",
  help: "帮助",
  status: "状态",
  stop: "停止当前回合",
  resume: "恢复",
  init: "初始化项目",
  review: "代码审查",
  test: "运行测试",
  commit: "提交改动",
};

/**
 * The commands the long-press menu offers: the local client commands plus every
 * command the daemon reports for the focused agent (model, mode, compact, …).
 *
 * Remote entries are keyed by name and win over local ones, except that a local
 * command keeps its Chinese label when we have one — the daemon only describes
 * itself in its own words.
 */
export function buildPetSlashCommands(
  remote: readonly RemoteSlashCommand[] = [],
): PetSlashCommand[] {
  const byName = new Map<string, PetSlashCommand>();
  for (const command of remote) {
    byName.set(command.name, {
      name: command.name,
      insert: `/${command.name}`,
      label: REMOTE_COMMAND_LABELS[command.name] ?? (command.description || `/${command.name}`),
      source: "dsh",
    });
  }
  for (const command of CLIENT_SLASH_COMMANDS) {
    byName.set(command.name, {
      name: command.name,
      insert: `/${command.name}`,
      label: CLIENT_COMMAND_LABELS[command.kind] ?? command.description,
      source: "paseo",
    });
  }
  return [...byName.values()];
}
