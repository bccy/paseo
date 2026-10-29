import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent, type View } from "react-native";
import { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useKeyboardAnchor, useKeyboardShift } from "@/keyboard/shift";
import type { PetLedge } from "@/pets/ledge";
import { usePetLedgeStore } from "@/stores/pet-ledge-store";

/**
 * Report the bordered input box as the pet's ledge.
 *
 * Why the box and not the dock: the dock's wrapper is the whole *slot*, which also
 * holds everything the composer stacks above its text field — the draft tab's
 * import pill, the queue list, a send error — plus the bottom safe area. The pet
 * hung its peek on the slot's top edge, so an unstarted conversation showed her
 * above the import pill instead of on the input box. This measures the box.
 *
 * Why `measureAtRest`: the pet layer rides the same `KeyboardTranslateView`
 * translation as the composer, so the pet's coordinates are the keyboard-closed
 * frame. `measureAtRest` returns the element's window rect with that translation
 * left out — exactly that frame. `measureInWindow` would return the lifted rect
 * while the keyboard is open, parking the peek a keyboard's height too low.
 *
 * Why a claim stack: several composers are mounted at once (a retained panel, a
 * draft tab, New workspace, the setup modal). Only the one the user is actually in
 * may own the ledge, and when it stops being that one the previous owner has to
 * take over again — releasing to `null` would leave the pet with no ledge even
 * though a composer is plainly on screen.
 *
 * The caller supplies the element's ref and attaches the returned `onLayout` to
 * it. `onLayout` is what catches a box that changed size without a remount: a
 * multi-line draft, the attachment tray, the compact breakpoint.
 */
export function usePetLedgeReporting(input: {
  readonly ref: React.RefObject<View | null>;
  readonly active: boolean;
}): { readonly onLayout: (event: LayoutChangeEvent) => void } {
  const { ref, active } = input;
  const { measureAtRest, translation } = useKeyboardAnchor();
  const claim = usePetLedgeStore((state) => state.claim);
  const update = usePetLedgeStore((state) => state.update);
  const release = usePetLedgeStore((state) => state.release);

  const [layoutGeneration, setLayoutGeneration] = useState(0);
  const onLayout = useCallback((_event: LayoutChangeEvent) => {
    setLayoutGeneration((current) => current + 1);
  }, []);

  // The box can move in the window without its own layout changing: a centered form
  // re-centres when a field above it grows, and the whole window can resize (a
  // rotation, a split-view change, a desktop window drag). `onLayout` sees neither,
  // so those two also trigger a remeasure — the same pair `autocomplete-popover`
  // watches for its own anchor.
  const window = useWindowDimensions();
  const { isMoving } = useKeyboardShift();
  const remeasure = useCallback(() => {
    setLayoutGeneration((current) => current + 1);
  }, []);
  // `isMoving` is a shared value; reading it in a reaction and hopping to JS once it
  // falls is cheaper than subscribing the component to it.
  useAnimatedReaction(
    () => isMoving.value,
    (moving, wasMoving) => {
      if (wasMoving === true && !moving) scheduleOnRN(remeasure);
    },
    [isMoving, remeasure],
  );

  /** The claim this composer currently holds, or 0 while it holds none. */
  const seqRef = useRef(0);
  /** The last rectangle reported, so a translation change can update in place. */
  const ledgeRef = useRef<PetLedge | null>(null);
  /**
   * A measurement only lands if it is still the newest one: a fast resize can
   * resolve out of order, and applying the older rect would park the peek on a
   * ledge the box no longer has.
   */
  const generationRef = useRef(0);

  // The translation travels with the claim so the pet layer can reproduce the
  // dock's lift with `KeyboardTranslateView {...translation}` — the same driver,
  // frame for frame, instead of an approximation from keyboard events.
  const translationRef = useRef(translation);
  translationRef.current = translation;

  useEffect(() => {
    if (!active) {
      if (seqRef.current !== 0) {
        release(seqRef.current);
        seqRef.current = 0;
      }
      ledgeRef.current = null;
      return undefined;
    }
    const element = ref.current;
    if (!element) return undefined;

    generationRef.current += 1;
    const generation = generationRef.current;
    let cancelled = false;
    void measureAtRest(element).then((rect) => {
      if (cancelled || generation !== generationRef.current || rect === null) return undefined;
      const ledge: PetLedge = { topY: rect.y, left: rect.x, right: rect.x + rect.width };
      ledgeRef.current = ledge;
      if (seqRef.current === 0) {
        seqRef.current = claim({ ledge, translation: translationRef.current });
      } else {
        update(seqRef.current, { ledge, translation: translationRef.current });
      }
      return undefined;
    });
    return () => {
      cancelled = true;
    };
    // The store actions and `measureAtRest` are stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, layoutGeneration, window.width, window.height]);

  // A centered dock changes its clearance on layout; the claim has to carry the
  // new translation or the pet would ride a different curve than the box.
  useEffect(() => {
    const ledge = ledgeRef.current;
    if (ledge === null || seqRef.current === 0) return;
    update(seqRef.current, { ledge, translation });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translation.enabled, translation.bottomClearance]);

  // Never leave a claim behind: it would keep the pet parked on a box that no
  // longer exists.
  useEffect(
    () => () => {
      if (seqRef.current !== 0) {
        release(seqRef.current);
        seqRef.current = 0;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { onLayout };
}
