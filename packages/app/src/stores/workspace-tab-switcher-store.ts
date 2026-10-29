import { create } from "zustand";

/**
 * Open state of the compact (mobile) workspace tab switcher.
 *
 * The switcher's own header button toggles it, and the desk pet's triple tap
 * opens it from outside the component tree — which is why the state lives in a
 * store instead of in the component. Runtime-only: never persisted, so the panel
 * never reopens by itself after an app restart.
 *
 * Opening is gated on a mounted consumer. The pet's triple tap can fire from any
 * screen; without the gate it armed `isOpen` for a switcher that was not on
 * screen, and the panel popped open the next time a workspace was entered.
 */
interface WorkspaceTabSwitcherState {
  isOpen: boolean;
  /** Mounted switchers. `open()` is a no-op while this is zero. */
  consumerCount: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setOpen: (isOpen: boolean) => void;
  /**
   * Announce a mounted switcher. Call from an effect and return the result as
   * its cleanup. The last consumer to leave closes the panel.
   */
  register: () => () => void;
}

export const useWorkspaceTabSwitcherStore = create<WorkspaceTabSwitcherState>((set, get) => ({
  isOpen: false,
  consumerCount: 0,
  open: () => {
    if (get().consumerCount === 0) return;
    set({ isOpen: true });
  },
  close: () => set({ isOpen: false }),
  toggle: () => {
    if (get().consumerCount === 0) return;
    set((state) => ({ isOpen: !state.isOpen }));
  },
  setOpen: (isOpen) => set({ isOpen }),
  register: () => {
    set((state) => ({ consumerCount: state.consumerCount + 1 }));
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      set((state) => {
        const consumerCount = Math.max(0, state.consumerCount - 1);
        // Nothing can show the panel any more, so it must not stay armed.
        return consumerCount === 0 ? { consumerCount, isOpen: false } : { consumerCount };
      });
    };
  },
}));
