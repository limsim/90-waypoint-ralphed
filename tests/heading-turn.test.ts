import test from "node:test";
import assert from "node:assert/strict";

import { Heading, Turn } from "../src/domain/heading.js";
import { Point } from "../src/domain/point.js";

// --- Unit step vectors (screen-style axes: y increases downward) ---

test("Heading unit step vectors: North is up (0,-1)", () => {
  assert.ok(Heading.North.unitStep.equals(new Point(0, -1)));
});

test("Heading unit step vectors: East is right (1,0)", () => {
  assert.ok(Heading.East.unitStep.equals(new Point(1, 0)));
});

test("Heading unit step vectors: South is down (0,1)", () => {
  assert.ok(Heading.South.unitStep.equals(new Point(0, 1)));
});

test("Heading unit step vectors: West is left (-1,0)", () => {
  assert.ok(Heading.West.unitStep.equals(new Point(-1, 0)));
});

// --- Left turn: 90° counter-clockwise (N→W→S→E→N) ---

test("Turn Left from North faces West", () => {
  assert.equal(Heading.North.turn(Turn.Left), Heading.West);
});

test("Turn Left from West faces South", () => {
  assert.equal(Heading.West.turn(Turn.Left), Heading.South);
});

test("Turn Left from South faces East", () => {
  assert.equal(Heading.South.turn(Turn.Left), Heading.East);
});

test("Turn Left from East faces North", () => {
  assert.equal(Heading.East.turn(Turn.Left), Heading.North);
});

// --- Right turn: 90° clockwise (N→E→S→W→N) ---

test("Turn Right from North faces East", () => {
  assert.equal(Heading.North.turn(Turn.Right), Heading.East);
});

test("Turn Right from East faces South", () => {
  assert.equal(Heading.East.turn(Turn.Right), Heading.South);
});

test("Turn Right from South faces West", () => {
  assert.equal(Heading.South.turn(Turn.Right), Heading.West);
});

test("Turn Right from West faces North", () => {
  assert.equal(Heading.West.turn(Turn.Right), Heading.North);
});

// --- Composition sanity: four identical turns return to the start ---

test("Four Left turns return to the original heading", () => {
  let h = Heading.North;
  for (let i = 0; i < 4; i++) h = h.turn(Turn.Left);
  assert.equal(h, Heading.North);
});

test("Four Right turns return to the original heading", () => {
  let h = Heading.North;
  for (let i = 0; i < 4; i++) h = h.turn(Turn.Right);
  assert.equal(h, Heading.North);
});

test("Left then Right is the identity", () => {
  assert.equal(Heading.East.turn(Turn.Left).turn(Turn.Right), Heading.East);
});
