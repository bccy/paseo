import type { AgentAddress } from "@getpaseo/protocol/addresses";
import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import {
  getAgentStatusPriority,
  type AgentStateBucketInput,
} from "@getpaseo/protocol/agent-state-bucket";
import { useEffect, useMemo } from "react";
import { usePendingArchiveAgentKeys } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  providerSubagentLifecycleStatus,
  refreshProviderSubagents,
  useProviderSubagentStore,
} from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";

export interface PaseoSubagentRow {
  kind: "paseo";
  address: AgentAddress;
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  backgroundWork?: Agent["backgroundWork"];
  turn: Agent["turn"];
  requiresAttention: Agent["requiresAttention"];
  /**
   * Why the host flagged the row, and how many permission answers are outstanding. Ordering
   * reads them because `requiresAttention` alone cannot tell a permission question apart from a
   * turn that merely finished.
   */
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  createdAt: Agent["createdAt"];
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
}

export type SubagentRow = PaseoSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
  /** Select children of this provider subagent instead of children of the managed agent. */
  providerParentSubagentId?: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "paseo",
    address: { serverId: agent.serverId, agentId: agent.id },
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    backgroundWork: agent.backgroundWork,
    turn: agent.turn,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
    pendingPermissionCount: agent.pendingPermissions.length,
    createdAt: agent.createdAt,
  };
}

/**
 * The band a row sorts into, taken from the protocol's own agent-state priority table: the row
 * blocked on a permission answer first, then failures, then work in flight, then everything
 * settled. Within a band the newest sits on top, so a subagent that just started is visible
 * without scrolling.
 *
 * The band is derived from `attentionReason`, not from `requiresAttention`. The host sets that
 * flag with `attentionReason: "finished"` the moment a turn completes, so ranking on the boolean
 * alone put freshly finished rows in the same band as rows waiting on the user — and those rows
 * then buried the ones still running. `getAgentStatusPriority` keys off the reason instead,
 * which is what tells a stopped process apart from a finished one.
 *
 * Subagent rows have no read state of their own: the track is where a failed child stays visible
 * after the parent's attention was cleared, so a lifecycle `error` always ranks with the
 * failures. The shared table otherwise treats a read error as settled.
 */
function subagentRankInput(row: SubagentRow): AgentStateBucketInput {
  if (row.kind === "paseo") {
    const permission =
      (row.pendingPermissionCount ?? 0) > 0 || row.attentionReason === "permission";
    const failed = row.status === "error" && !permission;
    return {
      status: row.status,
      pendingPermissionCount: row.pendingPermissionCount ?? 0,
      attentionReason: failed ? "error" : (row.attentionReason ?? null),
      requiresAttention: failed ? true : row.requiresAttention,
      backgroundWork: row.backgroundWork,
    };
  }
  // Provider rows spell their lifecycle differently — `running | completed | failed | canceled`
  // against `initializing | idle | running | error | closed` — so `failed` has to become `error`
  // before the shared table can read it. Provider rows carry no `attentionReason` either, so a
  // failed child has to spell the unread-error input that keeps it in the failures band.
  const status = providerSubagentLifecycleStatus(row.status);
  return status === "error"
    ? { status, requiresAttention: true, attentionReason: "error" }
    : { status };
}

function compareSubagentRows(left: SubagentRow, right: SubagentRow): number {
  const byRank =
    getAgentStatusPriority(subagentRankInput(left)) -
    getAgentStatusPriority(subagentRankInput(right));
  if (byRank !== 0) return byRank;
  return right.createdAt.getTime() - left.createdAt.getTime();
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const rows: SubagentRow[] = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      const parent = getParentAddressFromLabels(agent.labels, serverId);
      if (
        agent.archivedAt ||
        agent.background ||
        pendingArchiveIds.has(`${serverId}:${agent.id}`) ||
        parent?.serverId !== params.serverId ||
        parent.agentId !== params.parentAgentId
      )
        continue;
      rows.push(toSubagentRow(agent));
    }
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort(compareSubagentRows);
  return rows;
}

// Session-store selectors run on every store update, including every stream tick, which
// leaves the agent map untouched. Reuse the previous rows until the map changes, and keep
// them when a recompute yields equal rows so the hook's equality check stays O(1).
export function createSubagentsForParentSelector(
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): (state: SessionStoreSnapshot) => SubagentRow[] {
  let previousAgents: Array<[string, Map<string, Agent>]> = [];
  let previousRows: SubagentRow[] | null = null;

  return (state) => {
    const agents = Object.entries(state.sessions).map(
      ([serverId, session]) => [serverId, session.agents] as [string, Map<string, Agent>],
    );
    if (
      previousRows &&
      agents.length === previousAgents.length &&
      agents.every(
        ([serverId, map], index) =>
          previousAgents[index]?.[0] === serverId && previousAgents[index]?.[1] === map,
      )
    ) {
      return previousRows;
    }

    const rows = selectSubagentsForParent(state, params, pendingArchiveIds);
    previousAgents = agents;
    if (!previousRows || !equal(previousRows, rows)) {
      previousRows = rows;
    }
    return previousRows;
  };
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
  nestingSupported = false,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  if (params.providerParentSubagentId && !nestingSupported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    if (
      nestingSupported &&
      (subagent.parentSubagentId ?? null) !== (params.providerParentSubagentId ?? null)
    ) {
      continue;
    }
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
    });
  }
  rows.sort(compareSubagentRows);
  return rows;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const { serverId, parentAgentId } = params;
  const pendingArchiveIds = usePendingArchiveAgentKeys();
  const selectPaseoRows = useMemo(
    () => createSubagentsForParentSelector({ serverId, parentAgentId }, pendingArchiveIds),
    [serverId, parentAgentId, pendingArchiveIds],
  );
  const paseoRows = useStoreWithEqualityFn(useSessionStore, selectPaseoRows, equal);
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) =>
      state.sessions[params.serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) => selectProviderSubagentsForParent(state, params, supported, nestingSupported),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  return useMemo(() => {
    if (params.providerParentSubagentId) return providerRows;
    if (providerRows.length === 0) return paseoRows;
    const rows = [...paseoRows, ...providerRows];
    rows.sort(compareSubagentRows);
    return rows;
  }, [params.providerParentSubagentId, paseoRows, providerRows]);
}
