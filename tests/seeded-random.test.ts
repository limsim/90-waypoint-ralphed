import test from "node:test";
import assert from "node:assert/strict";
import { SeededRandom } from "../src/domain/seeded-random.js";

test("same seed produces identical nextFloat sequence", () => {
  const a = new SeededRandom(42);
  const b = new SeededRandom(42);
  for (let i = 0; i < 20; i++) {
    assert.equal(a.nextFloat(), b.nextFloat());
  }
});

test("different seeds produce different sequences", () => {
  const a = new SeededRandom(1);
  const b = new SeededRandom(2);
  const valuesA = Array.from({ length: 10 }, () => a.nextFloat());
  const valuesB = Array.from({ length: 10 }, () => b.nextFloat());
  assert.notDeepEqual(valuesA, valuesB);
});

test("nextFloat returns values in [0, 1)", () => {
  const rng = new SeededRandom(99);
  for (let i = 0; i < 1000; i++) {
    const v = rng.nextFloat();
    assert.ok(v >= 0, `value ${v} should be >= 0`);
    assert.ok(v < 1, `value ${v} should be < 1`);
  }
});

test("same seed produces identical nextInt sequence", () => {
  const a = new SeededRandom(7);
  const b = new SeededRandom(7);
  for (let i = 0; i < 20; i++) {
    assert.equal(a.nextInt(60, 140), b.nextInt(60, 140));
  }
});

test("nextInt returns values within [min, max] inclusive", () => {
  const rng = new SeededRandom(123);
  const min = 60;
  const max = 140;
  for (let i = 0; i < 1000; i++) {
    const v = rng.nextInt(min, max);
    assert.ok(v >= min, `${v} should be >= ${min}`);
    assert.ok(v <= max, `${v} should be <= ${max}`);
    assert.equal(v, Math.floor(v)); // must be an integer
  }
});

test("nextInt with min === max returns that value", () => {
  const rng = new SeededRandom(5);
  for (let i = 0; i < 10; i++) {
    assert.equal(rng.nextInt(50, 50), 50);
  }
});

test("nextInt range covers both endpoints over many draws", () => {
  const rng = new SeededRandom(9999);
  let sawMin = false;
  let sawMax = false;
  for (let i = 0; i < 10000; i++) {
    const v = rng.nextInt(0, 1);
    if (v === 0) sawMin = true;
    if (v === 1) sawMax = true;
    if (sawMin && sawMax) break;
  }
  assert.ok(sawMin, "should generate the minimum value");
  assert.ok(sawMax, "should generate the maximum value");
});

test("entropy-seeded instance produces values in [0, 1)", () => {
  // No seed argument — uses internal entropy; just verify valid output
  const rng = new SeededRandom();
  for (let i = 0; i < 100; i++) {
    const v = rng.nextFloat();
    assert.ok(v >= 0 && v < 1);
  }
});

test("SeededRandom implements RandomSource interface structurally", () => {
  const rng = new SeededRandom(1);
  assert.equal(typeof rng.nextFloat, "function");
  assert.equal(typeof rng.nextInt, "function");
});

test("golden sequence: seed=42 produces specific known values (PRNG regression guard)", () => {
  const rng = new SeededRandom(42);
  // These values are derived from mulberry32 with seed=42.
  // Any change to the PRNG algorithm will fail here with a concrete diff.
  assert.equal(rng.nextFloat(), 0.6011037519201636);
  assert.equal(rng.nextFloat(), 0.44829055899754167);
  assert.equal(rng.nextInt(60, 140), 129);
  assert.equal(rng.nextFloat(), 0.6697340414393693);
  assert.equal(rng.nextInt(0, 1), 0);
});

test("mixed nextFloat and nextInt calls are reproducible across two same-seed instances", () => {
  const a = new SeededRandom(333);
  const b = new SeededRandom(333);
  for (let i = 0; i < 30; i++) {
    if (i % 3 === 0) {
      assert.equal(a.nextInt(60, 140), b.nextInt(60, 140));
    } else {
      assert.equal(a.nextFloat(), b.nextFloat());
    }
  }
});

