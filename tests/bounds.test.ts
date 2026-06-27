import test from "node:test";
import assert from "node:assert/strict";
import { Bounds } from "../src/domain/bounds.js";
import { Point } from "../src/domain/point.js";

// Bounds(0, 0, 100, 200): width=100, height=200
const B = new Bounds(0, 0, 100, 200);

test("Bounds: width and height", () => {
  assert.equal(B.width, 100);
  assert.equal(B.height, 200);
});

test("Bounds: contains - interior point with no padding", () => {
  assert.ok(B.contains(new Point(50, 100)));
});

test("Bounds: contains - point on edge with no padding", () => {
  assert.ok(B.contains(new Point(0, 0)));
  assert.ok(B.contains(new Point(100, 200)));
});

test("Bounds: contains - point outside", () => {
  assert.ok(!B.contains(new Point(-1, 100)));
  assert.ok(!B.contains(new Point(101, 100)));
  assert.ok(!B.contains(new Point(50, -1)));
  assert.ok(!B.contains(new Point(50, 201)));
});

test("Bounds: contains - point inside padded region passes", () => {
  const padding = 30;
  // point is 30px from each edge
  assert.ok(B.contains(new Point(30, 30), padding));
  assert.ok(B.contains(new Point(70, 170), padding));
});

test("Bounds: contains - point inside bounds but inside padding strip fails", () => {
  const padding = 30;
  // x=29 is one pixel inside the left padding strip
  assert.ok(!B.contains(new Point(29, 100), padding));
  // y=29 is one pixel inside the top padding strip
  assert.ok(!B.contains(new Point(50, 29), padding));
  // right edge: x=71 is one pixel inside the right padding strip
  assert.ok(!B.contains(new Point(71, 100), padding));
  // bottom edge: y=171 is one pixel inside the bottom padding strip
  assert.ok(!B.contains(new Point(50, 171), padding));
});

test("Bounds: grow by factor 2 doubles dimensions from centre", () => {
  const b = new Bounds(0, 0, 100, 100);
  const grown = b.grow(2);
  assert.equal(grown.minX, -50);
  assert.equal(grown.minY, -50);
  assert.equal(grown.maxX, 150);
  assert.equal(grown.maxY, 150);
  assert.equal(grown.width, 200);
  assert.equal(grown.height, 200);
});

test("Bounds: grow by factor 1 is identity", () => {
  const grown = B.grow(1);
  assert.equal(grown.minX, B.minX);
  assert.equal(grown.minY, B.minY);
  assert.equal(grown.maxX, B.maxX);
  assert.equal(grown.maxY, B.maxY);
});

test("Bounds: grow preserves centre point", () => {
  const b = new Bounds(0, 0, 100, 200);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const grown = b.grow(1.1);
  assert.equal((grown.minX + grown.maxX) / 2, cx);
  assert.equal((grown.minY + grown.maxY) / 2, cy);
});
