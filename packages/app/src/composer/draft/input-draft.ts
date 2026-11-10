import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type { UserComposerAttachment } from "@/attachments/types";
import type { TextReplacement } from "@/composer/types";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { DraftCommandTarget } from "@/agent-commands";
import {
  useAgentFormState,
  type CreateAgentInitialValues,
  type UseAgentFormStateResult,
} from "@/hooks/use-agent-form-state";
import { useDraftProviderOptions } from "@/hooks/use-draft-provider-options";
import {
  buildDraftAgentControls,
  resolveDraftKey,
  type DraftKeyInput,
} from "@/composer/draft/input-draft-core";
import {
  buildDraftCommandTarget,
  resolveEffectiveComposerModeId,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useDraftCommandConfigStore } from "@/stores/draft-command-config-store";
import { useDraftStore, type DraftInput } from "@/stores/draft-store";
import { AfterPaintPublication } from "@/composer/after-paint-publication";
import { composeSlashCommandInsert } from "@/composer/draft/slash-command-insert";
import { useShallow } from "zustand/shallow";
import type { ComposerTextSource } from "@/composer/text-source";
import { isWeb } from "@/constants/platform";

const NO_METADATA: Record<string, JsonValue> = {};

type AttachmentUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

interface AgentInputDraftComposerOptions {
  initialServerId: string | null;
  initialValues?: CreateAgentInitialValues;
  initialProviderOptions?: Record<string, unknown>;
  /** Which composer a plugin's `useComposer()` reports. */
  context?: "draft" | "new-workspace";
  isVisible?: boolean;
  lockedWorkingDir?: string;
}

interface UseAgentInputDraftInput {
  draftKey: DraftKeyInput;
  composer?: AgentInputDraftComposerOptions;
}

type DraftComposerState = UseAgentFormStateResult & {
  workingDir: string;
  effectiveModeId: string;
  effectiveModelId: string;
  effectiveThinkingOptionId: string;
  providerOptions: Record<string, unknown> | undefined;
  /** What plugins set on the agent this draft creates. */
  metadata: Record<string, JsonValue>;
  agentControls: DraftAgentControlsProps;
  commandDraft: DraftCommandTarget;
};

export interface AgentInputDraft {
  textSource: ComposerTextSource;
  editText: (text: string) => void;
  replaceText: (text: string) => void;
  textReplacement: TextReplacement;
  attachments: UserComposerAttachment[];
  setAttachments: (updater: AttachmentUpdater) => void;
  clear: (lifecycle: "sent" | "abandoned") => void;
  isHydrated: boolean;
  attachmentFocusRequestId: number;
  composerState: DraftComposerState | null;
}

