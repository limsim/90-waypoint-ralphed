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
