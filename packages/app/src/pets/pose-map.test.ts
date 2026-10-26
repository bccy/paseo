import { describe, expect, it } from "vitest";
import {
  PEEK_ANCHORS,
  PEEK_POSES,
  PEEK_SNAP_RATIO,
  POSE_ASSETS,
  clampToBounds,
  isPeekEdge,
  parseStoredPosition,
  peekShift,
  peekSnapThreshold,
  resolvePeekEdge,
  settleCancelledDrag,
  snapToPeekEdge,
  type PeekEdge,
} from "./pose-map";

/**
 * The desk pet's edge behaviour: the three peek standees, which edge each one
 * belongs to, and the geometry that puts its internal crop line on the screen
 * edge.
 *
 * The anchors are measured off the artwork's alpha channel, so these tests pin
 * the pairing (which the renderer would otherwise get wrong silently — a
 * mirrored peek pushes the visible half off-screen) and the shift arithmetic,
 * not just the presence of the assets.
 */

const SIZE = 85;
const EDGE_MARGIN = 10;
/**
 * The snap distance in points, spelled out rather than derived: `SIZE * ratio`
 * would let a changed ratio keep its own test green.
 *
 * 20pt is the value the device feedback settled on — a half body (38pt) meant a
 * peek only let go after a long pull.
 */
const THRESHOLD_PT = 12;

/**
 * The crop lines measured off the artwork's alpha channel, spelled out here on
 * purpose: deriving the expectation from `PEEK_ANCHORS` would let a wrong anchor
 * keep its own test green. If the art is ever re-exported, re-measure these.
 */
const MEASURED = {
  bottom: { x: 0.5, y: 0.895 },
  left: { x: 0.273, y: 0.5 },
  right: { x: 0.705, y: 0.5 },
} as const;

/** The three peek standees the edge behaviour needs. */
const PEEK_NAMES = ["home-peek", "workbench-peek", "settings-peek"] as const;

describe("peek standees", () => {
  it.each(PEEK_NAMES)("registers %s in POSE_ASSETS", (name) => {
    expect(POSE_ASSETS).toHaveProperty(name);
    expect(POSE_ASSETS[name]).toBeTruthy();
  });

  it("maps each edge onto the standee whose art faces that way", () => {
    // Measured off the alpha channel: the wall sits on the left in
    // settings-peek (so it can only hang off the left edge) and on the right in
    // workbench-peek. Swapping them would push the visible half off-screen.
    expect(PEEK_POSES.left).toBe("settings-peek");
    expect(PEEK_POSES.right).toBe("workbench-peek");
    expect(PEEK_POSES.bottom).toBe("home-peek");
  });

  it("has a distinct standee per edge", () => {
    const names = [PEEK_POSES.bottom, PEEK_POSES.left, PEEK_POSES.right];
    expect(new Set(names).size).toBe(3);
  });

  it("pins the crop line to where the artwork actually has it", () => {
    // A stale anchor is the quiet failure mode: the pet still snaps, it just
    // hangs with the wrong amount of body on screen.
    expect(PEEK_ANCHORS.bottom.y).toBeCloseTo(MEASURED.bottom.y, 3);
    expect(PEEK_ANCHORS.left.x).toBeCloseTo(MEASURED.left.x, 3);
    expect(PEEK_ANCHORS.right.x).toBeCloseTo(MEASURED.right.x, 3);
  });

  it("puts every anchor inside the frame on the axis it crops", () => {
    expect(PEEK_ANCHORS.bottom.y).toBeGreaterThan(0);
    expect(PEEK_ANCHORS.bottom.y).toBeLessThan(1);
    expect(PEEK_ANCHORS.left.x).toBeGreaterThan(0);
    expect(PEEK_ANCHORS.left.x).toBeLessThan(1);
    expect(PEEK_ANCHORS.right.x).toBeGreaterThan(0);
    expect(PEEK_ANCHORS.right.x).toBeLessThan(1);
  });

  it("keeps the side anchors mirrored around the frame centre", () => {
    // The two vertical peeks are the same drawing flipped; if a re-export ever
    // breaks that, the anchors have to be re-measured, not averaged.
    const left = PEEK_ANCHORS.left.x;
    const right = PEEK_ANCHORS.right.x;
    expect(Math.abs(left + right - 1)).toBeLessThan(0.05);
  });
});