test("seed=0 produces valid nextFloat values", () => {
  const rng = new SeededRandom(0);
  for (let i = 0; i < 50; i++) {
    const v = rng.nextFloat();
    assert.ok(v >= 0 && v < 1, `seed=0 value ${v} out of [0,1)`);
  }
});

test("seed=0xFFFFFFFF (32-bit max) produces valid nextFloat values", () => {
  const rng = new SeededRandom(0xffffffff);
  for (let i = 0; i < 50; i++) {
    const v = rng.nextFloat();
    assert.ok(v >= 0 && v < 1, `seed=0xFFFFFFFF value ${v} out of [0,1)`);
  }
});

test("non-integer seed is truncated to 32-bit integer (>>> 0)", () => {
  // US-022 reads the seed from a URL parameter (parseInt/Number), so a
  // float like 42.9 must produce the same stream as the integer 42.
  const a = new SeededRandom(42.9);
  const b = new SeededRandom(42);
  for (let i = 0; i < 20; i++) {
    assert.equal(a.nextFloat(), b.nextFloat());
  }
});

test("seed is recoverable and stays fixed as the stream advances (US-022 shareable seed)", () => {
  // US-022 reflects the seed that produced a walk into a ?seed= URL, so the seed must be readable
  // off the source AND must not drift as numbers are drawn (the PRNG state advances; the seed does not).
  const rng = new SeededRandom(2026);
  assert.equal(rng.seed, 2026, "seed is recoverable immediately after construction");
  for (let i = 0; i < 50; i++) rng.nextFloat();
  assert.equal(rng.seed, 2026, "seed is unchanged after the stream has advanced");
});

test("seed is canonicalised to a uint32 (>>> 0), so the reflected URL value round-trips", () => {
  // The composition root reflects source.seed into the URL; URLSearchParams round-trips it as a
  // base-10 string, so the canonical value must be a non-negative 32-bit integer.
  assert.equal(new SeededRandom(42).seed, 42, "an in-range seed is reported unchanged");
  assert.equal(new SeededRandom(42.9).seed, 42, "a float seed is truncated to its 32-bit integer");
  assert.equal(new SeededRandom(-1).seed, 0xffffffff, "a negative seed wraps to its uint32");
  // Two seeds 2^32 apart map to the same canonical seed AND the same stream.
  const a = new SeededRandom(7);
  const b = new SeededRandom(7 + 2 ** 32);
  assert.equal(a.seed, b.seed, "seeds 2^32 apart share a canonical seed");
  assert.equal(a.nextFloat(), b.nextFloat(), "...and therefore the same stream");
});

test("entropy-seeded instance still reports a recoverable uint32 seed", () => {
  const rng = new SeededRandom();
  assert.ok(Number.isInteger(rng.seed) && rng.seed >= 0 && rng.seed <= 0xffffffff, "entropy seed is a uint32");
  // A second SeededRandom built from the recovered seed reproduces the entropy stream exactly —
  // this is exactly how a shared ?seed= URL reproduces an originally-entropy-seeded walk (US-022).
  const replay = new SeededRandom(rng.seed);
  for (let i = 0; i < 20; i++) {
    assert.equal(replay.nextFloat(), rng.nextFloat());
  }
});

test("nextInt distributes roughly uniformly across [0, 4]", () => {
  const rng = new SeededRandom(777);
  const buckets = [0, 0, 0, 0, 0];
  const draws = 5000;
  for (let i = 0; i < draws; i++) {
    buckets[rng.nextInt(0, 4)]++;
  }
  // Each bucket should have ~1000 hits; allow generous ±25% tolerance.
  for (let v = 0; v <= 4; v++) {
    assert.ok(
      buckets[v] >= 750 && buckets[v] <= 1250,
      `bucket[${v}]=${buckets[v]} deviates too far from expected ~1000`,
    );
  }
});
