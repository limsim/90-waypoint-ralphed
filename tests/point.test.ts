import test from "node:test";
import assert from "node:assert/strict";
import { Point } from "../src/domain/point.js";

test("Point: equality - same coordinates", () => {
  assert.ok(new Point(3, 4).equals(new Point(3, 4)));
});

test("Point: equality - different coordinates", () => {
  assert.ok(!new Point(3, 4).equals(new Point(3, 5)));
  assert.ok(!new Point(3, 4).equals(new Point(2, 4)));
});

test("Point: translate produces new point with offset applied", () => {
  const p = new Point(10, 20);
  const q = p.translate(5, -3);
  assert.deepEqual({ x: q.x, y: q.y }, { x: 15, y: 17 });
});

test("Point: translate does not mutate original", () => {
  const p = new Point(1, 2);
  p.translate(99, 99);
  assert.ok(p.equals(new Point(1, 2)));
});

test("Point: translate by zero is equal to original", () => {
  const p = new Point(7, 8);
  assert.ok(p.translate(0, 0).equals(p));
});
