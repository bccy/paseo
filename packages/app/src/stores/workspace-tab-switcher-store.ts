import { create } from "zustand";

/**
 * Open state of the compact (mobile) workspace tab switcher.
 *
 * The switcher's own header button toggles it, and the desk pet's triple tap
 * opens it from outside the component tree — which is why the state lives in a
 * store instead of in the component. Runtime-only: never persisted, so the panel
 * never reopens by itself after an app restart.
 */
interface WorkspaceTabSwitcherState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: (isOpen: boolean) => void;
}

export const useWorkspaceTabSwitcherStore = create<WorkspaceTabSwitcherState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (isOpen) => set({ isOpen }),
}));
