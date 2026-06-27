import test from "node:test";
import assert from "node:assert/strict";

import { Turn } from "../src/domain/heading.js";
import { RandomSource } from "../src/domain/random-source.js";
import { TurnSequence } from "../src/domain/turn-sequence.js";

/**
 * A deterministic stand-in for the seedable RandomSource (the production impl lands in
 * US-009). mulberry32: same seed → identical stream, so it exercises the "deterministic
 * output under a seeded source" criterion without depending on the real adapter.
 */
function seeded(seed: number): RandomSource {
  let state = seed >>> 0;
  const nextFloat = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextFloat,
    nextInt: (maxExclusive: number) => Math.floor(nextFloat() * maxExclusive),
  };
}

// --- Length math: N waypoints -> N-2 turns ---

test("turnCountForWaypoints: N=10 has 8 turns", () => {
  assert.equal(TurnSequence.turnCountForWaypoints(10), 8);
});

test("turnCountForWaypoints: N=90 has 88 turns", () => {
  assert.equal(TurnSequence.turnCountForWaypoints(90), 88);
});

test("turnCountForWaypoints rejects waypointCount < 2", () => {
  assert.throws(() => TurnSequence.turnCountForWaypoints(1), RangeError);
});

test("randomForWaypoints produces exactly N-2 turns (N=10)", () => {
  const seq = TurnSequence.randomForWaypoints(10, seeded(1));
  assert.equal(seq.length, 8);
});

test("randomForWaypoints produces exactly N-2 turns (N=90)", () => {
  const seq = TurnSequence.randomForWaypoints(90, seeded(1));
  assert.equal(seq.length, 88);
});

// --- Contents are only L/R turns ---

test("random sequence contains only Left/Right turns", () => {
  const seq = TurnSequence.randomForWaypoints(90, seeded(7));
  for (const t of seq.turns) {
    assert.ok(t === Turn.Left || t === Turn.Right);
  }
});

test("random rejects a negative length", () => {
  assert.throws(() => TurnSequence.random(-1, seeded(1)), RangeError);
});

test("random of length 0 is the empty sequence", () => {
  const seq = TurnSequence.random(0, seeded(1));
  assert.equal(seq.length, 0);
  assert.deepEqual(seq.turns, []);
});

// --- Determinism under a seeded source ---

test("same seed yields identical sequences", () => {
  const a = TurnSequence.randomForWaypoints(90, seeded(42));
  const b = TurnSequence.randomForWaypoints(90, seeded(42));
  assert.ok(a.equals(b));
  assert.deepEqual(a.turns, b.turns);
});

test("different seeds generally yield different sequences", () => {
  const a = TurnSequence.randomForWaypoints(90, seeded(1));
  const b = TurnSequence.randomForWaypoints(90, seeded(2));
  assert.ok(!a.equals(b));
});

// --- Immutability ---

test("constructor defensively copies its input array", () => {
  const input = [Turn.Left, Turn.Right];
  const seq = new TurnSequence(input);
  input.push(Turn.Left); // mutate the original after construction
  assert.equal(seq.length, 2);
});

test("the turns getter returns a copy, not the internal array", () => {
  const seq = new TurnSequence([Turn.Left, Turn.Right]);
  const got = seq.turns as Turn[];
  got.push(Turn.Left);
  assert.equal(seq.length, 2);
});

test("at(index) returns the turn and rejects out-of-range indices", () => {
  const seq = new TurnSequence([Turn.Left, Turn.Right]);
  assert.equal(seq.at(0), Turn.Left);
  assert.equal(seq.at(1), Turn.Right);
  assert.throws(() => seq.at(2), RangeError);
  assert.throws(() => seq.at(-1), RangeError);
});