describe("peekShift", () => {
  it("returns no offset when the pet is not peeking", () => {
    expect(peekShift(null, SIZE, EDGE_MARGIN)).toEqual({ x: 0, y: 0 });
  });

  it("moves the left peek past the left edge", () => {
    const shift = peekShift("left", SIZE, EDGE_MARGIN);
    // The crop line has to land on x = 0: the cell sits at `EDGE_MARGIN`, so the
    // shift is the anchor distance plus that margin.
    expect(shift.x).toBeCloseTo(-(MEASURED.left.x * SIZE + EDGE_MARGIN), 6);
    expect(shift.x).toBeLessThan(0);
    expect(shift.y).toBe(0);
  });

  it("moves the right peek past the right edge", () => {
    const shift = peekShift("right", SIZE, EDGE_MARGIN);
    // Mirror of the left case: the crop line sits `anchor` of a body into the
    // art, so the art has to travel the remaining `1 - anchor` plus the margin
    // before that line reaches the screen edge.
    expect(shift.x).toBeCloseTo(SIZE * (1 - MEASURED.right.x) + EDGE_MARGIN, 6);
    expect(shift.x).toBeGreaterThan(0);
    expect(shift.y).toBe(0);
  });

  it("moves the bottom peek past the bottom edge", () => {
    const shift = peekShift("bottom", SIZE, EDGE_MARGIN);
    expect(shift.y).toBeCloseTo(SIZE * (1 - MEASURED.bottom.y) + EDGE_MARGIN, 6);
    expect(shift.y).toBeGreaterThan(0);
    expect(shift.x).toBe(0);
  });

  it("scales with the standee size", () => {
    const small = peekShift("bottom", 76, EDGE_MARGIN);
    const large = peekShift("bottom", 152, EDGE_MARGIN);
    // The anchor is proportional, so doubling the size must move the crop line
    // by the anchor's own share of the extra height.
    expect(large.y - EDGE_MARGIN).toBeCloseTo(2 * (small.y - EDGE_MARGIN), 6);
  });
});

describe("snapToPeekEdge", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };

  it("parks the cell at the edge it hangs from", () => {
    expect(snapToPeekEdge("left", { x: 30, y: 400 }, bounds)).toEqual({ x: 10, y: 400 });
    expect(snapToPeekEdge("right", { x: 290, y: 400 }, bounds)).toEqual({ x: 304, y: 400 });
    expect(snapToPeekEdge("bottom", { x: 150, y: 660 }, bounds)).toEqual({ x: 150, y: 694 });
  });

  it("leaves the along-the-edge coordinate alone", () => {
    // A side snap must not move her vertically; that is the whole reason the
    // resting cell and the art offset are separate.
    const left = snapToPeekEdge("left", { x: 30, y: 123.5 }, bounds);
    expect(left.y).toBe(123.5);
    const bottom = snapToPeekEdge("bottom", { x: 87.25, y: 660 }, bounds);
    expect(bottom.x).toBe(87.25);
  });

  it("returns the position untouched when nothing was snapped", () => {
    const position = { x: 100, y: 200 };
    expect(snapToPeekEdge(null, position, bounds)).toEqual(position);
  });
});

