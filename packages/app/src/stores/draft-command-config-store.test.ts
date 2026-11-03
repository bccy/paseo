import { beforeEach, describe, expect, it } from "vitest";
import type { DraftCommandTarget } from "@/agent-commands";
import { useDraftCommandConfigStore } from "./draft-command-config-store";

const READY: DraftCommandTarget = {
  status: "ready",
  config: { provider: "codex", cwd: "/repo", modeId: "auto" },
};

function resetStore(): void {
  useDraftCommandConfigStore.setState({ byDraftKey: {} });
}

describe("useDraftCommandConfigStore", () => {
  beforeEach(resetStore);

  it("stores a target under its draft key", () => {
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", READY);
    expect(useDraftCommandConfigStore.getState().byDraftKey["draft:server:draft-1"]).toBe(READY);
  });

  it("ignores a shallow-equal replacement so subscribers do not wake", () => {
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", READY);
    const previousByDraftKey = useDraftCommandConfigStore.getState().byDraftKey;

    useDraftCommandConfigStore.getState().set("draft:server:draft-1", {
      status: "ready",
      config: { provider: "codex", cwd: "/repo", modeId: "auto" },
    });

    expect(useDraftCommandConfigStore.getState().byDraftKey).toBe(previousByDraftKey);
  });

  it("compares feature values one level deep", () => {
    const withFeatures: DraftCommandTarget = {
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        featureValues: { "web-search": true, effort: "high" },
      },
    };
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", withFeatures);
    const previousByDraftKey = useDraftCommandConfigStore.getState().byDraftKey;

    useDraftCommandConfigStore.getState().set("draft:server:draft-1", {
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        featureValues: { "web-search": true, effort: "high" },
      },
    });
    expect(useDraftCommandConfigStore.getState().byDraftKey).toBe(previousByDraftKey);

    useDraftCommandConfigStore.getState().set("draft:server:draft-1", {
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        featureValues: { "web-search": true, effort: "low" },
      },
    });
    expect(useDraftCommandConfigStore.getState().byDraftKey).not.toBe(previousByDraftKey);
  });

  it("replaces a target when the draft status changes", () => {
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", READY);
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", { status: "needs-provider" });
    expect(useDraftCommandConfigStore.getState().byDraftKey["draft:server:draft-1"]).toEqual({
      status: "needs-provider",
    });
  });

  it("clears only the draft it is asked to clear", () => {
    const other: DraftCommandTarget = { status: "needs-project" };
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", READY);
    useDraftCommandConfigStore.getState().set("draft:server:draft-2", other);

    useDraftCommandConfigStore.getState().clear("draft:server:draft-1");

    expect(useDraftCommandConfigStore.getState().byDraftKey).toEqual({
      "draft:server:draft-2": other,
    });
  });

  it("does not touch state when clearing an unknown draft", () => {
    useDraftCommandConfigStore.getState().set("draft:server:draft-1", READY);
    const previousByDraftKey = useDraftCommandConfigStore.getState().byDraftKey;

    useDraftCommandConfigStore.getState().clear("draft:server:missing");

    expect(useDraftCommandConfigStore.getState().byDraftKey).toBe(previousByDraftKey);
  });
});
