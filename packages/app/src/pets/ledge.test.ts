import { describe, expect, it } from "vitest";
import {
  foldDragOffsets,
  projectReleasePoint,
  resolveBottomPeekXRange,
  resolveKeyboardTopClamp,
  resolvePetLayerLift,
  resolvePetSpriteScale,
  resolveRestBounds,
  resolveSettledDropEdge,
  type PetLedge,
} from "./ledge";

/**
 * The ledge the pet rests on.
 *
 * The bug this file exists for: the pet took its bottom limit from the composer
 * *slot*'s measured height, which includes everything stacked above the text field
 * (the draft tab's import pill, the queue list, a send error) and the bottom safe
 * area. A bottom peek therefore hung above the pill instead of on the input box.
 * These tests pin the arithmetic to the input box's own top edge, and pin the
 * horizontal limit that keeps a peek inside a centered form's columns.
 */

const SIZE = 85;
/** The shipped `EDGE_MARGIN` from `pet-overlay`. */
const EDGE_MARGIN = 2;
const WIDTH = 390;
const HEIGHT = 844;
const TOP_INSET = 59;
const BOTTOM_INSET = 34;

/** An input box whose top edge sits 120pt above the screen bottom. */
const LEDGE: PetLedge = { topY: HEIGHT - 120, left: 16, right: WIDTH - 16 };

const BASE = {
  width: WIDTH,
  height: HEIGHT,
  size: SIZE,
  edgeMargin: EDGE_MARGIN,
  topInset: TOP_INSET,
  bottomInset: BOTTOM_INSET,
} as const;

describe("resolveRestBounds", () => {
  it("parks the cell's bottom edge on the input box's top edge", () => {
    const bounds = resolveRestBounds({ ...BASE, ledge: LEDGE });
    // maxY is the cell's top: one cell plus the margin above the ledge.
    expect(bounds.maxY).toBe(LEDGE.topY - SIZE - EDGE_MARGIN);
    expect(bounds.maxY).toBe(844 - 120 - 85 - 2);
  });

  it("falls back to the screen bottom minus the safe area without a composer", () => {
    const bounds = resolveRestBounds({ ...BASE, ledge: null });
    expect(bounds.maxY).toBe(HEIGHT - BOTTOM_INSET - SIZE - EDGE_MARGIN);
  });

  it("keeps the side margins and the top inset", () => {
    const bounds = resolveRestBounds({ ...BASE, ledge: LEDGE });
    expect(bounds.minX).toBe(EDGE_MARGIN);
    expect(bounds.maxX).toBe(WIDTH - SIZE - EDGE_MARGIN);
    expect(bounds.minY).toBe(TOP_INSET + EDGE_MARGIN);
  });

  it("never lets maxY fall below minY on a short viewport", () => {
    const bounds = resolveRestBounds({ ...BASE, height: 160, ledge: { ...LEDGE, topY: 40 } });
    expect(bounds.maxY).toBe(bounds.minY);
  });

  it("follows the ledge rather than the safe area", () => {
    // The measured box top is what decides; the safe area only matters without one.
    const withInset = resolveRestBounds({ ...BASE, bottomInset: 0, ledge: LEDGE });
    const withoutInset = resolveRestBounds({ ...BASE, bottomInset: 99, ledge: LEDGE });
    expect(withInset.maxY).toBe(withoutInset.maxY);
  });
});

describe("resolveBottomPeekXRange", () => {
  it("keeps a bottom peek inside the input box's columns", () => {
    const range = resolveBottomPeekXRange({
      ledge: LEDGE,
      size: SIZE,
      minX: EDGE_MARGIN,
      maxX: WIDTH - SIZE - EDGE_MARGIN,
    });
    // The cell may not start left of the box, nor end right of it.
    expect(range.min).toBe(LEDGE.left);
    expect(range.max).toBe(LEDGE.right - SIZE);
    expect(range.max).toBe(390 - 16 - 85);
  });

  it("does not widen the range past the screen bounds", () => {
    // A box wider than the screen must still respect the screen margins.
    const wide: PetLedge = { topY: 700, left: -40, right: WIDTH + 40 };
    const range = resolveBottomPeekXRange({
      ledge: wide,
      size: SIZE,
      minX: EDGE_MARGIN,
      maxX: WIDTH - SIZE - EDGE_MARGIN,
    });
    expect(range.min).toBe(EDGE_MARGIN);
    expect(range.max).toBe(WIDTH - SIZE - EDGE_MARGIN);
  });

  it("centres the cell when the box is narrower than the standee", () => {
    const narrow: PetLedge = { topY: 700, left: 100, right: 140 };
    const range = resolveBottomPeekXRange({
      ledge: narrow,
      size: SIZE,
      minX: EDGE_MARGIN,
      maxX: WIDTH - SIZE - EDGE_MARGIN,
    });
    // One legal x: the cell centred on the 40pt box.
    expect(range.min).toBe(100 + 20 - SIZE / 2);
    expect(range.max).toBe(range.min);
  });

  it("falls back to the screen bounds without a ledge", () => {
    const range = resolveBottomPeekXRange({
      ledge: null,
      size: SIZE,
      minX: EDGE_MARGIN,
      maxX: WIDTH - SIZE - EDGE_MARGIN,
    });
    expect(range).toEqual({ min: EDGE_MARGIN, max: WIDTH - SIZE - EDGE_MARGIN });
  });
});

