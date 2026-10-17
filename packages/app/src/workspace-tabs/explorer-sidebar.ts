import { supportsDesktopPaneSplits } from "@/constants/layout";
import { selectIsCompactFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import {
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type ExplorerSidebarView = "changes" | "files" | "pr";
export type ExplorerSidebarPresentation = "overlay" | "dock" | "pane";

const VIEW_TARGETS: Record<ExplorerSidebarView, WorkspaceTabTarget> = {
  changes: { kind: "changes_tree" },
  files: { kind: "files" },
  pr: { kind: "pull_request" },
};

export interface ExplorerSidebarQuery {
  isCompact: boolean;
  workspaceKey: string | null;
  supportsPaneSplits?: boolean;
}

export interface ExplorerSidebarInput extends ExplorerSidebarQuery {
  checkout: ExplorerCheckoutContext | null;
}

export function resolveExplorerSidebarPresentation(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): ExplorerSidebarPresentation {
  if (input.isCompact) {
    return "overlay";
  }
  return (input.supportsPaneSplits ?? supportsDesktopPaneSplits()) ? "pane" : "dock";
}

export function usesCompactExplorerSidebar(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): boolean {
  return resolveExplorerSidebarPresentation(input) !== "pane";
}

/** Reveals the Explorer sidebar and selects one of its navigation trees. */
export function openExplorerSidebarView(
  input: ExplorerSidebarInput & { view: ExplorerSidebarView },
): void {
  if (!input.workspaceKey) return;
  const store = useWorkspaceLayoutStore.getState();
  const paneId = showExplorerSidebar(input);
  store.openTab({
    workspaceKey: input.workspaceKey,
    target: VIEW_TARGETS[input.view],
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
}

export function showExplorerSidebar(input: ExplorerSidebarInput): string | null {
  if (input.isCompact) {
    usePanelStore.getState().showMobileFileExplorer();
  }
  if (input.workspaceKey) {
    return useWorkspaceLayoutStore.getState().showExplorerSidebar(input.workspaceKey);
  }
  return null;
}

export function hideExplorerSidebar(input: ExplorerSidebarInput): void {
  if (input.isCompact) {
    usePanelStore.getState().showMobileAgent();
    return;
  }
  if (input.workspaceKey) {
    useWorkspaceLayoutStore.getState().hideExplorerSidebar(input.workspaceKey);
  }
}

export function toggleExplorerSidebar(input: ExplorerSidebarInput): void {
  if (input.isCompact) {
    if (isExplorerSidebarOpen(input)) hideExplorerSidebar(input);
    else showExplorerSidebar(input);
    return;
  }
  if (!input.workspaceKey) return;
  if (isExplorerSidebarOpen(input)) {
    hideExplorerSidebar(input);
  } else {
    showExplorerSidebar(input);
  }
}

export function useIsExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  const compactOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const paneOpen = useWorkspaceLayoutStore((state) =>
    input.workspaceKey ? selectIsExplorerSidebarVisible(state, input.workspaceKey) : false,
  );
  return input.isCompact ? compactOpen : paneOpen;
}

export function isExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  if (input.isCompact) {
    return selectIsCompactFileExplorerOpen(usePanelStore.getState());
  }
  return Boolean(
    input.workspaceKey &&
    selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), input.workspaceKey),
  );
}
