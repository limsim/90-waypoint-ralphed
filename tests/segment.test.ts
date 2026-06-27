import test from "node:test";
import assert from "node:assert/strict";
import { Segment } from "../src/domain/segment.js";
import { Point } from "../src/domain/point.js";

// Construction

test("Segment: horizontal construction succeeds", () => {
  const s = new Segment(new Point(0, 5), new Point(10, 5));
  assert.strictEqual(s.orientation, "horizontal");
  assert.strictEqual(s.length, 10);
});

test("Segment: vertical construction succeeds", () => {
  const s = new Segment(new Point(5, 0), new Point(5, 20));
  assert.strictEqual(s.orientation, "vertical");
  assert.strictEqual(s.length, 20);
});

test("Segment: diagonal construction throws", () => {
  assert.throws(() => new Segment(new Point(0, 0), new Point(3, 4)));
});

test("Segment: zero-length construction throws", () => {
  assert.throws(() => new Segment(new Point(5, 5), new Point(5, 5)));
});

// Length

test("Segment: length is absolute for horizontal (end before start)", () => {
  const s = new Segment(new Point(10, 5), new Point(0, 5));
  assert.strictEqual(s.length, 10);
});

test("Segment: length is absolute for vertical (end before start)", () => {
  const s = new Segment(new Point(5, 20), new Point(5, 0));
  assert.strictEqual(s.length, 20);
});

// Orientation

test("Segment: horizontal orientation when y values are equal", () => {
  assert.strictEqual(
    new Segment(new Point(0, 10), new Point(100, 10)).orientation,
    "horizontal"
  );
});

test("Segment: vertical orientation when x values are equal", () => {
  assert.strictEqual(
    new Segment(new Point(10, 0), new Point(10, 100)).orientation,
    "vertical"
  );
});

// distanceFrom — perpendicular (within range)

test("Segment: distance from point directly above horizontal segment is perpendicular", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  assert.strictEqual(s.distanceFrom(new Point(50, 30)), 30);
});

test("Segment: distance from point lying on horizontal segment is zero", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  assert.strictEqual(s.distanceFrom(new Point(50, 0)), 0);
});

test("Segment: distance from point beside vertical segment is perpendicular", () => {
  const s = new Segment(new Point(0, 0), new Point(0, 100));
  assert.strictEqual(s.distanceFrom(new Point(20, 50)), 20);
});

test("Segment: distance from point lying on vertical segment is zero", () => {
  const s = new Segment(new Point(0, 0), new Point(0, 100));
  assert.strictEqual(s.distanceFrom(new Point(0, 50)), 0);
});

// distanceFrom — outside segment range (endpoint distance)

test("Segment: distance from point left of horizontal segment uses left endpoint", () => {
  const s = new Segment(new Point(10, 0), new Point(90, 0));
  assert.strictEqual(s.distanceFrom(new Point(0, 0)), 10);
});

test("Segment: distance from point right of horizontal segment uses right endpoint", () => {
  const s = new Segment(new Point(10, 0), new Point(90, 0));
  assert.strictEqual(s.distanceFrom(new Point(100, 0)), 10);
});

test("Segment: distance from point above vertical segment uses top endpoint", () => {
  const s = new Segment(new Point(0, 10), new Point(0, 90));
  assert.strictEqual(s.distanceFrom(new Point(0, 0)), 10);
});

test("Segment: distance from point below vertical segment uses bottom endpoint", () => {
  const s = new Segment(new Point(0, 10), new Point(0, 90));
  assert.strictEqual(s.distanceFrom(new Point(0, 100)), 10);
});

test("Segment: distance from point off-corner uses hypotenuse (3-4-5 triangle)", () => {
  const s = new Segment(new Point(0, 0), new Point(100, 0));
  assert.strictEqual(s.distanceFrom(new Point(-3, 4)), 5);
});

// parallelOverlap

test("Segment: parallel horizontal segments with overlap return correct values", () => {
  const s1 = new Segment(new Point(0, 0), new Point(100, 0));
  const s2 = new Segment(new Point(50, 55), new Point(150, 55));
  const r = s1.parallelOverlap(s2);
  assert.ok(r !== null);
  assert.strictEqual(r.separation, 55);
  assert.strictEqual(r.overlapLength, 50);
});

test("Segment: parallel vertical segments with overlap return correct values", () => {
  const s1 = new Segment(new Point(0, 0), new Point(0, 100));
  const s2 = new Segment(new Point(55, 50), new Point(55, 150));
  const r = s1.parallelOverlap(s2);
  assert.ok(r !== null);
  assert.strictEqual(r.separation, 55);
  assert.strictEqual(r.overlapLength, 50);
});

test("Segment: parallel horizontal segments with no overlap return overlapLength 0", () => {
  const s1 = new Segment(new Point(0, 0), new Point(50, 0));
  const s2 = new Segment(new Point(60, 30), new Point(110, 30));
  const r = s1.parallelOverlap(s2);
  assert.ok(r !== null);
  assert.strictEqual(r.separation, 30);
  assert.strictEqual(r.overlapLength, 0);
});

test("Segment: parallel segments just touching (endpoint-to-endpoint) return overlapLength 0", () => {
  const s1 = new Segment(new Point(0, 0), new Point(50, 0));
  const s2 = new Segment(new Point(50, 20), new Point(100, 20));
  const r = s1.parallelOverlap(s2);
  assert.ok(r !== null);
  assert.strictEqual(r.overlapLength, 0);
});

test("Segment: non-parallel segments return null for parallelOverlap", () => {
  const s1 = new Segment(new Point(0, 0), new Point(100, 0));
  const s2 = new Segment(new Point(0, 0), new Point(0, 100));
  assert.strictEqual(s1.parallelOverlap(s2), null);
});

test("Segment: parallelOverlap is symmetric", () => {
  const s1 = new Segment(new Point(0, 0), new Point(100, 0));
  const s2 = new Segment(new Point(30, 40), new Point(130, 40));
  const r1 = s1.parallelOverlap(s2);
  const r2 = s2.parallelOverlap(s1);
  assert.ok(r1 !== null && r2 !== null);
  assert.strictEqual(r1.separation, r2.separation);
  assert.strictEqual(r1.overlapLength, r2.overlapLength);
});
