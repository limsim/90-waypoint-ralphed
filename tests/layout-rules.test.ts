import test from "node:test";
import assert from "node:assert/strict";
import { Point } from "../src/domain/point.js";
import { Bounds } from "../src/domain/bounds.js";
import { Segment } from "../src/domain/segment.js";
import { Waypoint } from "../src/domain/waypoint.js";
import { Turn } from "../src/domain/turn.js";
import {
  WAYPOINT_RADIUS,
  MIN_PARALLEL_SEPARATION,
  MIN_SEGMENT_WAYPOINT_CLEARANCE,
  TURN_LABEL_OFFSET,
  TURN_LABEL_CLEARANCE,
  BOUNDS_PADDING,
  noWaypointCirclesOverlap,
  noCloseParallelSegments,
  noSegmentCloseToNonAdjacentWaypoint,
  noSegmentThroughNonAdjacentWaypointCircle,
  turnLabelsClearOfNonAdjacentSegments,
  allWaypointsWithinBounds,
  checkLayout,
} from "../src/domain/layout-rules.js";

function mkWp(
  seq: number,
  total: number,
  x: number,
  y: number,
  turn: Turn | null = null,
  wildcard = false
): Waypoint {
  return Waypoint.create(seq, total, new Point(x, y), turn, wildcard);
}

function mkSeg(x1: number, y1: number, x2: number, y2: number): Segment {
  return new Segment(new Point(x1, y1), new Point(x2, y2));
}

// ---- exported constants ----

test("layout-rules: constants have expected values", () => {
  assert.equal(WAYPOINT_RADIUS, 25);
  assert.equal(MIN_PARALLEL_SEPARATION, 55);
  assert.equal(MIN_SEGMENT_WAYPOINT_CLEARANCE, 35);
  assert.equal(TURN_LABEL_OFFSET, 46);
  assert.equal(TURN_LABEL_CLEARANCE, 8);
  assert.equal(BOUNDS_PADDING, 30);
});

// ---- noWaypointCirclesOverlap ----

test("noWaypointCirclesOverlap: touching circles (d=50) pass", () => {
  assert.equal(
    noWaypointCirclesOverlap([mkWp(1, 2, 0, 0), mkWp(2, 2, 50, 0)]),
    true
  );
});

test("noWaypointCirclesOverlap: overlapping circles (d=49) fail", () => {
  assert.equal(
    noWaypointCirclesOverlap([mkWp(1, 2, 0, 0), mkWp(2, 2, 49, 0)]),
    false
  );
});

test("noWaypointCirclesOverlap: well-separated three waypoints pass", () => {
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 200, 200),
  ];
  assert.equal(noWaypointCirclesOverlap(wps), true);
});

test("noWaypointCirclesOverlap: one overlapping pair in a group fails", () => {
  // wp2 at (248,0): 48px from wp1 → circles overlap
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 248, 0),
  ];
  assert.equal(noWaypointCirclesOverlap(wps), false);
});

test("noWaypointCirclesOverlap: empty list passes", () => {
  assert.equal(noWaypointCirclesOverlap([]), true);
});

test("noWaypointCirclesOverlap: single waypoint passes", () => {
  assert.equal(noWaypointCirclesOverlap([mkWp(1, 2, 0, 0)]), true);
});

// ---- noCloseParallelSegments ----

test("noCloseParallelSegments: horizontal 55px apart pass", () => {
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(0, 55, 100, 55)]),
    true
  );
});

test("noCloseParallelSegments: horizontal 54px apart fail (boundary)", () => {
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(0, 54, 100, 54)]),
    false
  );
});

test("noCloseParallelSegments: vertical 55px apart pass", () => {
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 0, 100), mkSeg(55, 0, 55, 100)]),
    true
  );
});

test("noCloseParallelSegments: vertical 54px apart fail (boundary)", () => {
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 0, 100), mkSeg(54, 0, 54, 100)]),
    false
  );
});

test("noCloseParallelSegments: close parallel but non-overlapping ranges pass", () => {
  // y-separation=40px but x ranges do not overlap at all
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(200, 40, 300, 40)]),
    true
  );
});

test("noCloseParallelSegments: perpendicular segments always pass", () => {
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(50, -50, 50, 50)]),
    true
  );
});

test("noCloseParallelSegments: single segment list passes", () => {
  assert.equal(noCloseParallelSegments([mkSeg(0, 0, 100, 0)]), true);
});

// ---- noSegmentCloseToNonAdjacentWaypoint ----
// Adjacency: segments[i] is adjacent to waypoints[i] and waypoints[i+1].
// 3-waypoint walk: seg[0] adj to wp[0,1]; seg[1] adj to wp[1,2].
// Non-adj: seg[0] checks wp[2]; seg[1] checks wp[0].

