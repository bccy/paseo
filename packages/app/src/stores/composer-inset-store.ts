import { create } from "zustand";

/**
 * Where the composer's top edge sits, measured rather than computed.
 *
 * The desk pet has to park a peek standee exactly on the input bar's ledge. The
 * bar's height is not a constant: it grows with a multi-line draft, it changes
 * with the dynamic type size, and its wrapper pads by the bottom safe area,
 * which differs per device. Any constant we pick is wrong for some of those.
 *
 * The dock already renders a `View` around the composer that carries exactly
 * that padding, so its measured height *is* the distance from the screen bottom
 * to the ledge, with the keyboard closed. It reports the number here and the
 * pet subscribes.
 *
 * `inset` stays `null` until the first layout lands: a zero would read as "the
 * composer is 0pt tall" and clamp the pet far too low during the first frames.
 */
interface ComposerInsetState {
  /** Distance from the screen bottom to the composer's top edge, in points. */
  inset: number | null;
  setInset: (inset: number) => void;
}

export const useComposerInsetStore = create<ComposerInsetState>((set) => ({
  inset: null,
  setInset: (inset) => {
    set((state) => (state.inset === inset ? state : { inset }));
  },
}));

/**
 * Extra distance `KeyboardTranslateView` adds on top of the keyboard height.
 *
 * The composer does not rise by the keyboard height alone: the dock translates it
 * by the keyboard height plus this clearance, which keeps a centered form from
 * being pushed past the keyboard's top. The pet hangs a peek standee on the
 * composer's ledge, so it has to lift by the same total.
 *
 * Only the clearance is reported from the dock. The keyboard height itself is an
 * `AnimatedMultiplication` there, and composed Animated nodes reject
 * `addListener`, so trying to mirror the whole translation reported nothing and
 * left the pet stationary while the bar rose.
 */
interface KeyboardClearanceState {
  /** Points added to the keyboard height when the composer translates. */
  clearance: number;
  setClearance: (clearance: number) => void;
}

export const useKeyboardClearanceStore = create<KeyboardClearanceState>((set) => ({
  clearance: 0,
  setClearance: (clearance) => {
    set((state) => (state.clearance === clearance ? state : { clearance }));
  },
}));
