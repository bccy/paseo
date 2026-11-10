/**
 * Pure helper for the desk pet's command query.
 *
 * The pet sits at the app root, outside the focused draft composer's React
 * tree. `input-draft.ts` publishes the composer's `DraftCommandTarget` through
 * the draft command config store; this module turns that target into the shape
 * `listCommands` accepts, dropping blank optional fields the same way the
 * composer's `/` autocomplete does.
 *
 * @module paseo/pets/pet-draft-command-config
 */

import type { DraftCommandConfig, DraftCommandTarget } from "@/agent-commands";

export function resolvePetDraftCommandConfig(
  draft: DraftCommandTarget | undefined,
): DraftCommandConfig | undefined {
  if (draft?.status !== "ready") {
    return undefined;
  }

  const config = draft.config;
  const cwd = config.cwd.trim();
  if (!cwd) {
    return undefined;
  }

  const modeId = config.modeId?.trim() ?? "";
  const model = config.model?.trim() ?? "";
  const thinkingOptionId = config.thinkingOptionId?.trim() ?? "";
  const providerOptions = config.providerOptions;
  return {
    provider: config.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(providerOptions && Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}
