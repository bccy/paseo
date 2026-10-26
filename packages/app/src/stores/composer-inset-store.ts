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
 * How far the keyboard has lifted the composer off its resting place.
 *
 * The dock does not move by `keyboardWillShow.endCoordinates.height` alone: its
 * `KeyboardTranslateView` adds the bottom safe area and a `bottomClearance` on
 * top of it. The pet used to subscribe to the raw keyboard event and lift by
 * that, which left her a safe-area taller than the bar she is supposed to hang
 * from. Reporting the dock's own number removes the second source of truth.
 *
 * `null` means "no keyboard", which is also what the pet assumes before the
 * first report lands.
 */
interface KeyboardLiftState {
  /** How far the composer has risen from its resting position, in points. */
  lift: number | null;
  setLift: (lift: number | null) => void;
}

export const useKeyboardLiftStore = create<KeyboardLiftState>((set) => ({
  lift: null,
  setLift: (lift) => {
    set((state) => (state.lift === lift ? state : { lift }));
  },
}));
