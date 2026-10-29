/**
 * Where the pet may rest, and how a drop settles.
 *
 * The renderer used to take its bottom limit from a single global "composer
 * inset": the dock wrote its slot wrapper's height into a store and the pet read
 * it. That number was wrong twice over. It measured the *slot* — everything the
 * composer stacks above its text field (the draft tab's import pill, the queue
 * list, a send error) plus the bottom safe area — so a bottom peek parked above
 * the pill instead of on the input box. And it was one value with several docks
 * mounted at once (a retained panel, a draft tab, New workspace), so the last one
 * to lay out won and a screen without a composer kept using it.
 *
 * The ledge now arrives from the composer that owns the visible input box, as the
 * box's own rectangle in **window points with the keyboard closed**. The pet layer
 * rides the same `KeyboardTranslateView` translation as that composer, so its own
 * coordinates are that same keyboard-closed window space: the ledge arithmetic
 * never mentions the keyboard, and only the top clamp has to.
 *
 * The peek geometry itself (crop-line anchors, shifts, the snap threshold) stays in
 * `pose-map`; this module adds what the ledge decides on top of it.
 *
 * @module paseo/pets/ledge
 */

import {
  resolveDragDropEdge,
  resolveDropEdge,
  settleCancelledDrag,
  snapToPeekEdge,
  type PeekEdge,
} from "./pose-map";

/** The visible input box's rectangle, in keyboard-closed window points. */
export interface PetLedge {
  /** Top edge of the bordered input box. */
  readonly topY: number;
  readonly left: number;
  readonly right: number;
}

/** The cell rectangle the pet may rest in, in the pet layer's own coordinates. */
export interface PetRestBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The resting rectangle for a pet of `size` points.
 *
 * `maxY` puts a bottom peek's crop line on the ledge: the cell's bottom edge sits
 * `edgeMargin` above the input box and `peekShift` then pushes the artwork down by
 * its own crop-line offset, so the visible half starts exactly at the box.
 *
 * With no ledge there is no composer on screen and the resting surface is the
 * screen bottom minus the safe area, so a full-body pet can still be put there.
 */
export function resolveRestBounds(input: {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly edgeMargin: number;
  readonly topInset: number;
  readonly bottomInset: number;
  readonly ledge: PetLedge | null;
}): PetRestBounds {
  "worklet";
  const minX = input.edgeMargin;
  const maxX = Math.max(input.edgeMargin, input.width - input.size - input.edgeMargin);
  const minY = input.topInset + input.edgeMargin;
  const surfaceTop = input.ledge === null ? input.height - input.bottomInset : input.ledge.topY;
  return {
    minX,
    maxX,
    minY,
    maxY: Math.max(minY, surfaceTop - input.size - input.edgeMargin),
  };
}

/**
 * The horizontal range a bottom peek's cell may occupy.
 *
 * A centered form does not span the screen, and a pet hanging in the air beside it
 * reads as detached. The range is expressed on the *cell* rather than on the
 * visible artwork because the cell is what the drag moves; a box narrower than one
 * cell collapses to the box's centre so the peek still lands on it.
 *
 * Only the bottom edge uses this: a side peek's cell is the sliver the user dragged
 * to the screen edge, and pulling it into the input box's columns would tear it off
 * the wall.
 */
export function resolveBottomPeekXRange(input: {
  readonly ledge: PetLedge | null;
  readonly size: number;
  readonly minX: number;
  readonly maxX: number;
}): { readonly min: number; readonly max: number } {
  "worklet";
  const { ledge, size, minX, maxX } = input;
  if (ledge === null) return { min: minX, max: maxX };
  const span = ledge.right - ledge.left;
  if (span <= size) {
    const centred = ledge.left + span / 2 - size / 2;
    return { min: centred, max: centred };
  }
  return { min: Math.max(minX, ledge.left), max: Math.min(maxX, ledge.right - size) };
}

/**
 * How far the pet's cell must be pushed down so the keyboard cannot shove it off
 * the screen top.
 *
 * The pet layer is translated with the composer, so opening the keyboard moves it
 * *up*; a pet parked near the top would leave the window. The clamp is a function
 * of the keyboard's target lift (the value `KeyboardTranslateView` reserves at the
 * start and end of the motion, not the per-frame animation), so it is eased once
 * per keyboard event instead of being sampled per frame, and closing the keyboard
 * takes it back to zero — which is what returns the pet to where the user left it,
 * with no remembered "pre-keyboard" position that could go stale.
 *
 * `y` is the cell's resting top in keyboard-closed space; its rendered top is
 * `y - lift + clamp`, so the clamp is whatever keeps that at or below
 * `topInset + edgeMargin`.
 */