test("noSegmentCloseToNonAdjacentWaypoint: exactly 35px clearance passes (boundary)", () => {
  // seg[0] horizontal at y=0; wp[2] at (100,35) → perpendicular distance = 35
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 100, 35),
  ];
  const segs = [mkSeg(0, 0, 200, 0), mkSeg(200, 0, 200, 200)];
  assert.equal(noSegmentCloseToNonAdjacentWaypoint(wps, segs), true);
});

test("noSegmentCloseToNonAdjacentWaypoint: 34px clearance fails (boundary)", () => {
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 100, 34),
  ];
  const segs = [mkSeg(0, 0, 200, 0), mkSeg(200, 0, 200, 200)];
  assert.equal(noSegmentCloseToNonAdjacentWaypoint(wps, segs), false);
});

test("noSegmentCloseToNonAdjacentWaypoint: adjacent waypoints are exempt", () => {
  // The two endpoints are adjacent; this should never trigger on them
  const wps = [mkWp(1, 2, 0, 0), mkWp(2, 2, 100, 0)];
  const segs = [mkSeg(0, 0, 100, 0)];
  assert.equal(noSegmentCloseToNonAdjacentWaypoint(wps, segs), true);
});

test("noSegmentCloseToNonAdjacentWaypoint: 2-waypoint walk (no non-adjacent pairs) passes", () => {
  const wps = [mkWp(1, 2, 0, 0), mkWp(2, 2, 100, 0)];
  const segs = [mkSeg(0, 0, 100, 0)];
  assert.equal(noSegmentCloseToNonAdjacentWaypoint(wps, segs), true);
});

// ---- noSegmentThroughNonAdjacentWaypointCircle ----

test("noSegmentThroughNonAdjacentWaypointCircle: exactly 25px clearance passes (boundary)", () => {
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 100, 25),
  ];
  const segs = [mkSeg(0, 0, 200, 0), mkSeg(200, 0, 200, 200)];
  assert.equal(noSegmentThroughNonAdjacentWaypointCircle(wps, segs), true);
});

test("noSegmentThroughNonAdjacentWaypointCircle: 24px clearance fails (boundary)", () => {
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 200, 0, Turn.Left),
    mkWp(3, 3, 100, 24),
  ];
  const segs = [mkSeg(0, 0, 200, 0), mkSeg(200, 0, 200, 200)];
  assert.equal(noSegmentThroughNonAdjacentWaypointCircle(wps, segs), false);
});

test("noSegmentThroughNonAdjacentWaypointCircle: 2-waypoint walk passes", () => {
  const wps = [mkWp(1, 2, 0, 0), mkWp(2, 2, 100, 0)];
  const segs = [mkSeg(0, 0, 100, 0)];
  assert.equal(noSegmentThroughNonAdjacentWaypointCircle(wps, segs), true);
});

// ---- turnLabelsClearOfNonAdjacentSegments ----
// NE label: dx = 46*cos(45°) ≈ 32.527, dy = -46*sin(45°) ≈ -32.527
// For 4-waypoint walk, wp[1] (wi=1) non-adj seg is seg[2] only.
// wp[1] at (100,200) → label at (132.527, 167.473)

test("turnLabelsClearOfNonAdjacentSegments: label >8px from non-adj segment passes", () => {
  // seg[2] horizontal at y=176; distance from label (≈167.47) = |167.47-176| ≈ 8.53 > 8
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, Turn.Left),
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),    // seg[0] adj to wp[0,1]
    mkSeg(100, 200, 200, 200),  // seg[1] adj to wp[1,2]
    mkSeg(120, 176, 150, 176),  // seg[2] adj to wp[2,3] — non-adj to wp[1]
  ];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), true);
});

test("turnLabelsClearOfNonAdjacentSegments: label <8px from non-adj segment fails", () => {
  // seg[2] horizontal at y=174; distance from label (≈167.47) = |167.47-174| ≈ 6.53 < 8
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, Turn.Left),
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),
    mkSeg(100, 200, 200, 200),
    mkSeg(120, 174, 150, 174),
  ];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), false);
});

test("turnLabelsClearOfNonAdjacentSegments: terminal waypoints have no label to check", () => {
  const wps = [mkWp(1, 2, 0, 0), mkWp(2, 2, 200, 0)];
  const segs = [mkSeg(0, 0, 200, 0)];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), true);
});

test("turnLabelsClearOfNonAdjacentSegments: 3-waypoint walk interior has no non-adj segment", () => {
  // Interior wp[1] has adjacent seg[0] and seg[1]; no third segment → trivially passes
  const wps = [
    mkWp(1, 3, 0, 0),
    mkWp(2, 3, 100, 0, Turn.Left),
    mkWp(3, 3, 100, 100),
  ];
  const segs = [mkSeg(0, 0, 100, 0), mkSeg(100, 0, 100, 100)];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), true);
});