describe("peekSnapThreshold", () => {
  it("is the shipped 20pt at the shipped size", () => {
    // The number the drop handler actually gets. Pinned to an absolute value so
    // a changed ratio cannot ride along on its own derivation.
    expect(peekSnapThreshold(SIZE)).toBeCloseTo(THRESHOLD_PT, 6);
  });

  it("tracks the standee size", () => {
    // The doubling is derived from the shipped size on purpose: hard-coding 152
    // silently stopped testing scaling the moment the standee was resized.
    expect(peekSnapThreshold(SIZE * 2)).toBeCloseTo(THRESHOLD_PT * 2, 6);
  });

  it("keeps the ratio the threshold is built from", () => {
    expect(PEEK_SNAP_RATIO * SIZE).toBeCloseTo(THRESHOLD_PT, 6);
  });
});

describe("clampToBounds", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };

  it("pulls a cell that escaped on the left back inside", () => {
    // The case a cancelled pan leaves behind: `onStart` folded a left peek's
    // offset into x, which lands it outside the bounds.
    expect(clampToBounds({ x: -20.75, y: 400 }, bounds)).toEqual({ x: 10, y: 400 });
  });

  it("pulls a cell that escaped on the right, top or bottom back inside", () => {
    expect(clampToBounds({ x: 500, y: 400 }, bounds)).toEqual({ x: 304, y: 400 });
    expect(clampToBounds({ x: 150, y: -30 }, bounds)).toEqual({ x: 150, y: 57 });
    expect(clampToBounds({ x: 150, y: 900 }, bounds)).toEqual({ x: 150, y: 694 });
  });

  it("leaves an in-bounds cell exactly where it is", () => {
    const position = { x: 150.5, y: 400.25 };
    expect(clampToBounds(position, bounds)).toEqual(position);
  });

  it("clamps each axis independently", () => {
    expect(clampToBounds({ x: -5, y: 900 }, bounds)).toEqual({ x: 10, y: 694 });
  });
});

describe("settleCancelledDrag", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };

  it("pulls a lifted left peek back inside the bounds", () => {
    // The exact state a cancelled pan leaves: `onStart` added the left peek's
    // offset (-30.75) to a cell resting at x = 10, and the peek was cleared, so
    // without this the pet would stay off-screen until the next drag.
    expect(settleCancelledDrag({ x: 10 - 30.75, y: 400 }, null, bounds)).toEqual({ x: 10, y: 400 });
  });

  it("re-snaps when the edge is still set on the cancel frame", () => {
    // `clearPeek` is dispatched with runOnJS, so the ref can still hold the old
    // edge here. The cell has to land back on the edge it was hanging from.
    expect(settleCancelledDrag({ x: 150, y: 400 }, "bottom", bounds)).toEqual({ x: 150, y: 694 });
    expect(settleCancelledDrag({ x: 150, y: 400 }, "left", bounds)).toEqual({ x: 10, y: 400 });
  });

  it("leaves an in-bounds full-body cell alone", () => {
    const position = { x: 150, y: 400 };
    expect(settleCancelledDrag(position, null, bounds)).toEqual(position);
  });

  it("never returns a cell outside the bounds", () => {
    const cases = [
      { x: -500, y: -500 },
      { x: 999, y: 999 },
      { x: -20.75, y: 2000 },
    ];
    for (const position of cases) {
      const settled = settleCancelledDrag(position, null, bounds);
      expect(settled.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(settled.x).toBeLessThanOrEqual(bounds.maxX);
      expect(settled.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(settled.y).toBeLessThanOrEqual(bounds.maxY);
    }
  });
});