export function resolveKeyboardTopClamp(input: {
  readonly y: number;
  readonly lift: number;
  readonly topInset: number;
  readonly edgeMargin: number;
}): number {
  "worklet";
  const renderedTop = input.y - input.lift;
  const lowest = input.topInset + input.edgeMargin;
  return renderedTop < lowest ? lowest - renderedTop : 0;
}

/**
 * The lift the pet layer itself is translated by.
 *
 * The clamp has to use the pet layer's *own* lift, not the raw keyboard shift. Two
 * ways that matters:
 *
 * - With no composer claiming the ledge, the pet layer is not wrapped in an enabled
 *   `KeyboardTranslateView`, so it does not move at all. Clamping against the raw
 *   shift would push a pet near the top of the screen down by a whole keyboard
 *   height while it visibly stayed put.
 * - A centered dock lifts its form by `shift - bottomClearance`, not by `shift`
 *   (see `keyboard/shift/internal/policy.ts` → `resolveKeyboardLift`). Using the raw
 *   shift would clamp by more than the pet actually rose.
 *
 * `translation` is the same `{enabled, bottomClearance}` object handed to the pet
 * layer's `KeyboardTranslateView`, so this reproduces its lift exactly.
 */
export function resolvePetLayerLift(input: {
  readonly shift: number;
  readonly enabled: boolean;
  readonly bottomClearance: number;
}): number {
  "worklet";
  return input.enabled ? Math.max(0, input.shift - input.bottomClearance) : 0;
}

/**
 * Fold the keyboard clamp into the cell before a drag starts tracking the finger.
 *
 * The clamp is a rendering offset on top of `y`, so a pet that is being pushed down
 * by it is drawn lower than `y` says. A drag moves the *rendered* cell, so on grab
 * the offset has to become part of `y` — exactly like the peek shift — or the pet
 * jumps up by the clamp on the first `onUpdate` and then jumps again when the drop
 * recomputes the clamp from the new position.
 *
 * `peekShift` is folded in the same call for the same reason, so the two offsets
 * cannot drift apart in the order they are applied.
 */
export function foldDragOffsets(input: {
  readonly y: number;
  readonly clamp: number;
  readonly shiftY: number;
}): number {
  "worklet";
  return input.y + input.shiftY + input.clamp;
}

/**
 * Where a released cell would come to rest if it kept gliding, in points.
 *
 * `velocityX` / `velocityY` are **points per second** (`Gesture.Pan` reports them
 * that way, unlike `translationX`/`translationY`, which are points). Multiplying by
 * `projectionMs / 1000` converts that to points.
 *
 * The result is clamped into `bounds` before the caller measures it against an
 * edge. Clamping is what makes the projection mean "which edge is this heading
 * for": without it a fast flick lands tens of points outside the window and the
 * distance to the edge grows with the flick, so the harder the user flicks the less
 * likely it attaches — the same inversion `resolveDropEdge` was written to fix.
 */
export function projectReleasePoint(input: {
  readonly position: { readonly x: number; readonly y: number };
  readonly velocityX: number;
  readonly velocityY: number;
  readonly projectionMs: number;
  readonly bounds: PetRestBounds;
}): { readonly x: number; readonly y: number } {
  "worklet";
  const seconds = input.projectionMs / 1000;
  return {
    x: Math.min(
      Math.max(input.bounds.minX, input.position.x + input.velocityX * seconds),
      input.bounds.maxX,
    ),
    y: Math.min(
      Math.max(input.bounds.minY, input.position.y + input.velocityY * seconds),
      input.bounds.maxY,
    ),
  };
}

/**
 * Which edge a finished drag settles on.
 *
 * A drag that *started* on an edge is measured by how far it was pulled away, never
 * by the cell's absolute position: the peek offset is folded into the cell on grab,
 * so a side peek begins the drag tens of points outside the bounds and the drop
 * point says nothing about intent. A free drag adds the flick on top of the position
 * test, because the flick is the more recent statement of intent.
 *
 * The two cases use two different distances. A free drop attaches within
 * `threshold` (the snap distance), which the user wants short. A drag that started
 * on an edge releases only past `releaseThreshold` (the larger release distance):
 * attaching and detaching are separate intents, and measuring the pull with the
 * snap distance would drop a peek as soon as the grab shifted a few points.
 */