describe("resolveKeyboardTopClamp", () => {
  const base = { topInset: TOP_INSET, edgeMargin: EDGE_MARGIN };

  it("is zero while the keyboard is closed", () => {
    expect(resolveKeyboardTopClamp({ ...base, y: 200, lift: 0 })).toBe(0);
  });

  it("pushes the cell down by exactly the overhang", () => {
    // y = 100, lift = 300 -> rendered top -200, floor is 61 -> clamp 261.
    expect(resolveKeyboardTopClamp({ ...base, y: 100, lift: 300 })).toBe(261);
  });

  it("leaves a cell that still clears the top inset alone", () => {
    // rendered top 300 - 200 = 100, floor 61: no clamp.
    expect(resolveKeyboardTopClamp({ ...base, y: 300, lift: 200 })).toBe(0);
  });

  it("returns to zero when the keyboard closes again", () => {
    const lifted = resolveKeyboardTopClamp({ ...base, y: 100, lift: 300 });
    const closed = resolveKeyboardTopClamp({ ...base, y: 100, lift: 0 });
    expect(lifted).toBeGreaterThan(0);
    expect(closed).toBe(0);
  });

  it("is monotonic in the lift", () => {
    const small = resolveKeyboardTopClamp({ ...base, y: 200, lift: 200 });
    const large = resolveKeyboardTopClamp({ ...base, y: 200, lift: 400 });
    expect(large).toBeGreaterThan(small);
  });
});

describe("resolveSettledDropEdge", () => {
  // A 390x844 phone with a ledge 120pt above the bottom: the cell is 85pt and the
  // edge margin is 2pt, so the travel is x 2..303 and y 61..637.
  const bounds = { minX: 2, maxX: 303, minY: 61, maxY: 637 };
  const PROJECTION_MS = 60;
  const base = {
    translationX: 0,
    translationY: 0,
    velocityX: 0,
    velocityY: 0,
    bounds,
    threshold: 6,
    releaseThreshold: 12,
    projectionMs: PROJECTION_MS,
  } as const;

  it("attaches a slow free drop inside the snap distance", () => {
    // 5pt from the bottom edge, inside the 6pt attach distance, stationary.
    expect(resolveSettledDropEdge({ ...base, startedOn: null, position: { x: 100, y: 632 } })).toBe(
      "bottom",
    );
  });

  it("stays free beyond the snap distance with no velocity", () => {
    expect(
      resolveSettledDropEdge({ ...base, startedOn: null, position: { x: 150, y: 400 } }),
    ).toBeNull();
  });

  it("does not attach on residual slow velocity in the middle of the screen", () => {
    // R1: 30 pt/s of leftover finger motion projects only ~1.8pt, so the pet must
    // stay where it was released instead of flying to an edge.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 400 },
        velocityX: 30,
        velocityY: 30,
      }),
    ).toBeNull();
  });

  it("does not attach on a medium sideways throw away from any edge", () => {
    // R1: 200 pt/s over 60ms is 12pt of glide, still nowhere near an edge.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 400 },
        velocityX: 200,
      }),
    ).toBeNull();
  });

  it("attaches on a fast downward flick near the bottom", () => {
    // 69pt above the bottom edge. 1200 pt/s over 60ms is 72pt of glide, which
    // clamps onto maxY; 800 pt/s (48pt) deliberately stops short — the
    // projection is a real distance, not "any downward velocity attaches".
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 560 },
        velocityY: 800,
      }),
    ).toBeNull();
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 560 },
        velocityY: 1200,
      }),
    ).toBe("bottom");
  });

  it("does not attach on a flick pointing away from the edge", () => {
    // Upwards, away from the bottom edge: the projection moves to minY, which is
    // not within the threshold of the bottom.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 400 },
        velocityY: -2500,
      }),
    ).toBeNull();
  });

  it("picks the horizontal edge from a sideways flick", () => {
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 400 },
        velocityX: -2500,
      }),
    ).toBe("left");
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: null,
        position: { x: 150, y: 400 },
        velocityX: 2500,
      }),
    ).toBe("right");
  });

  it("keeps a peek on its own edge until it is pulled past the threshold", () => {
    // Started on the left edge, pulled 5pt away: still attached, velocity ignored.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: "left",
        translationX: 5,
        velocityX: -900,
        position: { x: -20, y: 400 },
      }),
    ).toBe("left");
  });

  it("releases a peek once it is pulled past the threshold", () => {
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: "left",
        translationX: 20,
        position: { x: -20, y: 400 },
      }),
    ).toBeNull();
  });

  it("measures a bottom peek by how far it was pulled up", () => {
    // Pulling up is a negative translationY; the threshold is how far away it got.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: "bottom",
        translationY: -20,
        position: { x: 150, y: 700 },
      }),
    ).toBeNull();
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: "bottom",
        translationY: -4,
        position: { x: 150, y: 700 },
      }),
    ).toBe("bottom");
  });

  it("keeps a peek attached across a pull longer than the attach distance", () => {
    // The two distances are independent: an 8pt pull is past the 6pt attach
    // distance, so a *free* drop there would stay full-body, but a drag that
    // started on the edge needs to clear the 12pt release distance to come off.
    expect(
      resolveSettledDropEdge({
        ...base,
        startedOn: "left",
        translationX: 8,
        position: { x: -20, y: 400 },
      }),
    ).toBe("left");
  });

  it("does not attach a free drop outside the attach distance but inside the release distance", () => {
    // The other direction of the same split: 8pt from the right edge is beyond
    // the 6pt attach distance, so the pet stays full-body even though it is well
    // inside the 12pt a peek would need to be pulled to come off.
    expect(
      resolveSettledDropEdge({ ...base, startedOn: null, position: { x: 295, y: 400 } }),
    ).toBeNull();
    // 4pt away is inside the attach distance.
    expect(resolveSettledDropEdge({ ...base, startedOn: null, position: { x: 299, y: 400 } })).toBe(
      "right",
    );
  });
});

