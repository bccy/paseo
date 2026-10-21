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
}

/** A command as the daemon reports it (`listCommands`). */
export interface RemoteSlashCommand {
  readonly name: string;
  readonly description: string;
}

/** Chinese labels for the local client-side slash commands. */
const CLIENT_COMMAND_LABELS: Readonly<Record<string, string>> = {
  "archive-agent": "归档当前会话",
  "replace-agent-with-draft": "清空并新建会话",
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
      label: command.description || `/${command.name}`,
    });
  }
  for (const command of CLIENT_SLASH_COMMANDS) {
    byName.set(command.name, {
      name: command.name,
      insert: `/${command.name}`,
      label: CLIENT_COMMAND_LABELS[command.kind] ?? command.description,
    });
  }
  return [...byName.values()];
}
