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

/** Chinese labels for the local client-side slash commands. */
const CLIENT_COMMAND_LABELS: Readonly<Record<string, string>> = {
  "archive-agent": "归档当前会话",
  "replace-agent-with-draft": "清空并新建会话",
};

/**
 * The commands the long-press menu offers.
 *
 * Source: the local client command table (`CLIENT_SLASH_COMMANDS`). Server-side
 * slash commands are not listed here: they need a daemon round-trip
 * (`useAgentCommandsQuery` needs a host-runtime client + agent identity), and the
 * pet overlay is outside the composer tree. The menu is therefore limited to the
 * commands that work without a round-trip.
 */
export function buildPetSlashCommands(): PetSlashCommand[] {
  return CLIENT_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    insert: `/${command.name}`,
    label: CLIENT_COMMAND_LABELS[command.kind] ?? command.description,
  }));
}
