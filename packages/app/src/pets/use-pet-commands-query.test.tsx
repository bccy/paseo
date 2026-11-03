/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSlashCommand, DraftCommandTarget } from "@/hooks/use-agent-commands-query";
import { useDraftCommandConfigStore } from "@/stores/draft-command-config-store";
import { usePetCommandsQuery, type UsePetCommandsQueryInput } from "./use-pet-commands-query";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/hooks/use-agent-commands-query", () => ({
  useAgentCommandsQuery: (options: unknown) => {
    queryMock(options);
    return {
      commands: [] as AgentSlashCommand[],
      isLoading: false,
      isError: false,
      error: null,
    };
  },
}));

const READY: DraftCommandTarget = {
  status: "ready",
  config: {
    provider: "codex",
    cwd: " /repo ",
    modeId: "auto",
    model: "gpt-5.4",
    thinkingOptionId: "high",
    featureValues: { "web-search": true },
  },
};

const READY_CONFIG = {
  provider: "codex",
  cwd: "/repo",
  modeId: "auto",
  model: "gpt-5.4",
  thinkingOptionId: "high",
  featureValues: { "web-search": true },
};

const DRAFT_KEY = "draft:server-1:draft-1";

function lastQueryOptions(): Record<string, unknown> {
  const calls = queryMock.mock.calls;
  const options = calls[calls.length - 1]?.[0];
  if (options === undefined) {
    throw new Error("useAgentCommandsQuery was not called");
  }
  return options as Record<string, unknown>;
}

function mount(input: UsePetCommandsQueryInput) {
  return renderHook(() => usePetCommandsQuery(input));
}

afterEach(cleanup);

describe("usePetCommandsQuery", () => {
  beforeEach(() => {
    queryMock.mockClear();
    useDraftCommandConfigStore.setState({ byDraftKey: {} });
  });

  it("passes the published draft config but stays disabled while the menu is closed", () => {
    useDraftCommandConfigStore.getState().set(DRAFT_KEY, READY);

    mount({ serverId: "server-1", agentId: null, draftKey: DRAFT_KEY, menuVisible: false });

    expect(lastQueryOptions()).toEqual({
      serverId: "server-1",
      agentId: "",
      draftConfig: READY_CONFIG,
      enabled: false,
    });
  });

  it("enables the draft query once the menu opens", () => {
    useDraftCommandConfigStore.getState().set(DRAFT_KEY, READY);

    const { rerender } = renderHook(
      (input: UsePetCommandsQueryInput) => usePetCommandsQuery(input),
      {
        initialProps: {
          serverId: "server-1",
          agentId: null,
          draftKey: DRAFT_KEY,
          menuVisible: false,
        },
      },
    );
    rerender({
      serverId: "server-1",
      agentId: null,
      draftKey: DRAFT_KEY,
      menuVisible: true,
    });

    expect(lastQueryOptions()).toEqual({
      serverId: "server-1",
      agentId: "",
      draftConfig: READY_CONFIG,
      enabled: true,
    });
  });

  it("keeps the query disabled without a draft target and sends no draft config", () => {
    mount({ serverId: "server-1", agentId: null, draftKey: DRAFT_KEY, menuVisible: true });

    const options = lastQueryOptions();
    expect(options).toEqual({ serverId: "server-1", agentId: "", enabled: false });
    expect(options).not.toHaveProperty("draftConfig");
  });

  it("queries an agent eagerly even while the menu is closed", () => {
    mount({ serverId: "server-1", agentId: "agent-1", draftKey: null, menuVisible: false });

    const options = lastQueryOptions();
    expect(options).toEqual({ serverId: "server-1", agentId: "agent-1", enabled: true });
    expect(options).not.toHaveProperty("draftConfig");
  });

  it("passes a draft target published after mount through to the query", () => {
    const { rerender } = renderHook(
      (input: UsePetCommandsQueryInput) => usePetCommandsQuery(input),
      {
        initialProps: {
          serverId: "server-1",
          agentId: null,
          draftKey: DRAFT_KEY,
          menuVisible: true,
        },
      },
    );
    expect(lastQueryOptions()).toEqual({ serverId: "server-1", agentId: "", enabled: false });

    act(() => {
      useDraftCommandConfigStore.getState().set(DRAFT_KEY, READY);
    });
    rerender({
      serverId: "server-1",
      agentId: null,
      draftKey: DRAFT_KEY,
      menuVisible: true,
    });

    expect(lastQueryOptions()).toEqual({
      serverId: "server-1",
      agentId: "",
      draftConfig: READY_CONFIG,
      enabled: true,
    });
  });
});