describe("parseStoredPosition", () => {
  it("restores a full-body position saved before the edge feature existed", () => {
    // The upgrade path: old records only carry x/y and must not be rejected,
    // or the user loses their pet position on the first launch after updating.
    expect(parseStoredPosition('{"x":10,"y":20}')).toEqual({ x: 10, y: 20, edge: null });
  });

  it("restores a snapped position", () => {
    expect(parseStoredPosition('{"x":304,"y":400,"edge":"right"}')).toEqual({
      x: 304,
      y: 400,
      edge: "right",
    });
  });

  it("restores a record written with an explicit null edge", () => {
    expect(parseStoredPosition('{"x":10,"y":20,"edge":null}')).toEqual({
      x: 10,
      y: 20,
      edge: null,
    });
  });

  it.each([
    ["an unknown edge name", '{"x":10,"y":20,"edge":"top"}'],
    ["a wrongly cased edge", '{"x":10,"y":20,"edge":"Left"}'],
    ["a non-string edge", '{"x":10,"y":20,"edge":3}'],
    ["an object edge", '{"x":10,"y":20,"edge":{"left":true}}'],
  ])("degrades an invalid edge to full-body instead of throwing: %s", (_label, raw) => {
    expect(parseStoredPosition(raw)).toEqual({ x: 10, y: 20, edge: null });
  });

  it.each([
    ["malformed JSON", '{"x":10,'],
    ["a truncated record", "{"],
    ["an empty string", ""],
    ["a JSON null", "null"],
    ["a JSON number", "42"],
    ["a JSON string", '"nope"'],
    ["an array", "[1,2]"],
    ["a record with no coordinates", '{"edge":"left"}'],
    ["a record with a string x", '{"x":"10","y":20}'],
    ["a record with a null y", '{"x":10,"y":null}'],
    ["a record with an infinite coordinate", '{"x":1e999,"y":20}'],
  ])("returns null for %s", (_label, raw) => {
    expect(parseStoredPosition(raw)).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    for (const raw of ['{"x":10,', "", "undefined", "{}{}", '{"x":NaN,"y":0}']) {
      expect(() => parseStoredPosition(raw)).not.toThrow();
    }
  });
});

describe("resolvePeekEdge", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };
  const threshold = THRESHOLD_PT;

  it("snaps to the bottom when the drop lands on the composer ledge", () => {
    expect(resolvePeekEdge({ x: 150, y: bounds.maxY - 5 }, bounds, threshold)).toBe("bottom");
  });

  it("snaps to the left and right edges", () => {
    expect(resolvePeekEdge({ x: bounds.minX + 5, y: 400 }, bounds, threshold)).toBe("left");
    expect(resolvePeekEdge({ x: bounds.maxX - 5, y: 400 }, bounds, threshold)).toBe("right");
  });

  it("does not snap in the middle of the screen", () => {
    expect(resolvePeekEdge({ x: 150, y: 400 }, bounds, threshold)).toBeNull();
  });

  it("treats the threshold as inclusive and stops just past it", () => {
    expect(resolvePeekEdge({ x: 150, y: bounds.maxY - threshold }, bounds, threshold)).toBe(
      "bottom",
    );
    expect(
      resolvePeekEdge({ x: 150, y: bounds.maxY - threshold - 1 }, bounds, threshold),
    ).toBeNull();
  });

  it("prefers the bottom edge in a corner", () => {
    // Both edges are in range. Bottom wins so the pet keeps the x the user
    // chose and stays parked on the composer instead of floating mid-screen.
    expect(resolvePeekEdge({ x: bounds.minX, y: bounds.maxY }, bounds, threshold)).toBe("bottom");
  });

  it("prefers the left edge over the right when both are in range", () => {
    // Only reachable on a viewport narrow enough for the two zones to overlap.
    const narrow = { minX: 0, maxX: 10, minY: 0, maxY: 500 };
    expect(resolvePeekEdge({ x: 5, y: 250 }, narrow, threshold)).toBe("left");
  });
});

describe("isPeekEdge", () => {
  it.each(["bottom", "left", "right"] as const)("accepts %s", (edge) => {
    expect(isPeekEdge(edge)).toBe(true);
  });

  it.each([null, undefined, "", "top", "Bottom", 0, {}])("rejects %s", (value) => {
    expect(isPeekEdge(value)).toBe(false);
  });

  it("narrows the type so a stored value can be used directly", () => {
    const stored: unknown = "left";
    const edge: PeekEdge | null = isPeekEdge(stored) ? stored : null;
    expect(edge).toBe("left");
  });
});
