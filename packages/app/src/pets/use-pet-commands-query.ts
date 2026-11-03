import { useMemo } from "react";
import { useAgentCommandsQuery, type AgentSlashCommand } from "@/agent-commands/use-query";
import { useDraftCommandConfigStore } from "@/stores/draft-command-config-store";
import { resolvePetCommandQuery } from "./pet-command-query";

export interface UsePetCommandsQueryInput {
  serverId: string;
  /** `null` when the focused chat is a draft without an agent yet. */
  agentId: string | null;
  /** The focused chat's draft key, or `null` when there is no focused chat. */
  draftKey: string | null;
  menuVisible: boolean;
}

/**
 * The desk pet's remote slash commands for the focused chat.
 *
 * The pet renders at the app root, outside the composer tree: a draft's command
 * target comes from the store its composer publishes, keyed by the focused
 * draft. Agent sessions query eagerly; a draft query waits for the menu to open
 * because `listCommands` with a draft config makes the daemon create a session.
 *
 * @module paseo/pets/use-pet-commands-query
 */
export function usePetCommandsQuery(input: UsePetCommandsQueryInput): AgentSlashCommand[] {
  const draft = useDraftCommandConfigStore((state) =>
    input.draftKey === null ? undefined : state.byDraftKey[input.draftKey],
  );
  const query = useMemo(
    () =>
      resolvePetCommandQuery({
        serverId: input.serverId,
        agentId: input.agentId,
        draft,
        menuVisible: input.menuVisible,
      }),
    [draft, input.agentId, input.menuVisible, input.serverId],
  );
  return useAgentCommandsQuery(query).commands;
}