// ---- allWaypointsWithinBounds ----

test("allWaypointsWithinBounds: exactly at padding (30px) passes", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [mkWp(1, 2, 30, 30), mkWp(2, 2, 470, 470)];
  assert.equal(allWaypointsWithinBounds(wps, bounds), true);
});

test("allWaypointsWithinBounds: 1px inside padding fails (left edge)", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [mkWp(1, 2, 29, 30), mkWp(2, 2, 470, 470)];
  assert.equal(allWaypointsWithinBounds(wps, bounds), false);
});

test("allWaypointsWithinBounds: 1px past padding (right edge) fails", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [mkWp(1, 2, 30, 30), mkWp(2, 2, 471, 30)];
  assert.equal(allWaypointsWithinBounds(wps, bounds), false);
});

test("allWaypointsWithinBounds: all waypoints well inside bounds pass", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [
    mkWp(1, 3, 100, 100),
    mkWp(2, 3, 250, 250, Turn.Left),
    mkWp(3, 3, 400, 400),
  ];
  assert.equal(allWaypointsWithinBounds(wps, bounds), true);
});

// ---- checkLayout (composite) ----

test("checkLayout: clean layout returns empty violation list", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [
    mkWp(1, 3, 100, 100),
    mkWp(2, 3, 300, 100, Turn.Left),
    mkWp(3, 3, 300, 300),
  ];
  const segs = [mkSeg(100, 100, 300, 100), mkSeg(300, 100, 300, 300)];
  assert.equal(checkLayout(wps, segs, bounds).length, 0);
});

test("checkLayout: overlapping waypoints produces waypoint-circles-overlap violation", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  // 30px apart → circles overlap (need ≥ 50)
  const wps = [mkWp(1, 2, 100, 100), mkWp(2, 2, 130, 100)];
  const segs = [mkSeg(100, 100, 130, 100)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "waypoint-circles-overlap"));
});

test("checkLayout: out-of-bounds waypoint produces waypoint-out-of-bounds violation", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [mkWp(1, 2, 5, 100), mkWp(2, 2, 300, 100)];
  const segs = [mkSeg(5, 100, 300, 100)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "waypoint-out-of-bounds"));
});

test("checkLayout: close parallel segments produces parallel-segments-too-close violation", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [mkWp(1, 2, 100, 50), mkWp(2, 2, 100, 150)];
  // Two horizontal segs 40px apart (< 55) with overlapping x range
  const segs = [mkSeg(50, 50, 200, 50), mkSeg(50, 90, 200, 90)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "parallel-segments-too-close"));
});

test("checkLayout: segment too close to non-adjacent waypoint produces violation", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  // seg[0] horizontal at y=100; wp[2] at (150, 120) → 20px clearance < 35
  const wps = [
    mkWp(1, 3, 50, 100),
    mkWp(2, 3, 300, 100, Turn.Left),
    mkWp(3, 3, 150, 120),
  ];
  const segs = [mkSeg(50, 100, 300, 100), mkSeg(300, 100, 300, 300)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "segment-too-close-to-waypoint"));
});

test("checkLayout: multiple violations reported together", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  // Overlapping circles AND out-of-bounds
  const wps = [mkWp(1, 2, 5, 5), mkWp(2, 2, 20, 5)];
  const segs = [mkSeg(5, 5, 20, 5)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "waypoint-circles-overlap"));
  assert.ok(v.some(x => x.rule === "waypoint-out-of-bounds"));
});

test("checkLayout: segment-through-waypoint-circle violation reported", () => {
  // seg[0] horizontal at y=100 x:[100,300]; wp[2] at (200,120) → 20px from seg[0] < 25 (radius)
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [
    mkWp(1, 3, 100, 100),
    mkWp(2, 3, 300, 100, Turn.Left),
    mkWp(3, 3, 200, 120),
  ];
  const segs = [mkSeg(100, 100, 300, 100), mkSeg(300, 100, 300, 300)];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "segment-through-waypoint-circle"));
});

test("checkLayout: turn-label-too-close-to-segment violation reported", () => {
  // wp[1] at (100,200): NE label ≈ (132.53, 167.47)
  // seg[2] vertical at x=140, y:[160,180]: distance = |140-132.53| ≈ 7.47 < 8 → violation
  const bounds = new Bounds(0, 0, 500, 500);
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, Turn.Left),
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),
    mkSeg(100, 200, 200, 200),
    mkSeg(140, 160, 140, 180),
  ];
  const v = checkLayout(wps, segs, bounds);
  assert.ok(v.some(x => x.rule === "turn-label-too-close-to-segment"));
});

// ---- noCloseParallelSegments: co-linear edge cases ----

test("noCloseParallelSegments: co-linear horizontal segments with range overlap fail (sep=0)", () => {
  // Both at y=0; x ranges [0,100] and [50,150] overlap → separation=0 < 55
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(50, 0, 150, 0)]),
    false
  );
});

