import { describe, expect, it } from "vitest";
import type { DraftCommandTarget } from "@/hooks/use-agent-commands-query";
import { resolvePetCommandQuery } from "./pet-command-query";

const READY_DRAFT: DraftCommandTarget = {
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

describe("resolvePetCommandQuery", () => {
  it("keeps a draft query disabled while the menu is closed", () => {
    expect(
      resolvePetCommandQuery({
        serverId: "server-1",
        agentId: null,
        draft: READY_DRAFT,
        menuVisible: false,
      }),
    ).toEqual({
      serverId: "server-1",
      agentId: "",
      draftConfig: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        featureValues: { "web-search": true },
      },
      enabled: false,
    });
  });

  it("enables a ready draft query when the menu opens and passes the full config", () => {
    expect(
      resolvePetCommandQuery({
        serverId: "server-1",
        agentId: null,
        draft: READY_DRAFT,
        menuVisible: true,
      }),
    ).toEqual({
      serverId: "server-1",
      agentId: "",
      draftConfig: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        featureValues: { "web-search": true },
      },
      enabled: true,
    });
  });

  it("keeps the query disabled for a draft that needs a project or provider", () => {
    const needsProject = resolvePetCommandQuery({
      serverId: "server-1",
      agentId: null,
      draft: { status: "needs-project" },
      menuVisible: true,
    });
    const needsProvider = resolvePetCommandQuery({
      serverId: "server-1",
      agentId: null,
      draft: { status: "needs-provider" },
      menuVisible: true,
    });

    expect(needsProject).toEqual({
      serverId: "server-1",
      agentId: "",
      enabled: false,
    });
    expect(needsProvider).toEqual({
      serverId: "server-1",
      agentId: "",
      enabled: false,
    });
  });

  it("queries an agent eagerly even while the menu is closed", () => {
    expect(
      resolvePetCommandQuery({
        serverId: "server-1",
        agentId: "agent-1",
        draft: undefined,
        menuVisible: false,
      }),
    ).toEqual({
      serverId: "server-1",
      agentId: "agent-1",
      enabled: true,
    });
  });

  it("never enables the query without a server", () => {
    expect(
      resolvePetCommandQuery({
        serverId: "",
        agentId: "agent-1",
        draft: READY_DRAFT,
        menuVisible: true,
      }),
    ).toEqual({
      serverId: "",
      agentId: "agent-1",
      enabled: false,
    });
    expect(
      resolvePetCommandQuery({
        serverId: "",
        agentId: null,
        draft: READY_DRAFT,
        menuVisible: true,
      }),
    ).toEqual({
      serverId: "",
      agentId: "",
      draftConfig: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        featureValues: { "web-search": true },
      },
      enabled: false,
    });
  });

  it("ignores a draft target when an agent id is present", () => {
    expect(
      resolvePetCommandQuery({
        serverId: "server-1",
        agentId: "agent-1",
        draft: READY_DRAFT,
        menuVisible: true,
      }),
    ).toEqual({
      serverId: "server-1",
      agentId: "agent-1",
      enabled: true,
    });
  });
});
