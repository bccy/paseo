/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftCommandConfigStore } from "@/stores/draft-command-config-store";
import { useDraftStore } from "@/stores/draft-store";
import { useAgentInputDraft } from "@/composer/draft/input-draft";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

vi.mock("@/attachments/service", () => ({
  garbageCollectAttachments: async () => undefined,
}));

vi.mock("@/hooks/use-agent-form-state", () => ({
  useAgentFormState: () => ({
    selectedServerId: "host-1",
    selectedProvider: "codex",
    setProviderFromUser: () => undefined,
    selectedMode: "auto",
    setModeFromUser: () => undefined,
    selectedModel: "",
    setModelFromUser: () => undefined,
    selectedThinkingOptionId: "",
    setThinkingOptionFromUser: () => undefined,
    workingDir: "/repo",
    providerDefinitions: [{ id: "codex", label: "Codex", modes: [{ id: "auto", label: "Auto" }] }],
    providerDefinitionMap: new Map(),
    agentDefinition: undefined,
    modeOptions: [{ id: "auto", label: "Auto" }],
    availableModels: [
      {
        provider: "codex",
        id: "gpt-5.4",
        label: "gpt-5.4",
        isDefault: true,
        defaultThinkingOptionId: "high",
        thinkingOptions: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
    ],
    allProviderModels: new Map(),
    modelSelectorProviders: [],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High", isDefault: true },
    ],
    isModelLoading: false,
    modelError: null,
    refetchProviderModelsIfStale: () => undefined,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const MOUNTED = new Set<Root>();

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of MOUNTED) root.unmount();
    MOUNTED.clear();
  });
});

beforeEach(() => {
  asyncStorage.clear();
  document.body.innerHTML = "<div id='root'></div>";
  useDraftCommandConfigStore.setState({ byDraftKey: {} });
  useDraftStore.setState({
    drafts: {},
    createModalDraft: null,
    attachmentFocusRequestByDraftKey: {},
  });
});

function Probe({ draftKey, withComposer }: { draftKey: string; withComposer: boolean }) {
  useAgentInputDraft({
    draftKey,
    ...(withComposer
      ? {
          composer: {
            initialServerId: "host-1",
            isVisible: true,
            lockedWorkingDir: "/repo",
          },
        }
      : {}),
  });
  return null;
}

async function mountProbe(input: { draftKey: string; withComposer: boolean }): Promise<Root> {
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing root container");
  const root = createRoot(container);
  MOUNTED.add(root);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe {...input} />
      </QueryClientProvider>,
    );
  });
  return root;
}

describe("useAgentInputDraft command-config publication", () => {
  it("publishes the draft composer's command target under its draft key", async () => {
    await mountProbe({ draftKey: "draft:pet-sync", withComposer: true });

    expect(useDraftCommandConfigStore.getState().byDraftKey["draft:pet-sync"]).toEqual({
      status: "ready",
      config: {
        provider: "codex",
        cwd: "/repo",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      },
    });
  });

  it("clears the published target when the composer unmounts", async () => {
    const root = await mountProbe({ draftKey: "draft:pet-sync", withComposer: true });
    expect(useDraftCommandConfigStore.getState().byDraftKey["draft:pet-sync"]).toBeDefined();

    await act(async () => {
      root.unmount();
      MOUNTED.delete(root);
    });

    expect(useDraftCommandConfigStore.getState().byDraftKey["draft:pet-sync"]).toBeUndefined();
  });

  it("does not publish for an agent-session draft hook without composer options", async () => {
    await mountProbe({ draftKey: "agent:host-1:agent-1", withComposer: false });

    expect(
      useDraftCommandConfigStore.getState().byDraftKey["agent:host-1:agent-1"],
    ).toBeUndefined();
  });
});
