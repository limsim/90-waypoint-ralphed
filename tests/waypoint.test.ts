import test from "node:test";
import assert from "node:assert/strict";
import { Waypoint } from "../src/domain/waypoint.js";
import { Point } from "../src/domain/point.js";
import { Turn } from "../src/domain/turn.js";

const origin = new Point(0, 0);
const pos = (x: number, y: number) => new Point(x, y);

test("first waypoint has no outbound turn", () => {
  const wp = Waypoint.create(1, 5, origin, null, false);
  assert.equal(wp.outboundTurn, null);
});

test("last waypoint has no outbound turn", () => {
  const wp = Waypoint.create(5, 5, origin, null, false);
  assert.equal(wp.outboundTurn, null);
});

test("first waypoint is never a wildcard", () => {
  const wp = Waypoint.create(1, 5, origin, null, false);
  assert.equal(wp.wildcard, false);
});

test("last waypoint is never a wildcard", () => {
  const wp = Waypoint.create(5, 5, origin, null, false);
  assert.equal(wp.wildcard, false);
});

test("creating first waypoint with wildcard=true throws", () => {
  assert.throws(
    () => Waypoint.create(1, 5, origin, null, true),
    /cannot be wildcards/
  );
});

test("creating last waypoint with wildcard=true throws", () => {
  assert.throws(
    () => Waypoint.create(5, 5, origin, null, true),
    /cannot be wildcards/
  );
});

test("creating first waypoint with an outbound turn throws", () => {
  assert.throws(
    () => Waypoint.create(1, 5, origin, Turn.Left, false),
    /must not have an outbound turn/
  );
});

test("creating last waypoint with an outbound turn throws", () => {
  assert.throws(
    () => Waypoint.create(5, 5, origin, Turn.Right, false),
    /must not have an outbound turn/
  );
});

test("interior waypoint (2..N-1) can have a Left outbound turn", () => {
  const wp = Waypoint.create(2, 5, pos(100, 0), Turn.Left, false);
  assert.equal(wp.outboundTurn, Turn.Left);
  assert.equal(wp.wildcard, false);
});

test("interior waypoint (2..N-1) can have a Right outbound turn", () => {
  const wp = Waypoint.create(3, 5, pos(200, 0), Turn.Right, false);
  assert.equal(wp.outboundTurn, Turn.Right);
  assert.equal(wp.wildcard, false);
});

test("interior waypoint can be a wildcard (heading-unchanged semantics)", () => {
  const wp = Waypoint.create(2, 5, pos(100, 0), null, true);
  assert.equal(wp.wildcard, true);
  assert.equal(wp.outboundTurn, null);
});

test("wildcard waypoint at position 2 of 90", () => {
  const wp = Waypoint.create(2, 90, pos(0, 100), null, true);
  assert.equal(wp.wildcard, true);
  assert.equal(wp.sequenceNumber, 2);
});

test("wildcard waypoint at last interior position (N-1)", () => {
  const wp = Waypoint.create(89, 90, pos(0, 500), null, true);
  assert.equal(wp.wildcard, true);
  assert.equal(wp.sequenceNumber, 89);
});

test("waypoint exposes sequenceNumber and position", () => {
  const p = pos(42, 99);
  const wp = Waypoint.create(3, 10, p, Turn.Left, false);
  assert.equal(wp.sequenceNumber, 3);
  assert.ok(wp.position.equals(p));
});

test("sequenceNumber out of range throws", () => {
  assert.throws(
    () => Waypoint.create(6, 5, origin, null, false),
    /out of range/
  );
});

test("sequenceNumber zero throws", () => {
  assert.throws(
    () => Waypoint.create(0, 5, origin, null, false),
    /out of range/
  );
});

test("totalWaypoints < 2 throws", () => {
  assert.throws(
    () => Waypoint.create(1, 1, origin, null, false),
    /totalWaypoints must be at least 2/
  );
});

