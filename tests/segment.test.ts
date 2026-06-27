import test from "node:test";
import assert from "node:assert/strict";

import { Point } from "../src/domain/point.js";
import { Segment, Orientation } from "../src/domain/segment.js";

// --- Construction ---

test("Segment: horizontal endpoints are accepted", () => {
  const s = new Segment(new Point(0, 5), new Point(100, 5));
  assert.equal(s.orientation, Orientation.Horizontal);
});

test("Segment: vertical endpoints are accepted", () => {
  const s = new Segment(new Point(5, 0), new Point(5, 100));
  assert.equal(s.orientation, Orientation.Vertical);
});

test("Segment: diagonal endpoints are rejected", () => {
  assert.throws(() => new Segment(new Point(0, 0), new Point(100, 100)));
});

test("Segment: degenerate (zero-length) endpoints are rejected", () => {
  assert.throws(() => new Segment(new Point(7, 7), new Point(7, 7)));
});

// --- length ---

test("Segment length: horizontal", () => {
  assert.equal(new Segment(new Point(10, 5), new Point(130, 5)).length, 120);
});

test("Segment length: vertical, regardless of endpoint order/direction", () => {
  // North-going segment (decreasing y) — length is still positive.
  assert.equal(new Segment(new Point(5, 100), new Point(5, 40)).length, 60);
  assert.equal(new Segment(new Point(5, 40), new Point(5, 100)).length, 60);
});

// --- distanceToPoint ---

test("Segment distanceToPoint: point on the segment is zero", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  assert.equal(s.distanceToPoint(new Point(50, 0)), 0);
});

test("Segment distanceToPoint: perpendicular projection inside the segment", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  // (50, 35) projects to (50, 0) -> distance 35
  assert.equal(s.distanceToPoint(new Point(50, 35)), 35);
});

test("Segment distanceToPoint: point beyond an endpoint uses the endpoint", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  // (130, 0) is 30 past the (100,0) end along the same line
  assert.equal(s.distanceToPoint(new Point(130, 0)), 30);
  // (103, 4) -> nearest endpoint (100,0) -> hypot(3,4) = 5
  assert.equal(s.distanceToPoint(new Point(103, 4)), 5);
});

test("Segment distanceToPoint: vertical segment", () => {
  const s = new Segment(new Point(20, 0), new Point(20, 100));
  assert.equal(s.distanceToPoint(new Point(55, 50)), 35);
});

// --- parallelOverlap ---

test("Segment parallelOverlap: perpendicular segments do not overlap", () => {
  const h = new Segment(new Point(0, 0), new Point(100, 0));
  const v = new Segment(new Point(50, -50), new Point(50, 50));
  assert.equal(h.parallelOverlap(v), null);
});

test("Segment parallelOverlap: two horizontals sharing an x-range", () => {
  const a = new Segment(new Point(0, 0), new Point(100, 0));
  const b = new Segment(new Point(40, 60), new Point(140, 60));
  const r = a.parallelOverlap(b);
  assert.ok(r);
  assert.equal(r.overlapStart, 40);
  assert.equal(r.overlapEnd, 100);
  assert.equal(r.separation, 60);
});

test("Segment parallelOverlap: two horizontals with disjoint x-ranges return null", () => {
  const a = new Segment(new Point(0, 0), new Point(100, 0));
  const b = new Segment(new Point(150, 10), new Point(250, 10));
  assert.equal(a.parallelOverlap(b), null);
});

test("Segment parallelOverlap: a shared endpoint counts as a zero-length overlap", () => {
  const a = new Segment(new Point(0, 0), new Point(100, 0));
  const b = new Segment(new Point(100, 10), new Point(200, 10));
  const r = a.parallelOverlap(b);
  assert.ok(r);
  assert.equal(r.overlapStart, 100);
  assert.equal(r.overlapEnd, 100);
  assert.equal(r.separation, 10);
});

test("Segment parallelOverlap: two verticals sharing a y-range", () => {
  const a = new Segment(new Point(0, 0), new Point(0, 100));
  const b = new Segment(new Point(55, 30), new Point(55, 200));
  const r = a.parallelOverlap(b);
  assert.ok(r);
  assert.equal(r.overlapStart, 30);
  assert.equal(r.overlapEnd, 100);
  assert.equal(r.separation, 55);
});

test("Segment parallelOverlap: separation reports exact spacing (54 vs 55 boundary)", () => {
  const base = new Segment(new Point(0, 0), new Point(100, 0));
  const at54 = new Segment(new Point(0, 54), new Point(100, 54));
  const at55 = new Segment(new Point(0, 55), new Point(100, 55));
  assert.equal(base.parallelOverlap(at54)?.separation, 54);
  assert.equal(base.parallelOverlap(at55)?.separation, 55);
});

test("Segment parallelOverlap: collinear overlapping segments have zero separation", () => {
  const a = new Segment(new Point(0, 0), new Point(100, 0));
  const b = new Segment(new Point(50, 0), new Point(150, 0));
  const r = a.parallelOverlap(b);
  assert.ok(r);
  assert.equal(r.separation, 0);
  assert.equal(r.overlapStart, 50);
  assert.equal(r.overlapEnd, 100);
});
