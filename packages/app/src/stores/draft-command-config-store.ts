import { create } from "zustand";
import type { DraftCommandTarget } from "@/hooks/use-agent-commands-query";

/**
 * The command target of each mounted draft composer, keyed by its draft key.
 *
 * The desk pet renders at the app root, outside the composer tree, so it has no
 * way to read the focused draft's provider/cwd/mode/model/thinking/features
 * from props. The composer publishes them here; the pet subscribes to the key
 * of the focused draft. Values are cleared when the composer unmounts so a
 * closed draft cannot answer for a new one that reuses the key.
 */
interface DraftCommandConfigState {
  byDraftKey: Record<string, DraftCommandTarget>;
  set: (draftKey: string, target: DraftCommandTarget) => void;
  clear: (draftKey: string) => void;
}

function featureValuesEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a?.[key], b?.[key]));
}

/**
 * A shallow comparison: a composer re-derives its command target on every
 * provider/feature render, and an identical target must not wake the pet's
 * subscriber. Feature values are compared one level deep because the object is
 * rebuilt while its values are usually primitives.
 */
function draftCommandTargetsEqual(a: DraftCommandTarget, b: DraftCommandTarget): boolean {
  if (a === b) return true;
  if (a.status !== b.status) return false;
  if (a.status !== "ready" || b.status !== "ready") return true;
  if (a.config.provider !== b.config.provider) return false;
  if (a.config.cwd !== b.config.cwd) return false;
  if (a.config.modeId !== b.config.modeId) return false;
  if (a.config.model !== b.config.model) return false;
  if (a.config.thinkingOptionId !== b.config.thinkingOptionId) return false;
  return featureValuesEqual(a.config.featureValues, b.config.featureValues);
}

export const useDraftCommandConfigStore = create<DraftCommandConfigState>()((set, get) => ({
  byDraftKey: {},
  set: (draftKey, target) => {
    const current = get().byDraftKey[draftKey];
    if (current !== undefined && draftCommandTargetsEqual(current, target)) return;
    set((state) => ({ byDraftKey: { ...state.byDraftKey, [draftKey]: target } }));
  },
  clear: (draftKey) => {
    if (!(draftKey in get().byDraftKey)) return;
    set((state) => {
      const byDraftKey = { ...state.byDraftKey };
      delete byDraftKey[draftKey];
      return { byDraftKey };
    });
  },
}));