export function resolveSettledDropEdge(input: {
  readonly startedOn: PeekEdge | null;
  readonly translationX: number;
  readonly translationY: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly bounds: PetRestBounds;
  readonly threshold: number;
  readonly releaseThreshold: number;
  readonly projectionMs: number;
}): PeekEdge | null {
  "worklet";
  const { startedOn, translationX, translationY, position, bounds, threshold } = input;
  if (startedOn !== null) {
    return resolveDragDropEdge({
      startedOn,
      translationX,
      translationY,
      position,
      bounds,
      threshold: input.releaseThreshold,
    });
  }
  // A free drag is judged where the glide would end, not where the finger lifted:
  // a slow release projects almost onto itself (so the old distance test still
  // decides), while a fast one lands near the edge it was thrown at.
  const projected = projectReleasePoint({
    position,
    velocityX: input.velocityX,
    velocityY: input.velocityY,
    projectionMs: input.projectionMs,
    bounds,
  });
  return resolveDropEdge(projected, bounds, threshold);
}

/** Keep a bottom peek inside the input box's columns; side peeks are untouched. */
export function clampBottomPeekX(
  edge: PeekEdge | null,
  x: number,
  range: { readonly min: number; readonly max: number },
): number {
  "worklet";
  if (edge !== "bottom") return x;
  return Math.min(Math.max(range.min, x), range.max);
}

/** The resting cell for a dropped pet, including the bottom peek's column limit. */
export function snapPetToPeekEdge(
  edge: PeekEdge | null,
  position: { readonly x: number; readonly y: number },
  bounds: PetRestBounds,
  bottomPeekX: { readonly min: number; readonly max: number },
): { readonly x: number; readonly y: number } {
  "worklet";
  const snapped = snapToPeekEdge(edge, position, bounds);
  return { x: clampBottomPeekX(edge, snapped.x, bottomPeekX), y: snapped.y };
}

/** Where a *cancelled* drag leaves the cell, including the bottom peek's columns. */
export function settleCancelledPetDrag(
  position: { readonly x: number; readonly y: number },
  edge: PeekEdge | null,
  bounds: PetRestBounds,
  bottomPeekX: { readonly min: number; readonly max: number },
): { readonly x: number; readonly y: number } {
  "worklet";
  const settled = settleCancelledDrag(position, edge, bounds);
  return { x: clampBottomPeekX(edge, settled.x, bottomPeekX), y: settled.y };
}

/**
 * The scale the sprite is drawn at: the press bounce times the bottom peek's own
 * shrink.
 *
 * Only the bottom peek shrinks (`BOTTOM_PEEK_SCALE`); side peeks and a full-body
 * pet stay at 1. The shrink is driven by an eased `bottomWeight` (0 -> 1 while a
 * bottom peek settles, back to 0 on grab) rather than read off the current edge,
 * which made it a step: landing on the bottom edge jumped 1 -> 0.9 in one frame,
 * and a pet grabbed from a bottom peek stayed at 0.9 for the whole drag.
 *
 * The result is the transform's `scale` itself — a unitless factor, never a size
 * in points. `bottomScale` is passed in so this module stays free of the asset
 * table.
 */
export function resolvePetSpriteScale(input: {
  readonly pressScale: number;
  readonly bottomWeight: number;
  readonly bottomScale: number;
}): number {
  "worklet";
  const weight = Math.min(Math.max(0, input.bottomWeight), 1);
  return input.pressScale * (1 + (input.bottomScale - 1) * weight);
}

/**
 * The cell a *cancelled* drag restores to.
 *
 * A cancelled pan never reaches `onEnd`, so nothing has settled it: `onStart` has
 * already folded the peek offset into `x`/`y`, zeroed the shift and started easing
 * the peek weight to zero, and `clearPeek` has dropped the JS edge. Restoring only
 * the cell leaves the other three disagreeing — the full-body art sits on a peek's
 * cell while the shared edge still says "hanging on the ledge". So a cancelled drag
 * restores the edge it *started* on, completely: cell, shift, weight and the JS
 * mirror are all put back together by the caller.
 *
 * `startedOn` is used rather than the shared edge, because the shared value may have
 * been rewritten by `onEnd` in the same frame.
 */
export function resolveCancelledDropResting(input: {
  readonly position: { readonly x: number; readonly y: number };
  readonly startedOn: PeekEdge | null;
  readonly bounds: PetRestBounds;
  readonly bottomPeekX: { readonly min: number; readonly max: number };
}): { readonly x: number; readonly y: number } {
  "worklet";
  return settleCancelledPetDrag(input.position, input.startedOn, input.bounds, input.bottomPeekX);
}
