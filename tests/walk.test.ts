import test from "node:test";
import assert from "node:assert/strict";
import { Walk } from "../src/domain/walk.js";
import { Waypoint } from "../src/domain/waypoint.js";
import { Point } from "../src/domain/point.js";
import { Bounds } from "../src/domain/bounds.js";
import { Turn } from "../src/domain/turn.js";

/**
 * Build an ordered list of waypoints from [x, y] positions. Sequence numbers are 1..N and
 * totalWaypoints === N for every waypoint, so the result is structurally well-formed; terminal
 * waypoints get no turn, interior ones get a null turn (allowed) unless overridden. Positions are
 * what the layout-rules act on, so each fixture below controls geometry via these coordinates.
 */
function walkFrom(positions: Array<[number, number]>): Waypoint[] {
  const n = positions.length;
  return positions.map(([x, y], i) =>
    Waypoint.create(i + 1, n, new Point(x, y), null, false)
  );
}

// A generous region used by the layout-valid fixtures (waypoints sit well inside it).
const ROOM = new Bounds(0, 0, 600, 600);

// ---- known-good layout constructs ----

/**
 * A clean 4-waypoint square-ish walk: N, E, S. All circles >= 50px apart, the two parallel
 * verticals are 100px apart, and every waypoint sits >= 30px inside ROOM.
 */
function goodWalkWaypoints(): Waypoint[] {
  return walkFrom([
    [100, 400], // WP1 (start)
    [100, 300], // WP2  (turn here)
    [200, 300], // WP3  (turn here)
    [200, 400], // WP4 (end)
  ]);
}

test("Walk.create: a known-good layout constructs", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.equal(walk.waypointCount, 4);
});

test("Walk.create: derives N-1 segments joining consecutive waypoints", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.equal(walk.segments.length, 3);
  // segments[i] joins waypoints[i] -> waypoints[i+1]
  for (let i = 0; i < walk.segments.length; i++) {
    assert.ok(walk.segments[i].start.equals(walk.waypoints[i].position));
    assert.ok(walk.segments[i].end.equals(walk.waypoints[i + 1].position));
  }
});

test("Walk.create: exposes waypoints, segments, bounding box, cumulative distances", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.equal(walk.waypoints.length, 4);
  assert.equal(walk.segments.length, 3);
  // tight bounding box around the waypoint centres
  assert.deepEqual(
    [walk.boundingBox.minX, walk.boundingBox.minY, walk.boundingBox.maxX, walk.boundingBox.maxY],
    [100, 300, 200, 400]
  );
  // cumulative distance: 0, 100, 200, 300 (three 100px segments)
  assert.deepEqual([...walk.cumulativeDistances], [0, 100, 200, 300]);
  assert.equal(walk.totalDistance, 300);
});

test("Walk.create: there is no isValid() method (always valid by construction)", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.equal((walk as unknown as { isValid?: unknown }).isValid, undefined);
});

// ---- cumulative distance accessor ----

test("cumulativeDistanceTo: returns per-waypoint distance from the start", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.equal(walk.cumulativeDistanceTo(0), 0);
  assert.equal(walk.cumulativeDistanceTo(1), 100);
  assert.equal(walk.cumulativeDistanceTo(3), 300);
});

test("cumulativeDistanceTo: throws RangeError out of bounds", () => {
  const walk = Walk.create(goodWalkWaypoints(), ROOM);
  assert.throws(() => walk.cumulativeDistanceTo(-1), RangeError);
  assert.throws(() => walk.cumulativeDistanceTo(4), RangeError);
});

// ---- structural invariants ----

test("Walk.create: fewer than 2 waypoints throws", () => {
  const one = [Waypoint.create(1, 2, new Point(100, 100), null, false)];
  assert.throws(() => Walk.create(one, ROOM), /at least 2 waypoints/);
});

test("Walk.create: out-of-order sequence numbers throw", () => {
  const wps = [
    Waypoint.create(1, 3, new Point(100, 400), null, false),
    Waypoint.create(3, 3, new Point(200, 300), null, false), // wrong: expected seq 2 at index 1
    Waypoint.create(2, 3, new Point(100, 300), null, false),
  ];
  assert.throws(() => Walk.create(wps, ROOM), /ordered by sequence number/);
});

test("Walk.create: a waypoint reporting the wrong totalWaypoints throws", () => {
  const wps = [
    Waypoint.create(1, 2, new Point(100, 400), null, false),
    Waypoint.create(2, 3, new Point(100, 300), null, false), // totalWaypoints 3 != list length 2
  ];
  assert.throws(() => Walk.create(wps, ROOM), /totalWaypoints/);
});

