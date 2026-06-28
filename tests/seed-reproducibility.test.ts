import test from "node:test";
import assert from "node:assert/strict";
import { SeededRandom } from "../src/domain/seeded-random.js";
import { walkGenerator, GenerationResult } from "../src/domain/walk-generator.js";
import { Walk } from "../src/domain/walk.js";

/**
 * US-022 AC5: "A headless test confirms the same seed yields an identical Walk (determinism)."
 *
 * Reproducibility is a DOMAIN guarantee — the `?seed=` URL round-trip in the adapter (read the seed,
 * `new SeededRandom(seed)`, regenerate) reproduces a walk only because the generator is fully
 * deterministic given a seeded source. These tests pin that guarantee at the domain level (the
 * adapter/URL plumbing is exercised separately by verify:controls / verify:main, which can import the
 * DOM-bound code that `tests/**` cannot). The domain stays seed-agnostic: a seed is just a number fed
 * to `SeededRandom`; nothing here knows about URLs (AC4).
 */

/** Drive the synchronous generator to completion, exactly as GenerateWalk does (minus the yields). */
function generate(seed: number, count: number): GenerationResult {
  const iterator = walkGenerator.generate(count, new SeededRandom(seed));
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

/**
 * A structural fingerprint of a Walk capturing everything AC3 lists as reproducible: every waypoint's
 * position, outbound turn and wildcard flag, plus the per-segment lengths and cumulative distances.
 * Two walks with equal fingerprints are identical waypoints/turns/segment-lengths/wildcards.
 */
function fingerprint(walk: Walk) {
  return {
    waypoints: walk.waypoints.map((wp) => ({
      seq: wp.sequenceNumber,
      x: wp.position.x,
      y: wp.position.y,
      turn: wp.outboundTurn,
      wildcard: wp.wildcard,
    })),
    segmentLengths: walk.segments.map((s) => s.length),
    cumulativeDistances: [...walk.cumulativeDistances],
  };
}

function expectWalk(result: GenerationResult): Walk {
  assert.ok(result.ok, "generation succeeded (a valid Walk to compare)");
  return (result as { ok: true; walk: Walk }).walk;
}

// The seed + count pairs the determinism checks run over (each is known to produce a valid walk).
const CASES: ReadonlyArray<readonly [number, number]> = [
  [42, 10],
  [123456789, 30],
  [2026, 90],
];

test("the same seed + count yields a byte-identical Walk (US-022 reproducibility)", () => {
  for (const [seed, count] of CASES) {
    const a = expectWalk(generate(seed, count));
    const b = expectWalk(generate(seed, count));
    assert.deepEqual(
      fingerprint(a),
      fingerprint(b),
      `seed=${seed} count=${count}: same seed reproduces the same waypoints/turns/segment-lengths/wildcards`
    );
  }
});

test("the terminal GenerationResult is fully deterministic for a fixed seed (even when it fails)", () => {
  // Determinism is not only about the happy path — the WHOLE result (success or the bounded-failure
  // signal) must be reproducible, so a shared link never diverges between loads.
  for (const [seed, count] of CASES) {
    assert.deepEqual(generate(seed, count), generate(seed, count), `seed=${seed} count=${count}: identical result objects`);
  }
});

test("different seeds (same count) produce different walks — the check is not vacuous", () => {
  const count = 30;
  const a = expectWalk(generate(1, count));
  const b = expectWalk(generate(2, count));
  assert.notDeepEqual(
    fingerprint(a),
    fingerprint(b),
    "two different seeds at the same count give different walks (so equality above is meaningful)"
  );
});

test("a seed parsed from a ?seed= URL reproduces the shared walk on reload (US-022 AC3)", () => {
  // Mirror exactly what the adapter does: parse the seed out of a query string, regenerate. The two
  // "loads" of the same link must produce the identical walk. (walk-url.ts uses a STRICTER base-10
  // gate than bare parseInt, but for this clean all-digit value the parsed result is identical.)
  const sharedLink = "?seed=305419896&count=40";
  const seed = Number.parseInt(new URLSearchParams(sharedLink).get("seed")!, 10);
  const count = Number.parseInt(new URLSearchParams(sharedLink).get("count")!, 10);

  const firstLoad = expectWalk(generate(seed, count));
  const secondLoad = expectWalk(generate(seed, count));
  assert.deepEqual(fingerprint(firstLoad), fingerprint(secondLoad), "opening the same ?seed= link twice reproduces the walk");
});

test("the seed used is recoverable from an entropy walk and reproduces it (US-022 AC3)", () => {
  // An originally entropy-seeded walk is reproducible because the seed is recoverable off the source
  // (SeededRandom.seed) — the composition root reflects exactly that value into the URL. Replaying it
  // must regenerate the identical walk.
  const count = 40;
  const source = new SeededRandom(); // entropy seed
  const recoveredSeed = source.seed;
  const original = expectWalk(
    (() => {
      const it = walkGenerator.generate(count, source);
      let step = it.next();
      while (!step.done) step = it.next();
      return step.value;
    })()
  );
  const reproduced = expectWalk(generate(recoveredSeed, count));
  assert.deepEqual(
    fingerprint(original),
    fingerprint(reproduced),
    "regenerating from the recovered entropy seed reproduces the original walk"
  );
});

test("seed canonicalisation: a seed and its uint32 wrap produce the identical walk", () => {
  // The reflected URL carries the canonical uint32 seed; a manually-supplied out-of-range seed must
  // still reproduce deterministically (SeededRandom coerces with >>> 0).
  const count = 30;
  const a = expectWalk(generate(777, count));
  const b = expectWalk(generate(777 + 2 ** 32, count));
  assert.deepEqual(fingerprint(a), fingerprint(b), "a seed and seed+2^32 yield the same walk");
});
