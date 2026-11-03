/**
 * Pure assembly of the desk pet's command query arguments.
 *
 * The pet sits at the app root and has no composer of its own. For an agent
 * session it queries that agent eagerly, exactly as before. For a draft it has
 * to hold the query until the long-press menu opens: `listCommands` with a
 * draft config makes the daemon create a session, and merely focusing a draft
 * tab must not leave an empty session behind.
 *
 * @module paseo/pets/pet-command-query
 */

import type { DraftCommandConfig, DraftCommandTarget } from "@/hooks/use-agent-commands-query";
import { resolvePetDraftCommandConfig } from "./pet-draft-command-config";

export interface PetCommandQueryInput {
  serverId: string;
  /** `null` when the focused chat is a draft without an agent yet. */
  agentId: string | null;
  /** The focused draft composer's published command target, if any. */
  draft: DraftCommandTarget | undefined;
  menuVisible: boolean;
}

export interface PetCommandQuery {
  serverId: string;
  agentId: string;
  draftConfig?: DraftCommandConfig;
  enabled: boolean;
}

export function resolvePetCommandQuery(input: PetCommandQueryInput): PetCommandQuery {
  const draftConfig =
    input.agentId === null ? resolvePetDraftCommandConfig(input.draft) : undefined;
  const enabled =
    Boolean(input.serverId) &&
    (input.agentId !== null || (input.menuVisible && draftConfig !== undefined));
  return {
    serverId: input.serverId,
    agentId: input.agentId ?? "",
    ...(draftConfig === undefined ? {} : { draftConfig }),
    enabled,
  };
}