export function useAgentInputDraft(input: UseAgentInputDraftInput): AgentInputDraft {
  const composerOptions = input.composer ?? null;
  const workingDir = composerOptions?.lockedWorkingDir?.trim() || "";
  const formState = useAgentFormState({
    workingDir,
    serverId: composerOptions?.initialServerId ?? null,
    initialValues: composerOptions?.initialValues,
    isVisible: composerOptions?.isVisible ?? false,
    isCreateFlow: true,
  });
  const draftKey = useMemo(
    () =>
      resolveDraftKey({
        draftKey: input.draftKey,
        selectedServerId: formState.selectedServerId,
      }),
    [formState.selectedServerId, input.draftKey],
  );
  const attachments = useDraftStore(
    useShallow((state) =>
      state.drafts[draftKey]?.lifecycle === "active"
        ? (state.drafts[draftKey].input.attachments ?? [])
        : [],
    ),
  );
  const textSource = useMemo<ComposerTextSource>(
    () => ({
      getSnapshot: () => {
        const record = useDraftStore.getState().drafts[draftKey];
        return record?.lifecycle === "active" ? record.input.text : "";
      },
      subscribe: (listener) =>
        useDraftStore.subscribe((state, previous) => {
          if (
            state.drafts[draftKey]?.input.text !== previous.drafts[draftKey]?.input.text ||
            state.drafts[draftKey]?.lifecycle !== previous.drafts[draftKey]?.lifecycle
          )
            listener();
        }),
    }),
    [draftKey],
  );
  const attachmentFocusRequestId = useDraftStore(
    (state) => state.attachmentFocusRequestByDraftKey[draftKey] ?? 0,
  );
  const textInsertRequest = useDraftStore(
    useShallow((state) => state.textInsertRequestByDraftKey[draftKey] ?? null),
  );
  const appliedTextInsertRevision = useDraftStore(
    (state) => state.appliedTextInsertRevisionByDraftKey[draftKey] ?? 0,
  );
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const isHydrated = hydratedDraftKey === draftKey;
  const textReplacementRevisionRef = useRef(0);
  // The text the user currently sees. On web the store write is staged until
  // after paint, so the store alone can be one frame behind the input.
  const latestTextRef = useRef<string>(textSource.getSnapshot());
  const [textReplacement, setTextReplacement] = useState<TextReplacement>(() => ({
    kind: "initial",
    key: `${draftKey}:0`,
    text: textSource.getSnapshot(),
  }));

  const publishTextReplacement = useCallback(
    (kind: "hydrated" | "replace", nextText: string) => {
      textReplacementRevisionRef.current += 1;
      setTextReplacement({
        kind,
        key: `${draftKey}:${textReplacementRevisionRef.current}`,
        text: nextText,
      });
    },
    [draftKey],
  );

  const saveDraft = useCallback(
    (update: (draft: DraftInput) => DraftInput) =>
      useDraftStore.getState().updateDraftInput({ draftKey, update }),
    [draftKey],
  );

  const textPublication = useMemo(
    () =>
      new AfterPaintPublication<string>((nextText) => {
        latestTextRef.current = nextText;
        useDraftStore.getState().editDraftText({ draftKey, text: nextText });
      }),
    [draftKey],
  );

  // Text another module put in the draft (a plugin writing to a composer that is not on screen)
  // reaches the input the way a rewind restore does.
  const replacementRequest = useDraftStore(
    (state) => state.textReplacementRequestByDraftKey[draftKey] ?? 0,
  );
  const shownReplacementRequestRef = useRef({ draftKey, request: replacementRequest });
  useEffect(() => {
    const shown = shownReplacementRequestRef.current;
    if (shown.draftKey === draftKey && shown.request === replacementRequest) return;
    shownReplacementRequestRef.current = { draftKey, request: replacementRequest };
    textPublication.cancel();
    const nextText = textSource.getSnapshot();
    publishTextReplacement("replace", nextText);
    // A replacement from outside (`replaceDraftText`) is visible text too: the
    // ref must follow it, or a later insert rebuilds the draft from text the
    // input no longer shows.
    latestTextRef.current = nextText;
  }, [draftKey, publishTextReplacement, replacementRequest, textPublication, textSource]);

  const editText = useCallback(
    (nextText: string) => {
      // Web publication happens after paint, so the store can lag the input by a
      // frame. Track the text here as well: an insert request has to merge with
      // what the user sees, not with the last persisted value.
      latestTextRef.current = nextText;
      if (isWeb) {
        textPublication.stage(nextText);
      } else {
        useDraftStore.getState().editDraftText({ draftKey, text: nextText });
      }
    },
    [draftKey, textPublication],
  );

  const replaceText = useCallback(
    (nextText: string) => {
      textPublication.cancel();
      latestTextRef.current = nextText;
      useDraftStore.getState().editDraftText({ draftKey, text: nextText });
      publishTextReplacement("replace", nextText);
    },
    [draftKey, publishTextReplacement, textPublication],
  );

  // A different draft means different text; the ref must not carry the previous
  // draft's prose into an insert that arrives before hydration settles.
  useEffect(() => {
    latestTextRef.current = textSource.getSnapshot();
  }, [draftKey, textSource]);

  // Text insertions from outside the composer (the desk pet's slash-command
  // menu) arrive through the draft store and are applied through the same
  // `textReplacement` path the composer itself uses: the native input is
  // uncontrolled, so a draft-store text write alone would not be visible.
  //
  // The command is merged into the head of the draft, never swapped for it: the
  // user's prose survives picking a command.
  //
  // The request is consumed on apply and the applied revision lives in the
  // store: a ref here would reset when the composer remounts and replay the old
  // command over whatever the user typed in the meantime.
  useEffect(() => {
    if (textInsertRequest === null) return;
    if (textInsertRequest.revision <= appliedTextInsertRevision) return;
    replaceText(
      composeSlashCommandInsert({
        currentText: latestTextRef.current,
        insert: textInsertRequest.text,
      }),
    );
    useDraftStore.getState().consumeTextInsertRequest({
      draftKey,
      revision: textInsertRequest.revision,
    });
  }, [appliedTextInsertRevision, draftKey, replaceText, textInsertRequest]);

  const setAttachments = useCallback(
    (updater: AttachmentUpdater) => {
      saveDraft((current) => ({
        ...current,
        attachments: typeof updater === "function" ? updater(current.attachments) : updater,
      }));
    },
    [saveDraft],
  );

  const metadata = useDraftStore((state) => state.metadataByDraftKey[draftKey] ?? NO_METADATA);
  const setMetadata = useCallback(
    (patch: Record<string, JsonValue>) =>
      useDraftStore.getState().patchDraftMetadata({ draftKey, patch }),
    [draftKey],
  );

  const clear = useCallback(
    (lifecycle: "sent" | "abandoned") => {
      textPublication.cancel();
      latestTextRef.current = "";
      useDraftStore.getState().clearDraftInput({ draftKey, lifecycle });
      if (lifecycle === "sent") useDraftStore.getState().clearDraftMetadata({ draftKey });
    },
    [draftKey, textPublication],
  );

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") textPublication.flush();
    };
    const flush = () => textPublication.flush();
    const canListenForPageHide =
      isWeb && typeof window !== "undefined" && typeof window.addEventListener === "function";
    if (isWeb && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", flushWhenHidden);
    }
    if (canListenForPageHide) {
      window.addEventListener("pagehide", flush);
    }
    return () => {
      if (isWeb && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", flushWhenHidden);
      }
      if (canListenForPageHide) {
        window.removeEventListener("pagehide", flush);
      }
      textPublication.flush();
    };
  }, [textPublication]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useDraftStore.getState().hydrateDraftInput({ draftKey });
      if (!cancelled) {
        const hydratedText = useDraftStore.getState().getDraftInput(draftKey)?.text ?? "";
        latestTextRef.current = hydratedText;
        publishTextReplacement("hydrated", hydratedText);
        setHydratedDraftKey(draftKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, publishTextReplacement]);

  const providerSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: formState.selectedProvider,
      modelId: formState.selectedModel,
      modeId: formState.selectedMode,
      thinkingOptionId: formState.selectedThinkingOptionId,
      availableModels: formState.availableModels,
      modeOptions: formState.modeOptions,
    }),
    [
      formState.availableModels,
      formState.modeOptions,
      formState.selectedMode,
      formState.selectedModel,
      formState.selectedProvider,
      formState.selectedThinkingOptionId,
    ],
  );

  const effectiveModeId = useMemo(
    () => resolveEffectiveComposerModeId(providerSelection, formState.isModelLoading),
    [formState.isModelLoading, providerSelection],
  );

  const effectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(providerSelection),
    [providerSelection],
  );

  const effectiveThinkingOptionId = useMemo(
    () => resolveEffectiveComposerThinkingOptionId(providerSelection, effectiveModelId),
    [effectiveModelId, providerSelection],
  );

  const {
    optionControls: draftOptionControls,
    options: draftOptions,
    shownOptions: draftShownOptions,
    setOption: setDraftOption,
    applyProfile: applyProfileOptions,
  } = useDraftProviderOptions({
    serverId: formState.selectedServerId,
    provider: formState.selectedProvider,
    getProvider: formState.getSelectedProvider,
    cwd: workingDir,
    modeId: formState.selectedMode,
    modelId: effectiveModelId,
    thinkingOptionId: effectiveThinkingOptionId,
    initialOptions: composerOptions?.initialProviderOptions,
  });

  const applyDraftAgentProfile = useCallback(
    (profile: Parameters<typeof formState.applyProfileFromUser>[0]) => {
      formState.applyProfileFromUser(profile);
      applyProfileOptions({ provider: profile.provider, options: profile.options });
    },
    [applyProfileOptions, formState],
  );

  const commandDraft = useMemo(
    () =>
      buildDraftCommandTarget({
        selection: providerSelection,
        cwd: workingDir,
        effectiveModelId,
        effectiveThinkingOptionId,
        providerOptions: draftOptions,
      }),
    [effectiveModelId, effectiveThinkingOptionId, draftOptions, providerSelection, workingDir],
  );

  // The desk pet renders at the app root, outside this composer's tree. It
  // reads the focused draft's command target from this store, so publish the
  // same config the composer's `/` autocomplete uses. Agent-session panels call
  // this hook without composer options; they must not publish an unrelated
  // "draft" target under their agent key. A separate cleanup effect keeps the
  // clear to draft-key changes and unmounts, because clearing on every target
  // change would blank the pet's menu between two valid configs.
  const isDraftComposer = composerOptions !== null;
  useEffect(() => {
    if (!isDraftComposer) return;
    useDraftCommandConfigStore.getState().set(draftKey, commandDraft);
  }, [commandDraft, draftKey, isDraftComposer]);

  useEffect(() => {
    return () => {
      useDraftCommandConfigStore.getState().clear(draftKey);
    };
  }, [draftKey]);

  const composerState = useMemo<DraftComposerState | null>(() => {
    if (!composerOptions) {
      return null;
    }

    return {
      ...formState,
      workingDir,
      effectiveModeId,
      effectiveModelId,
      effectiveThinkingOptionId,
      providerOptions: draftOptions,
      metadata,
      agentControls: buildDraftAgentControls({
        formState,
        optionControls: draftOptionControls,
        options: draftShownOptions,
        onSetOption: setDraftOption,
        onApplyAgentProfile: applyDraftAgentProfile,
        context: composerOptions.context ?? "draft",
        metadata,
        onSetMetadata: setMetadata,
      }),
      commandDraft,
    };
  }, [
    commandDraft,
    composerOptions,
    effectiveModeId,
    effectiveModelId,
    effectiveThinkingOptionId,
    draftOptionControls,
    draftOptions,
    draftShownOptions,
    setDraftOption,
    applyDraftAgentProfile,
    formState,
    metadata,
    setMetadata,
    workingDir,
  ]);

  return {
    textSource,
    editText,
    replaceText,
    textReplacement,
    attachments,
    setAttachments,
    clear,
    isHydrated,
    attachmentFocusRequestId,
    composerState,
  };
}

export const __private__ = {
  resolveDraftKey,
  resolveEffectiveComposerModeId,
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  buildDraftCommandTarget,
  buildDraftAgentControls,
};