test("minimum walk: first of 2 is terminal with no turn", () => {
  const wp = Waypoint.create(1, 2, origin, null, false);
  assert.equal(wp.outboundTurn, null);
  assert.equal(wp.wildcard, false);
});

test("minimum walk: last of 2 is terminal with no turn", () => {
  const wp = Waypoint.create(2, 2, pos(0, 100), null, false);
  assert.equal(wp.outboundTurn, null);
  assert.equal(wp.wildcard, false);
});

test("wildcard with non-null outboundTurn throws", () => {
  assert.throws(
    () => Waypoint.create(2, 5, origin, Turn.Left, true),
    /Wildcard waypoints must have no outbound turn/
  );
});

test("wildcard with Right outbound turn also throws", () => {
  assert.throws(
    () => Waypoint.create(3, 5, origin, Turn.Right, true),
    /Wildcard waypoints must have no outbound turn/
  );
});

test("negative sequenceNumber throws", () => {
  assert.throws(
    () => Waypoint.create(-1, 5, origin, null, false),
    /out of range/
  );
});

test("totalWaypoints = 0 throws", () => {
  assert.throws(
    () => Waypoint.create(1, 0, origin, null, false),
    /totalWaypoints must be at least 2/
  );
});

test("totalWaypoints is accessible as a field", () => {
  const wp = Waypoint.create(3, 10, origin, Turn.Left, false);
  assert.equal(wp.totalWaypoints, 10);
});

test("isFirst is true for sequenceNumber 1", () => {
  const wp = Waypoint.create(1, 10, origin, null, false);
  assert.equal(wp.isFirst, true);
});

test("isFirst is false for interior waypoint", () => {
  const wp = Waypoint.create(2, 10, pos(0, 100), Turn.Left, false);
  assert.equal(wp.isFirst, false);
});

test("isLast is true for sequenceNumber === totalWaypoints", () => {
  const wp = Waypoint.create(10, 10, pos(0, 500), null, false);
  assert.equal(wp.isLast, true);
});

test("isLast is false for interior waypoint", () => {
  const wp = Waypoint.create(9, 10, pos(0, 400), Turn.Right, false);
  assert.equal(wp.isLast, false);
});

test("isTerminal is true for first waypoint", () => {
  const wp = Waypoint.create(1, 5, origin, null, false);
  assert.equal(wp.isTerminal, true);
});

test("isTerminal is true for last waypoint", () => {
  const wp = Waypoint.create(5, 5, pos(0, 200), null, false);
  assert.equal(wp.isTerminal, true);
});

test("isTerminal is false for interior waypoint", () => {
  const wp = Waypoint.create(3, 5, pos(0, 100), Turn.Left, false);
  assert.equal(wp.isTerminal, false);
});

test("isInterior is true for interior waypoint", () => {
  const wp = Waypoint.create(3, 5, pos(0, 100), Turn.Right, false);
  assert.equal(wp.isInterior, true);
});

test("isInterior is false for first waypoint", () => {
  const wp = Waypoint.create(1, 5, origin, null, false);
  assert.equal(wp.isInterior, false);
});

test("isInterior is false for last waypoint", () => {
  const wp = Waypoint.create(5, 5, pos(0, 200), null, false);
  assert.equal(wp.isInterior, false);
});

test("interior non-wildcard with no outbound turn is allowed", () => {
  // Walk aggregate or generator may construct interior waypoints with null turn (e.g. before full placement)
  const wp = Waypoint.create(3, 10, pos(100, 100), null, false);
  assert.equal(wp.outboundTurn, null);
  assert.equal(wp.wildcard, false);
  assert.equal(wp.isInterior, true);
});

test("minimum walk: isFirst and isLast on 2-waypoint walk", () => {
  const first = Waypoint.create(1, 2, origin, null, false);
  const last = Waypoint.create(2, 2, pos(0, 100), null, false);
  assert.equal(first.isFirst, true);
  assert.equal(first.isLast, false);
  assert.equal(last.isFirst, false);
  assert.equal(last.isLast, true);
});
