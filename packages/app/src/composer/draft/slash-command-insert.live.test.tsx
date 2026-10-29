/**
 * The desk pet's slash-command menu writes through the draft store, not through
 * the composer's props, so the merge rule has to hold at the hook that consumes
 * the request — not only in the pure helper.
 *
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "@/stores/draft-store";

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
    availableModels: [],
    allProviderModels: new Map(),
    modelSelectorProviders: [],
    isAllModelsLoading: false,
    isProviderModelsRefreshing: false,
    availableThinkingOptions: [],
    isModelLoading: false,
    modelError: null,
    refreshProviderModels: () => undefined,
    setProviderAndModelFromUser: () => undefined,
    workingDirIsEmpty: false,
    persistFormPreferences: async () => undefined,
  }),
}));

const mountedRoots = new Set<Root>();

function createTestRoot(container: HTMLElement): Root {
  const root = createRoot(container);
  mountedRoots.add(root);
  return root;
}

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
  });
});

let useAgentInputDraft: typeof import("./input-draft").useAgentInputDraft;

beforeAll(async () => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
  ({ useAgentInputDraft } = await import("./input-draft"));
});

const DRAFT_KEY = "draft:slash-insert";

async function mountDraft() {
  let latest: ReturnType<typeof useAgentInputDraft> | null = null;

  function getLatest(): ReturnType<typeof useAgentInputDraft> {
    if (!latest) throw new Error("Expected hook result");
    return latest;
  }

  function Probe() {
    latest = useAgentInputDraft({ draftKey: DRAFT_KEY });
    return null;
  }

  const container = document.getElementById("root");
  if (!container) throw new Error("Missing root container");
  const root = createTestRoot(container);
  const queryClient = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { getLatest };
}

describe("useAgentInputDraft text-insert requests", () => {
  beforeEach(() => {
    asyncStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    localStorage.clear();
    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
      textInsertRequestByDraftKey: {},
      appliedTextInsertRevisionByDraftKey: {},
    });
  });

  it("puts the command at the head of the draft and keeps the user's text", async () => {
    const { getLatest } = await mountDraft();

    await act(async () => {
      getLatest().editText("帮我把登录页改成暗色");
    });
    await act(async () => {
      useDraftStore.getState().requestTextInsert({ draftKey: DRAFT_KEY, text: "/model " });
    });

    expect(getLatest().textReplacement.kind).toBe("replace");
    expect(getLatest().textReplacement.text).toBe("/model 帮我把登录页改成暗色");
    expect(getLatest().textSource.getSnapshot()).toBe("/model 帮我把登录页改成暗色");
  });

  it("does not lose text typed on web between the input event and the store write", async () => {
    const { getLatest } = await mountDraft();

    // On web `editText` stages the store write until after paint; the insert must
    // merge with the staged text, not with the older persisted value.
    await act(async () => {
      getLatest().editText("第一行\n第二行");
      useDraftStore.getState().requestTextInsert({ draftKey: DRAFT_KEY, text: "/plan " });
    });

    expect(getLatest().textReplacement.text).toBe("/plan 第一行\n第二行");
  });

  it("replaces a leading command instead of stacking two", async () => {
    const { getLatest } = await mountDraft();

    await act(async () => {
      getLatest().editText("/clear 原文");
    });
    await act(async () => {
      useDraftStore.getState().requestTextInsert({ draftKey: DRAFT_KEY, text: "/model " });
    });

    expect(getLatest().textReplacement.text).toBe("/model 原文");
  });

  it("does not carry cleared text into the next insert", async () => {
    const { getLatest } = await mountDraft();

    await act(async () => {
      getLatest().editText("已发送的草稿");
    });
    await act(async () => {
      getLatest().clear("sent");
    });
    await act(async () => {
      useDraftStore.getState().requestTextInsert({ draftKey: DRAFT_KEY, text: "/model " });
    });

    expect(getLatest().textReplacement.text).toBe("/model ");
  });

  it("consumes the request exactly once", async () => {
    const { getLatest } = await mountDraft();

    await act(async () => {
      useDraftStore.getState().requestTextInsert({ draftKey: DRAFT_KEY, text: "/model " });
    });
    expect(useDraftStore.getState().textInsertRequestByDraftKey[DRAFT_KEY]).toBeUndefined();
    expect(useDraftStore.getState().appliedTextInsertRevisionByDraftKey[DRAFT_KEY]).toBe(1);

    // Web text publication is staged until after paint.
    const readLiveText = () => getLatest().textSource.getSnapshot();
    await act(async () => {
      getLatest().editText("改过的原文");
      await expect.poll(readLiveText).toBe("改过的原文");
    });

    // The applied request must not replay over the text typed afterwards.
    expect(getLatest().textReplacement.text).toBe("/model ");
    expect(readLiveText()).toBe("改过的原文");
  });
});
