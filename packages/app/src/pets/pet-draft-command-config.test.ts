import { describe, expect, it } from "vitest";
import { resolvePetDraftCommandConfig } from "./pet-draft-command-config";

describe("resolvePetDraftCommandConfig", () => {
  it("returns no query config while the draft still needs a project", () => {
    expect(resolvePetDraftCommandConfig({ status: "needs-project" })).toBeUndefined();
  });

  it("returns no query config while the draft still needs a provider", () => {
    expect(resolvePetDraftCommandConfig({ status: "needs-provider" })).toBeUndefined();
  });

  it("returns no query config when the pet has no draft target at all", () => {
    expect(resolvePetDraftCommandConfig(undefined)).toBeUndefined();
  });

  it("keeps a ready config and drops blank optional fields", () => {
    expect(
      resolvePetDraftCommandConfig({
        status: "ready",
        config: {
          provider: "codex",
          cwd: "  /repo  ",
          modeId: " ",
          model: "",
          thinkingOptionId: "high",
          providerOptions: {},
        },
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo",
      thinkingOptionId: "high",
    });
  });

  it("keeps non-empty feature values", () => {
    expect(
      resolvePetDraftCommandConfig({
        status: "ready",
        config: {
          provider: "codex",
          cwd: "/repo",
          providerOptions: { "web-search": true, effort: "high" },
        },
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/repo",
      providerOptions: { "web-search": true, effort: "high" },
    });
  });
});
