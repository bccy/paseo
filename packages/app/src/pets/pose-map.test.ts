import { describe, expect, it } from "vitest";
import {
  PEEK_ANCHORS,
  PEEK_POSES,
  PEEK_RELEASE_RATIO,
  PEEK_SNAP_RATIO,
  POSE_ASSETS,
  clampToBounds,
  isPeekEdge,
  parseStoredPosition,
  BOTTOM_PEEK_SCALE,
  peekCellSize,
  peekReleaseThreshold,
  peekShift,
  peekSnapThreshold,
  resolveDragDropEdge,
  resolveDropEdge,
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
/** The shipped `EDGE_MARGIN` from `pet-overlay`, which the shifts are measured against. */
const EDGE_MARGIN = 2;
/**
 * The snap (attach) distance in points, spelled out rather than derived:
 * `SIZE * ratio` would let a changed ratio keep its own test green.
 *
 * 6pt is the value the device feedback settled on — 12pt still grabbed the pet
 * while the artwork was visibly clear of the edge.
 */
const THRESHOLD_PT = 6;
/**
 * The release distance in points, likewise spelled out. Deliberately larger than
 * the attach distance: a peek must be pulled further to come off than a free drop
 * needs to be to attach.
 */
const RELEASE_PT = 12;

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
    // The bottom peek is drawn smaller than the cell (BOTTOM_PEEK_SCALE), and a
    // centred scale lifts the crop line, so the shift carries that back down.
    // Written out from measured numbers rather than from the helper it tests.
    const compensation = (1 - BOTTOM_PEEK_SCALE) * (MEASURED.bottom.y - 0.5) * SIZE;
    expect(shift.y).toBeCloseTo(SIZE * (1 - MEASURED.bottom.y) + EDGE_MARGIN + compensation, 6);
    expect(shift.y).toBeGreaterThan(0);
    expect(shift.x).toBe(0);
  });

  it("keeps the scaled bottom crop line on the cell's unscaled anchor", () => {
    // Independent geometry check: where the crop line lands inside the cell after
    // scaling + compensation must equal where it lands with no scaling at all.
    const scaled = SIZE * BOTTOM_PEEK_SCALE;
    const drawnTopInsideCell = (SIZE - scaled) / 2;
    const cropLineBeforeShift = drawnTopInsideCell + MEASURED.bottom.y * scaled;
    const shift = peekShift("bottom", SIZE, EDGE_MARGIN);
    const cropLineAfterShift = cropLineBeforeShift + shift.y;
    // With no scaling the crop line sits at `anchor * SIZE` inside the cell, and
    // the shift moves it to `SIZE + EDGE_MARGIN` from the cell's top. Scaling plus
    // compensation has to land on that same absolute place.
    expect(cropLineAfterShift).toBeCloseTo(SIZE + EDGE_MARGIN, 6);
  });

  it("leaves the side peeks unscaled", () => {
    // Only the bottom peek shrinks; the sides are narrow slivers already.
    expect(peekCellSize("left", SIZE)).toBe(SIZE);
    expect(peekCellSize("right", SIZE)).toBe(SIZE);
    expect(peekCellSize(null, SIZE)).toBe(SIZE);
    expect(peekCellSize("bottom", SIZE)).toBeCloseTo(SIZE * BOTTOM_PEEK_SCALE, 6);
    expect(peekShift("left", SIZE, EDGE_MARGIN).y).toBe(0);
    expect(peekShift("right", SIZE, EDGE_MARGIN).y).toBe(0);
  });

  it("scales with the standee size", () => {
    const small = peekShift("bottom", 76, EDGE_MARGIN);
    const large = peekShift("bottom", 152, EDGE_MARGIN);
    // The anchor is proportional, so doubling the size must move the crop line
    // by the anchor's own share of the extra height.
    expect(large.y - EDGE_MARGIN).toBeCloseTo(2 * (small.y - EDGE_MARGIN), 6);
  });
});

describe("peekShift literals match PEEK_ANCHORS", () => {
  // `peekShift` spells the anchors out as literals because it runs on the UI
  // thread and must not capture the module object. That copy can drift, so pin
  // it: every edge's shift has to equal what the table says.
  const EDGES: readonly PeekEdge[] = ["left", "right", "bottom"];

  it("derives the same shift as the anchor table", () => {
    for (const edge of EDGES) {
      const anchor = PEEK_ANCHORS[edge];
      const shift = peekShift(edge, SIZE, EDGE_MARGIN);
      if (edge === "left") {
        expect(shift.x).toBeCloseTo(-anchor.x * SIZE - EDGE_MARGIN, 6);
      } else if (edge === "right") {
        expect(shift.x).toBeCloseTo(SIZE * (1 - anchor.x) + EDGE_MARGIN, 6);
      } else {
        const scale = BOTTOM_PEEK_SCALE;
        const compensation = (1 - scale) * (anchor.y - 0.5) * SIZE;
        expect(shift.y).toBeCloseTo(SIZE * (1 - anchor.y) + EDGE_MARGIN + compensation, 6);
      }
    }
  });
});