test("Walk.create: a diagonal step between consecutive waypoints throws", () => {
  const wps = walkFrom([
    [0, 0],
    [50, 50], // diagonal -> Segment constructor rejects it
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /diagonal/);
});

// ---- layout-rules invariants: each one throws ----

test("Walk.create: overlapping waypoint circles throw (rule 1)", () => {
  // WP1 -> WP2 is only 40px, so the two circles (radius 25) overlap.
  const wps = walkFrom([
    [100, 100],
    [100, 140],
    [400, 140],
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /waypoint-circles-overlap/);
});

test("Walk.create: parallel segments closer than 55px throw (rule 2)", () => {
  // Two vertical segments 52px apart (>= 50 so circles don't overlap, < 55 so spacing fails)
  // sharing a 100px overlapping y-range.
  const wps = walkFrom([
    [100, 400],
    [100, 300],
    [152, 300],
    [152, 400],
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /parallel-segments-too-close/);
});

test("Walk.create: a segment within 35px of a non-adjacent waypoint throws (rule 3)", () => {
  // seg0 (x=100) passes 30px from WP5 at (130,250) — non-adjacent, < 35 but >= 25.
  const wps = walkFrom([
    [100, 400],
    [100, 100],
    [200, 100],
    [200, 250],
    [130, 250],
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /segment-too-close-to-waypoint/);
});

test("Walk.create: a segment passing through a non-adjacent waypoint circle throws (rule 4)", () => {
  // seg0 (x=100) passes 20px from WP5 at (120,250) — non-adjacent, < 25 (inside the circle).
  const wps = walkFrom([
    [100, 400],
    [100, 100],
    [200, 100],
    [200, 250],
    [120, 250],
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /segment-through-waypoint-circle/);
});

test("Walk.create: a turn label too close to a non-adjacent segment throws (rule 5)", () => {
  // WP2's NE label (~232.5, 267.5) sits ~5.5px from the non-adjacent vertical segment seg4 at x=238.
  const wps = walkFrom([
    [50, 300],
    [200, 300], // WP2: NE turn label is the one that clears (or doesn't)
    [450, 300],
    [450, 100],
    [238, 100],
    [238, 400], // seg4: vertical at x=238 spanning y=[100,400], passes the WP2 label
  ]);
  assert.throws(() => Walk.create(wps, ROOM), /turn-label-too-close-to-segment/);
});

test("Walk.create: non-adjacent waypoints closer than 70px throw (rule 7, ADR-0007)", () => {
  // A U-shape whose far end (WP5) folds back to ~62.5px from WP1 — a non-adjacent pair below the
  // 70px min gap (but >= 50px, so the circles do not overlap). Every segment stays clear of
  // non-adjacent waypoints, so only the new min-gap rule fires.
  const wps = walkFrom([
    [100, 400],
    [100, 100],
    [400, 100],
    [400, 360],
    [148, 360],
  ]);
  // Assert the SOLE violation — not just that the rule name is a substring of the message.
  // `assert.throws(fn, /rule/)` only proves the rule is AMONG the violations; if this fixture ever
  // started tripping a second rule (a geometry/threshold drift) the regex would still pass and the
  // "only the new min-gap rule fires" claim above would rot silently. Parsing the rule list and
  // asserting it is exactly [non-adjacent-waypoints-too-close] makes that isolation load-bearing,
  // mirroring the checkLayout-level isolation test in tests/layout-rules.test.ts.
  assert.throws(
    () => Walk.create(wps, ROOM),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const prefix = "Invalid Walk layout: ";
      assert.ok(err.message.startsWith(prefix), `unexpected error: ${err.message}`);
      const rules = err.message.slice(prefix.length).split(", ");
      assert.deepEqual(rules, ["non-adjacent-waypoints-too-close"]);
      return true;
    }
  );
});

test("Walk.create: a turn label too close to a non-adjacent waypoint circle throws (rule 8, ADR-0008)", () => {
  // Interior WP2's NE label lands ~24.7px from the non-adjacent terminal WP6's circle, while their
  // centres stay 70.7px apart (passing the ADR-0007 circle gap). The label-vs-SEGMENT rule needs
  // only 8px and so does not fire; only the new 43px label-vs-waypoint rule catches it — exactly the
  // gap ADR-0008 closes. Asserting the SOLE violation makes the isolation load-bearing (see rule 7).
  const region = new Bounds(-300, -400, 700, 800);
  const wps = walkFrom([
    [0, 150],
    [0, 0], // WP2: owner of the offending NE label
    [-150, 0],
    [-150, -200],
    [50, -200],
    [50, -50], // WP6: protected circle — 70.7px from WP2 centre, ~24.7px from its label
  ]);
  assert.throws(
    () => Walk.create(wps, region),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const prefix = "Invalid Walk layout: ";
      assert.ok(err.message.startsWith(prefix), `unexpected error: ${err.message}`);
      const rules = err.message.slice(prefix.length).split(", ");
      assert.deepEqual(rules, ["turn-label-too-close-to-waypoint"]);
      return true;
    }
  );
});

test("Walk.create: a waypoint outside the bounds (30px padding) throws (rule 6)", () => {
  // The good geometry, but a region too tight for the 30px padding.
  const tight = new Bounds(90, 290, 210, 410); // padding 30 -> usable x[120,180] y[320,380]
  assert.throws(() => Walk.create(goodWalkWaypoints(), tight), /waypoint-out-of-bounds/);
});

// ---- valid wildcard / turn-bearing walk ----

test("Walk.create: a walk carrying turns and a wildcard constructs", () => {
  const wps = [
    Waypoint.create(1, 4, new Point(100, 400), null, false),
    Waypoint.create(2, 4, new Point(100, 300), Turn.Right, false),
    Waypoint.create(3, 4, new Point(200, 300), null, true), // wildcard: turn skipped
    Waypoint.create(4, 4, new Point(200, 400), null, false),
  ];
  const walk = Walk.create(wps, ROOM);
  assert.equal(walk.waypoints[1].outboundTurn, Turn.Right);
  assert.equal(walk.waypoints[2].wildcard, true);
});
