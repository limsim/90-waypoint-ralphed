import test from "node:test";
import assert from "node:assert/strict";
import { TurnSequence } from "../src/domain/turn-sequence.js";
import { Turn } from "../src/domain/turn.js";
import { RandomSource } from "../src/domain/random-source.js";

function stubSource(values: number[]): RandomSource {
  let i = 0;
  return { nextFloat: () => values[i++ % values.length] };
}

test("length for N=10 is exactly 8", () => {
  const seq = TurnSequence.generate(10, stubSource([0.3]));
  assert.equal(seq.length, 8);
});

test("length for N=90 is exactly 88", () => {
  const seq = TurnSequence.generate(90, stubSource([0.3]));
  assert.equal(seq.length, 88);
});

test("length for N=2 is 0 (minimum walk)", () => {
  const seq = TurnSequence.generate(2, stubSource([0.3]));
  assert.equal(seq.length, 0);
  assert.deepEqual([...seq.turns], []);
});

test("turns are always Left or Right", () => {
  const seq = TurnSequence.generate(8, stubSource([0.0, 0.1, 0.4, 0.5, 0.6, 0.9]));
  for (const t of seq.turns) {
    assert.ok(t === Turn.Left || t === Turn.Right);
  }
});

test("nextFloat < 0.5 yields Left, >= 0.5 yields Right", () => {
  const seq = TurnSequence.generate(4, stubSource([0.0, 0.99]));
  assert.equal(seq.turns[0], Turn.Left);
  assert.equal(seq.turns[1], Turn.Right);
});

test("deterministic: same seeded source produces same sequence", () => {
  const values = [0.2, 0.8, 0.4, 0.6, 0.1, 0.9, 0.3, 0.7];
  const seq1 = TurnSequence.generate(10, stubSource(values));
  const seq2 = TurnSequence.generate(10, stubSource(values));
  assert.deepEqual([...seq1.turns], [...seq2.turns]);
});

test("different seeded sources produce different sequences", () => {
  const allLeft = stubSource([0.0]);
  const allRight = stubSource([0.99]);
  const seq1 = TurnSequence.generate(10, allLeft);
  const seq2 = TurnSequence.generate(10, allRight);
  assert.notDeepEqual([...seq1.turns], [...seq2.turns]);
});

test("turns are immutable (ReadonlyArray)", () => {
  const seq = TurnSequence.generate(5, stubSource([0.3]));
  // TypeScript enforces readonly at compile time; verify the value is an array at runtime
  assert.ok(Array.isArray(seq.turns));
  assert.equal(seq.turns.length, 3);
});

test("get(index) returns same value as turns[index]", () => {
  const seq = TurnSequence.generate(6, stubSource([0.2, 0.8, 0.4, 0.9]));
  for (let i = 0; i < seq.length; i++) {
    assert.equal(seq.get(i), seq.turns[i]);
  }
});

test("waypointCount < 2 throws", () => {
  assert.throws(
    () => TurnSequence.generate(1, stubSource([0.5])),
    /waypointCount must be at least 2/
  );
});
