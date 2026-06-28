import test from "node:test";
import assert from "node:assert/strict";
import { Heading } from "../src/domain/heading.js";
import { Turn } from "../src/domain/turn.js";

// Unit step vectors
test("Heading: North step is (0, -1) - up means decreasing y", () => {
  assert.deepEqual({ dx: Heading.North.dx, dy: Heading.North.dy }, { dx: 0, dy: -1 });
});

test("Heading: East step is (1, 0)", () => {
  assert.deepEqual({ dx: Heading.East.dx, dy: Heading.East.dy }, { dx: 1, dy: 0 });
});

test("Heading: South step is (0, 1)", () => {
  assert.deepEqual({ dx: Heading.South.dx, dy: Heading.South.dy }, { dx: 0, dy: 1 });
});

test("Heading: West step is (-1, 0)", () => {
  assert.deepEqual({ dx: Heading.West.dx, dy: Heading.West.dy }, { dx: -1, dy: 0 });
});

// Turn.Left (CCW)
test("Heading: North + Left = West", () => {
  assert.strictEqual(Heading.North.apply(Turn.Left), Heading.West);
});

test("Heading: East + Left = North", () => {
  assert.strictEqual(Heading.East.apply(Turn.Left), Heading.North);
});

test("Heading: South + Left = East", () => {
  assert.strictEqual(Heading.South.apply(Turn.Left), Heading.East);
});

test("Heading: West + Left = South", () => {
  assert.strictEqual(Heading.West.apply(Turn.Left), Heading.South);
});

// Turn.Right (CW)
test("Heading: North + Right = East", () => {
  assert.strictEqual(Heading.North.apply(Turn.Right), Heading.East);
});

test("Heading: East + Right = South", () => {
  assert.strictEqual(Heading.East.apply(Turn.Right), Heading.South);
});

test("Heading: South + Right = West", () => {
  assert.strictEqual(Heading.South.apply(Turn.Right), Heading.West);
});

test("Heading: West + Right = North", () => {
  assert.strictEqual(Heading.West.apply(Turn.Right), Heading.North);
});

// Turn enum values
test("Turn.Left has value 'L'", () => {
  assert.strictEqual(Turn.Left, "L");
});

test("Turn.Right has value 'R'", () => {
  assert.strictEqual(Turn.Right, "R");
});

// 4-turn cycle invariant: applying the same turn 4 times must return to the original heading
test("Heading: 4 Right turns from North returns to North", () => {
  let h = Heading.North;
  for (let i = 0; i < 4; i++) h = h.apply(Turn.Right);
  assert.strictEqual(h, Heading.North);
});

test("Heading: 4 Left turns from East returns to East", () => {
  let h = Heading.East;
  for (let i = 0; i < 4; i++) h = h.apply(Turn.Left);
  assert.strictEqual(h, Heading.East);
});

// Left and Right are inverses: applying both in either order returns to origin
test("Heading: Right then Left is identity for all headings", () => {
  for (const h of [Heading.North, Heading.East, Heading.South, Heading.West]) {
    assert.strictEqual(h.apply(Turn.Right).apply(Turn.Left), h);
  }
});

test("Heading: Left then Right is identity for all headings", () => {
  for (const h of [Heading.North, Heading.East, Heading.South, Heading.West]) {
    assert.strictEqual(h.apply(Turn.Left).apply(Turn.Right), h);
  }
});