describe("snapToPeekEdge", () => {
  // Arbitrary travel rectangle. The assertions here are about which coordinate is
  // moved, not about the shipped margins.
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

describe("resolveDropEdge", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };
  const threshold = THRESHOLD_PT;

  // A drag tracks the finger without clamping, so aiming at an edge overshoots
  // it. Feeding the raw point to the distance test made the snap *less* likely
  // the harder the user flicked — the harder they aimed, the more it overshot.
  it("snaps when the drop overshoots the edge", () => {
    expect(resolveDropEdge({ x: bounds.minX - 40, y: 400 }, bounds, threshold)).toBe("left");
    expect(resolveDropEdge({ x: bounds.maxX + 40, y: 400 }, bounds, threshold)).toBe("right");
    expect(resolveDropEdge({ x: 150, y: bounds.maxY + 40 }, bounds, threshold)).toBe("bottom");
  });

  it("still snaps exactly on the edge and inside the zone", () => {
    expect(resolveDropEdge({ x: bounds.minX, y: 400 }, bounds, threshold)).toBe("left");
    expect(resolveDropEdge({ x: bounds.minX + 5, y: 400 }, bounds, threshold)).toBe("left");
  });

  it("stays free when the drop is past the zone and inside the screen", () => {
    expect(resolveDropEdge({ x: 150, y: 400 }, bounds, threshold)).toBeNull();
    expect(
      resolveDropEdge({ x: bounds.minX + threshold + 1, y: 400 }, bounds, threshold),
    ).toBeNull();
  });

  it("keeps the bottom priority when a corner overshoots", () => {
    expect(resolveDropEdge({ x: bounds.minX - 40, y: bounds.maxY + 40 }, bounds, threshold)).toBe(
      "bottom",
    );
  });
});

describe("resolveDragDropEdge", () => {
  const bounds = { minX: 10, maxX: 304, minY: 57, maxY: 694 };
  const threshold = THRESHOLD_PT;
  const base = { translationX: 0, translationY: 0, bounds, threshold };

  it("judges a drag that started free by its drop point", () => {
    expect(resolveDragDropEdge({ ...base, startedOn: null, position: { x: -40, y: 400 } })).toBe(
      "left",
    );
    expect(
      resolveDragDropEdge({ ...base, startedOn: null, position: { x: 150, y: 400 } }),
    ).toBeNull();
  });

  it("releases an edge once the pull clears the threshold", () => {
    // Away from a left edge is +x.
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "left",
        translationX: threshold,
        position: { x: -20.75, y: 400 },
      }),
    ).toBeNull();
    // Away from a right edge is -x, so a positive drag is *towards* it.
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "right",
        translationX: -threshold,
        position: { x: 340, y: 400 },
      }),
    ).toBeNull();
    // Away from the bottom is -y.
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "bottom",
        translationY: -threshold,
        position: { x: 150, y: 760 },
      }),
    ).toBeNull();
  });

  it("returns to the same edge when the pull is short", () => {
    // Just under the threshold, and a pull in the wrong direction, both keep her.
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "left",
        translationX: threshold - 1,
        position: { x: -20.75, y: 400 },
      }),
    ).toBe("left");
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "left",
        translationX: -threshold,
        position: { x: -40, y: 400 },
      }),
    ).toBe("left");
  });

  it("does not consult the drop point when the drag started on an edge", () => {
    // The folded offset puts the cell far outside the bounds; reading that as a
    // position is exactly the bug that made her jump to another edge.
    expect(
      resolveDragDropEdge({
        ...base,
        startedOn: "left",
        translationX: 0,
        position: { x: 150, y: 400 },
      }),
    ).toBe("left");
  });
});

describe("peekSnapThreshold", () => {
  it("is the shipped 6pt at the shipped size", () => {
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

describe("peekReleaseThreshold", () => {
  it("is the shipped 12pt at the shipped size", () => {
    // Deliberately twice the attach distance, and pinned the same way.
    expect(peekReleaseThreshold(SIZE)).toBeCloseTo(RELEASE_PT, 6);
  });

  it("tracks the standee size", () => {
    expect(peekReleaseThreshold(SIZE * 2)).toBeCloseTo(RELEASE_PT * 2, 6);
  });

  it("keeps the ratio the threshold is built from", () => {
    expect(PEEK_RELEASE_RATIO * SIZE).toBeCloseTo(RELEASE_PT, 6);
  });

  it("is larger than the attach distance", () => {
    // The split is the point: a peek must be pulled further to come off than a
    // free drop needs to be to attach, or a nudge would tear it off the wall.
    expect(peekReleaseThreshold(SIZE)).toBeGreaterThan(peekSnapThreshold(SIZE));
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