test("noCloseParallelSegments: consecutive segments sharing only an endpoint pass (overlapLength=0)", () => {
  // Both horizontal at y=0; x ranges [0,100] and [100,200] touch at one point → overlapLength=0
  assert.equal(
    noCloseParallelSegments([mkSeg(0, 0, 100, 0), mkSeg(100, 0, 200, 0)]),
    true
  );
});

// ---- turnLabelsClearOfNonAdjacentSegments: vertical non-adj segment ----

test("turnLabelsClearOfNonAdjacentSegments: vertical non-adj segment within 8px fails", () => {
  // wp[1] at (100,200): NE label ≈ (132.53, 167.47)
  // seg[2] vertical at x=140 y:[160,180]: horiz dist = |140-132.53| ≈ 7.47 < 8 → fail
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, Turn.Left),
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),
    mkSeg(100, 200, 200, 200),
    mkSeg(140, 160, 140, 180),
  ];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), false);
});

test("turnLabelsClearOfNonAdjacentSegments: vertical non-adj segment beyond 8px passes", () => {
  // Same as above but seg[2] at x=141 → dist ≈ 8.47 > 8 → pass
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, Turn.Left),
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),
    mkSeg(100, 200, 200, 200),
    mkSeg(141, 160, 141, 180),
  ];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), true);
});

// ---- additional edge-case refinement tests ----

test("noWaypointCirclesOverlap: diagonal 3-4-5 distance exactly 50px passes", () => {
  // (0,0) to (30,40): hypot = sqrt(900+1600) = 50 → NOT < 50 → pass
  assert.equal(
    noWaypointCirclesOverlap([mkWp(1, 2, 0, 0), mkWp(2, 2, 30, 40)]),
    true
  );
});

test("noWaypointCirclesOverlap: diagonal 3-4-5 distance 49px fails", () => {
  // (0,0) to (29.4,39.2) scaled so hypot = 49 → 49 < 50 → fail
  // Use integer coords: (0,0) and (30,39) → hypot ≈ 49.24 < 50 → fail
  assert.equal(
    noWaypointCirclesOverlap([mkWp(1, 2, 0, 0), mkWp(2, 2, 30, 39)]),
    false
  );
});

test("noSegmentCloseToNonAdjacentWaypoint: 4-waypoint middle segment non-adjacent outer waypoint fails", () => {
  // L-shaped walk: wp0→(right)→wp1→(down)→wp2→(left)→wp3
  // seg[1] (horizontal at y=300) is non-adjacent to wp[0] and wp[3]
  // wp[3] at y=266: dist from seg[1] at y=300 is 34 < 35 → violation
  const wps = [
    mkWp(1, 4, 100, 100),
    mkWp(2, 4, 100, 300, Turn.Right),
    mkWp(3, 4, 300, 300, Turn.Left),
    mkWp(4, 4, 300, 266),
  ];
  const segs = [
    mkSeg(100, 100, 100, 300), // seg[0]: adj to wp[0,1]
    mkSeg(100, 300, 300, 300), // seg[1]: adj to wp[1,2], non-adj to wp[0] and wp[3]
    mkSeg(300, 300, 300, 266), // seg[2]: adj to wp[2,3]
  ];
  assert.equal(noSegmentCloseToNonAdjacentWaypoint(wps, segs), false);
});

test("allWaypointsWithinBounds: empty waypoints list passes", () => {
  // Array.every on empty array is vacuously true
  const bounds = new Bounds(0, 0, 500, 500);
  assert.equal(allWaypointsWithinBounds([], bounds), true);
});

test("turnLabelsClearOfNonAdjacentSegments: wildcard interior waypoint label still checked", () => {
  // Wildcard waypoints are interior (not terminal), so their NE label clearance is still enforced.
  // wp[1] at (100,200) is wildcard (turn=null, wildcard=true);
  // NE label ≈ (132.53, 167.47); seg[2] vertical at x=140 → dist ≈ 7.47 < 8 → fail
  const wps = [
    mkWp(1, 4, 0, 200),
    mkWp(2, 4, 100, 200, null, true), // wildcard, no turn
    mkWp(3, 4, 200, 200, Turn.Right),
    mkWp(4, 4, 300, 200),
  ];
  const segs = [
    mkSeg(0, 200, 100, 200),
    mkSeg(100, 200, 200, 200),
    mkSeg(140, 160, 140, 180),
  ];
  assert.equal(turnLabelsClearOfNonAdjacentSegments(wps, segs), false);
});

test("checkLayout: empty waypoints and segments returns no violations", () => {
  const bounds = new Bounds(0, 0, 500, 500);
  assert.equal(checkLayout([], [], bounds).length, 0);
});
