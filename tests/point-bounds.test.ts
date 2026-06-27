import test from "node:test";
import assert from "node:assert/strict";

import { Point } from "../src/domain/point.js";
import { Bounds } from "../src/domain/bounds.js";

// --- Point ---

test("Point equality: same coordinates are equal", () => {
  const a = new Point(3, 7);
  const b = new Point(3, 7);
  assert.ok(a.equals(b));
});

test("Point equality: different coordinates are not equal", () => {
  assert.ok(!new Point(1, 2).equals(new Point(1, 3)));
  assert.ok(!new Point(1, 2).equals(new Point(2, 2)));
});

test("Point translate returns a new point with correct offset", () => {
  const p = new Point(10, 20);
  const q = p.translate(5, -3);
  assert.ok(q.equals(new Point(15, 17)));
});

test("Point translate does not mutate the original", () => {
  const p = new Point(10, 20);
  p.translate(1, 1);
  assert.ok(p.equals(new Point(10, 20)));
});

// --- Bounds ---

test("Bounds contains: interior point with no padding", () => {
  const b = new Bounds(0, 0, 100, 100);
  assert.ok(b.contains(new Point(50, 50)));
});

test("Bounds contains: boundary point is inside at padding=0", () => {
  const b = new Bounds(0, 0, 100, 100);
  assert.ok(b.contains(new Point(0, 0)));
  assert.ok(b.contains(new Point(100, 100)));
});

test("Bounds contains: exterior point is outside", () => {
  const b = new Bounds(0, 0, 100, 100);
  assert.ok(!b.contains(new Point(101, 50)));
  assert.ok(!b.contains(new Point(50, -1)));
});

test("Bounds contains: padding inset excludes boundary", () => {
  const b = new Bounds(0, 0, 100, 100);
  // Exactly on the inset boundary — should be inside
  assert.ok(b.contains(new Point(30, 30), 30));
  assert.ok(b.contains(new Point(70, 70), 30));
  // One pixel inside the padding zone — should be outside
  assert.ok(!b.contains(new Point(29, 50), 30));
  assert.ok(!b.contains(new Point(50, 71), 30));
});

test("Bounds grow: factor=1 leaves bounds unchanged", () => {
  const b = new Bounds(0, 0, 100, 200);
  const grown = b.grow(1);
  assert.equal(grown.minX, 0);
  assert.equal(grown.minY, 0);
  assert.equal(grown.maxX, 100);
  assert.equal(grown.maxY, 200);
});

test("Bounds grow: factor=2 doubles dimensions around centre", () => {
  const b = new Bounds(0, 0, 100, 100);
  const grown = b.grow(2);
  assert.equal(grown.minX, -50);
  assert.equal(grown.minY, -50);
  assert.equal(grown.maxX, 150);
  assert.equal(grown.maxY, 150);
});

test("Bounds grow: factor=1.1 expands by 10%", () => {
  const b = new Bounds(0, 0, 100, 100);
  const grown = b.grow(1.1);
  // Centre=(50,50), half-width/height=55 — use epsilon for floating-point
  const eps = 1e-6;
  assert.ok(Math.abs(grown.minX - (-5)) < eps, `minX ${grown.minX}`);
  assert.ok(Math.abs(grown.minY - (-5)) < eps, `minY ${grown.minY}`);
  assert.ok(Math.abs(grown.maxX - 105) < eps, `maxX ${grown.maxX}`);
  assert.ok(Math.abs(grown.maxY - 105) < eps, `maxY ${grown.maxY}`);
});

test("Bounds width and height", () => {
  const b = new Bounds(10, 20, 110, 220);
  assert.equal(b.width, 100);
  assert.equal(b.height, 200);
});