describe("projectReleasePoint", () => {
  // Arbitrary travel rectangle: these cases only exercise the velocity -> points
  // conversion and the clamping, so the numbers are not the shipped margins.
  const bounds = { minX: 10, maxX: 295, minY: 69, maxY: 629 };

  it("converts points per second into points of glide", () => {
    // 1000 pt/s for 200ms is 200pt, clamped into the bounds.
    const projected = projectReleasePoint({
      position: { x: 100, y: 300 },
      velocityX: 1000,
      velocityY: 0,
      projectionMs: 200,
      bounds,
    });
    expect(projected.x).toBe(295);
    expect(projected.y).toBe(300);
  });

  it("projects a slow release almost onto itself", () => {
    const projected = projectReleasePoint({
      position: { x: 150, y: 400 },
      velocityX: 30,
      velocityY: 30,
      projectionMs: 140,
      bounds,
    });
    // 30 pt/s * 0.14s = 4.2pt.
    expect(projected.x).toBeCloseTo(154.2, 5);
    expect(projected.y).toBeCloseTo(404.2, 5);
  });

  it("clamps so a hard flick still lands on the edge it aimed at", () => {
    const projected = projectReleasePoint({
      position: { x: 150, y: 400 },
      velocityX: 0,
      velocityY: 9000,
      projectionMs: 140,
      bounds,
    });
    expect(projected.y).toBe(bounds.maxY);
  });
});

describe("resolvePetLayerLift", () => {
  it("is zero when the pet layer is not translated", () => {
    // No composer claimed the ledge: the layer does not move, so it must not clamp.
    expect(resolvePetLayerLift({ shift: 300, enabled: false, bottomClearance: 0 })).toBe(0);
  });

  it("subtracts the dock's clearance like the composer does", () => {
    expect(resolvePetLayerLift({ shift: 300, enabled: true, bottomClearance: 40 })).toBe(260);
  });

  it("never goes negative", () => {
    expect(resolvePetLayerLift({ shift: 20, enabled: true, bottomClearance: 40 })).toBe(0);
  });
});

describe("foldDragOffsets", () => {
  it("folds the clamp and the peek shift into the resting y", () => {
    // A pet held 257pt down by the clamp, hanging 12.5pt off the bottom edge.
    expect(foldDragOffsets({ y: 400, clamp: 257, shiftY: 12.5 })).toBe(669.5);
  });

  it("is the identity when nothing is offset", () => {
    expect(foldDragOffsets({ y: 400, clamp: 0, shiftY: 0 })).toBe(400);
  });
});

describe("resolvePetSpriteScale", () => {
  // The transform's `scale` is a unitless factor. Dividing it by the standee size
  // once drew the pet at ~1% of its size.
  it("draws a resting full-body pet at its own size", () => {
    expect(resolvePetSpriteScale({ pressScale: 1, bottomWeight: 0, bottomScale: 0.9 })).toBe(1);
  });

  it("settles a bottom peek at the bottom scale", () => {
    expect(resolvePetSpriteScale({ pressScale: 1, bottomWeight: 1, bottomScale: 0.9 })).toBe(0.9);
  });

  it("eases between the two while the weight settles", () => {
    expect(
      resolvePetSpriteScale({ pressScale: 1, bottomWeight: 0.5, bottomScale: 0.9 }),
    ).toBeCloseTo(0.95, 10);
  });

  it("multiplies the press bounce in", () => {
    expect(
      resolvePetSpriteScale({ pressScale: 1.08, bottomWeight: 0, bottomScale: 0.9 }),
    ).toBeCloseTo(1.08, 10);
  });

  it("clamps a weight that overshoots", () => {
    expect(resolvePetSpriteScale({ pressScale: 1, bottomWeight: 1.2, bottomScale: 0.9 })).toBe(0.9);
  });
});
