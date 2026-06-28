import test from "node:test";
import assert from "node:assert/strict";
import {
  walkGenerator,
  wildcardCountFor,
  DEFAULT_CONFIG,
  GenerationResult,
  GenerationProgress,
  GeneratorConfig,
} from "../src/domain/walk-generator.js";
import { Walk } from "../src/domain/walk.js";
import { Turn } from "../src/domain/turn.js";
import { Bounds } from "../src/domain/bounds.js";
import { SeededRandom } from "../src/domain/seeded-random.js";

/** Drive the generator iterator to completion and return its final result. */
function drive(
  count: number,
  seed: number,
  config?: Partial<GeneratorConfig>
): GenerationResult {
  const gen = walkGenerator.generate(count, new SeededRandom(seed), config);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

function expectWalk(result: GenerationResult): Walk {
  assert.ok(result.ok, "expected a successful generation");
  return (result as { ok: true; walk: Walk }).walk;
}

/** Unit step (dx, dy in {-1,0,1}) of a segment's direction. */
function direction(start: { x: number; y: number }, end: { x: number; y: number }) {
  return { dx: Math.sign(end.x - start.x), dy: Math.sign(end.y - start.y) };
}

/** Rotate a screen-space unit direction (y increases downward). Right = clockwise, Left = CCW. */
/** `+ 0` normalises negative zero so deepEqual treats e.g. -0 and 0 as the same direction. */
function applyTurn(dir: { dx: number; dy: number }, turn: Turn) {
  return turn === Turn.Right
    ? { dx: -dir.dy + 0, dy: dir.dx + 0 }
    : { dx: dir.dy + 0, dy: -dir.dx + 0 };
}

// ---- termination & validity across counts (incl. 10 and 90) ----

for (const count of [10, 25, 60, 90]) {
  test(`generate(${count}) terminates and returns a valid Walk`, () => {
    const walk = expectWalk(drive(count, 4242));
    assert.ok(walk instanceof Walk);
    assert.equal(walk.waypointCount, count);
    assert.equal(walk.segments.length, count - 1);
    // Every segment joins consecutive waypoints (Walk guarantees orthogonality already).
    for (let i = 0; i < walk.segments.length; i++) {
      assert.ok(walk.segments[i].start.equals(walk.waypoints[i].position));
      assert.ok(walk.segments[i].end.equals(walk.waypoints[i + 1].position));
    }
  });
}

test("minimum walk (count=2): a single straight-North segment, no interior, no wildcards", () => {
  const walk = expectWalk(drive(2, 4242));
  assert.equal(walk.waypointCount, 2);
  assert.equal(walk.segments.length, 1);
  assert.equal(walk.waypoints.filter(w => w.wildcard).length, 0);
  // Both terminals carry no turn; the lone segment points straight North (up = decreasing y).
  assert.equal(walk.waypoints[0].outboundTurn, null);
  assert.equal(walk.waypoints[1].outboundTurn, null);
  assert.equal(walk.waypoints[0].position.x, walk.waypoints[1].position.x);
  assert.ok(walk.waypoints[1].position.y < walk.waypoints[0].position.y);
});

test("smallest interior walk (count=3): exactly one wildcard, which is the sole interior waypoint", () => {
  // wildcardCountFor(3) === 1, so the only interior waypoint (seq 2) must be the wildcard: the
  // heading is unchanged through it, giving two collinear North segments — still a valid Walk.
  const walk = expectWalk(drive(3, 4242));
  assert.equal(walk.waypointCount, 3);
  const wildcards = walk.waypoints.filter(w => w.wildcard);
  assert.equal(wildcards.length, 1);
  assert.equal(wildcards[0].sequenceNumber, 2);
  assert.equal(wildcards[0].outboundTurn, null);
});

test("produced walks are valid across many seeds (no Walk.create violation)", () => {
  // A successful result means Walk.create accepted the placement, so reaching ok===true across a
  // spread of seeds proves the generator's incremental checks agree with the Walk invariant.
  for (let seed = 1; seed <= 12; seed++) {
    const walk = expectWalk(drive(90, seed));
    assert.equal(walk.waypointCount, 90);
  }
});

// ---- determinism ----

test("a fixed seed reproduces an identical Walk", () => {
  for (const count of [10, 90]) {
    const a = expectWalk(drive(count, 999));
    const b = expectWalk(drive(count, 999));
    const shape = (w: Walk) =>
      w.waypoints.map(p => [p.position.x, p.position.y, p.outboundTurn, p.wildcard]);
    assert.deepEqual(shape(a), shape(b));
  }
});

test("different seeds generally produce different walks", () => {
  const a = expectWalk(drive(30, 1));
  const b = expectWalk(drive(30, 2));
  const shape = (w: Walk) => w.waypoints.map(p => [p.position.x, p.position.y]);
  assert.notDeepEqual(shape(a), shape(b));
});

// ---- walk shape ----

test("the walk starts facing North: segment 1->2 points straight up, no turn at waypoint 1", () => {
  const walk = expectWalk(drive(20, 7));
  const wp1 = walk.waypoints[0];
  const wp2 = walk.waypoints[1];
  assert.equal(wp1.outboundTurn, null);
  assert.equal(wp1.position.x, wp2.position.x); // vertical
  assert.ok(wp2.position.y < wp1.position.y); // North = decreasing y
});

test("first and last waypoints carry no turn and are never wildcards", () => {
  const walk = expectWalk(drive(40, 11));
  const first = walk.waypoints[0];
  const last = walk.waypoints[walk.waypointCount - 1];
  for (const wp of [first, last]) {
    assert.equal(wp.outboundTurn, null);
    assert.equal(wp.wildcard, false);
  }
});

test("there are exactly N-2 outbound decisions (turns + skipped/wildcard turns)", () => {
  for (const count of [10, 30, 90]) {
    const walk = expectWalk(drive(count, 13));
    const turns = walk.waypoints.filter(w => w.outboundTurn !== null).length;
    const wildcards = walk.waypoints.filter(w => w.wildcard).length;
    // Each interior waypoint is either a turn or a (turn-skipping) wildcard.
    assert.equal(turns + wildcards, count - 2);
  }
});

test("wildcard count is max(1, round(count/9)) and all wildcards are interior", () => {
  for (const count of [10, 18, 45, 90]) {
    const walk = expectWalk(drive(count, 21));
    const wildcards = walk.waypoints.filter(w => w.wildcard);
    assert.equal(wildcards.length, wildcardCountFor(count));
    for (const wc of wildcards) {
      assert.ok(wc.sequenceNumber >= 2 && wc.sequenceNumber <= count - 1);
      assert.equal(wc.outboundTurn, null); // a wildcard skips its turn
    }
  }
});

test("wildcard positions are randomised among the interior waypoints (vary by seed)", () => {
  // AC: wildcards are placed at *randomised* positions among waypoints 2..N-1. The existing tests
  // pin the wildcard *count* and confirm every wildcard is interior; this pins the "randomised
  // positions" half — different seeds must scatter the 10 wildcards (count=90) to different indices.
  const wildcardIndices = (seed: number) =>
    expectWalk(drive(90, seed))
      .waypoints.filter(w => w.wildcard)
      .map(w => w.sequenceNumber)
      .sort((a, b) => a - b);
  const s1 = wildcardIndices(1);
  const s2 = wildcardIndices(2);
  assert.equal(s1.length, wildcardCountFor(90));
  assert.equal(s2.length, wildcardCountFor(90));
  assert.notDeepEqual(s1, s2, "different seeds should scatter wildcards to different positions");
  for (const idx of [...s1, ...s2]) {
    assert.ok(idx >= 2 && idx <= 89, `wildcard at ${idx} must be a strictly interior waypoint`);
  }
});

test("only the intended turn is applied: each interior heading change matches its label", () => {
  // Verifies the shape rule end to end — applying a waypoint's outbound turn to its incoming
  // heading yields its outgoing heading; a wildcard leaves the heading unchanged. This rules out
  // any opposite-turn / straight / 180° fallback (ADR-0002).
  const walk = expectWalk(drive(50, 31));
  const wps = walk.waypoints;
  const segs = walk.segments;
  for (let s = 1; s <= walk.waypointCount - 2; s++) {
    const incoming = direction(segs[s - 1].start, segs[s - 1].end);
    const outgoing = direction(segs[s].start, segs[s].end);
    const wp = wps[s];
    if (wp.wildcard) {
      assert.deepEqual(outgoing, incoming, `wildcard at ${wp.sequenceNumber} should not turn`);
    } else {
      assert.ok(wp.outboundTurn !== null);
      assert.deepEqual(
        outgoing,
        applyTurn(incoming, wp.outboundTurn),
        `turn at ${wp.sequenceNumber} should rotate the heading as labelled`
      );
    }
  }
});

test("every segment length is a base in [60,140] scaled by an integer 1..8 (AC: 60-140px, up to 8x)", () => {
  // Each segment is `base * mult` with base = nextInt(60,140) and mult ∈ 1..maxScale (8). Translation
  // (centring) preserves lengths, so each finished length must admit such a decomposition.
  for (const count of [10, 60, 90]) {
    const walk = expectWalk(drive(count, 4242));
    for (const seg of walk.segments) {
      const len = seg.length;
      const decomposes = [1, 2, 3, 4, 5, 6, 7, 8].some(mult => {
        const base = len / mult;
        return Number.isInteger(base) && base >= 60 && base <= 140;
      });
      assert.ok(
        decomposes,
        `segment length ${len} is not base∈[60,140] × mult∈[1,8] (count=${count})`
      );
    }
  }
});

// ---- progress yields ----

test("the generator yields a small progress value (once per re-roll / batch)", () => {
  const gen = walkGenerator.generate(10, new SeededRandom(7));
  const first = gen.next();
  assert.equal(first.done, false);
  const progress = first.value as GenerationProgress;
  assert.equal(typeof progress.attempts, "number");
  assert.equal(typeof progress.rerolls, "number");
});

test("progress values are non-decreasing and yielded once per re-roll", () => {
  // Force the impossible-fit path so several re-rolls run; each re-roll yields once at its top.
  const gen = walkGenerator.generate(10, new SeededRandom(7), {
    initialRegion: new Bounds(0, 0, 100, 100),
    maxGrowths: 0,
    maxPlacementAttempts: 2,
    maxRerolls: 4,
  });
  const progress: GenerationProgress[] = [];
  let step = gen.next();
  while (!step.done) {
    progress.push(step.value);
    step = gen.next();
  }
  assert.ok(progress.length >= 4, "expected at least one progress value per re-roll");
  for (let i = 1; i < progress.length; i++) {
    assert.ok(progress[i].attempts >= progress[i - 1].attempts, "attempts must not decrease");
    assert.ok(progress[i].rerolls >= progress[i - 1].rerolls, "rerolls must not decrease");
  }
  // The per-re-roll yields cover re-roll indices 0..maxRerolls-1.
  assert.equal(progress[0].rerolls, 0);
  assert.ok(progress.some(p => p.rerolls === 3));
});

test("a batch progress value is yielded every ~50 attempts within a single re-roll", () => {
  // The AC requires progress "roughly every batch (~50 attempts, OR once per re-roll)". The
  // monotonicity test above covers the per-re-roll half (maxPlacementAttempts:2 never reaches a
  // batch boundary); this pins the per-batch half. A 100x100 region can never fit a 10-waypoint
  // walk (proven by the failure test below), so with growth disabled re-roll 0 runs all 120
  // placement attempts without succeeding — and the default yieldEvery=50 must emit batch yields
  // at attempts 50 and 100, both still inside re-roll 0 (rerolls stays 0).
  const gen = walkGenerator.generate(10, new SeededRandom(7), {
    initialRegion: new Bounds(0, 0, 100, 100),
    maxGrowths: 0,
    maxPlacementAttempts: 120,
    maxRerolls: 1,
  });
  const progress: GenerationProgress[] = [];
  let step = gen.next();
  while (!step.done) {
    progress.push(step.value);
    step = gen.next();
  }
  // Mid-re-roll batch yields: rerolls still 0, attempts at each multiple of yieldEvery (50).
  const batchYields = progress.filter(p => p.rerolls === 0 && p.attempts > 0);
  assert.deepEqual(
    batchYields.map(p => p.attempts),
    [50, 100],
    "expected batch progress at attempts 50 and 100 within re-roll 0"
  );
  // The terminal failure signal reports the true running total of attempts made and the re-roll
  // count consumed (US-020 surfaces these to the user) — not a stale or reset counter.
  const result = step.value as GenerationResult;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.attempts, 120); // all 120 attempts of the single re-roll were counted
    assert.equal(result.rerolls, 1); // maxRerolls re-rolls were exhausted
  }
});

// ---- failure signal ----

test("the failure signal is reachable when the bounds can never fit the walk", () => {
  // A region too small for any walk, with growth disabled, can never satisfy the within-bounds
  // rule — so the bounded loops exhaust and a failure signal is returned (the UI never hangs).
  const result = drive(10, 7, {
    initialRegion: new Bounds(0, 0, 100, 100),
    maxGrowths: 0,
    maxPlacementAttempts: 3,
    maxRerolls: 3,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /re-roll/i);
    assert.equal(result.rerolls, 3);
  }
});

test("bounds growth rescues a placement that does not fit the initial region", () => {
  // The placement is spacing-valid at any size (spacing is translation-invariant), but a 200x200
  // region is too small for a 10-waypoint walk to fit. This isolates the *middle* clause of the
  // bounded control flow (ADR-0002: grow bounds 10% up to ~10 times): with the same seed, too few
  // growths exhaust to failure while the default budget grows the canvas enough to succeed — proof
  // that growth, not just whole-sequence re-rolling, does real work. (Prior bounded tests only ever
  // exercised growth via maxGrowths:0, i.e. the failure path.)
  const base = {
    initialRegion: new Bounds(0, 0, 200, 200),
    maxPlacementAttempts: 200,
    maxRerolls: 20,
  };
  const tooFewGrowths = drive(10, 4242, { ...base, maxGrowths: 3 });
  assert.equal(tooFewGrowths.ok, false, "3 growths cannot enlarge the region enough to fit");
  const enoughGrowths = drive(10, 4242, { ...base, maxGrowths: 10 });
  const walk = expectWalk(enoughGrowths);
  assert.equal(walk.waypointCount, 10);
});

test("generation is bounded: even an impossible fit terminates (no infinite loop)", () => {
  // If this returns at all, control flow is bounded. Tight caps keep it quick.
  const result = drive(90, 1, {
    initialRegion: new Bounds(0, 0, 10, 10),
    maxGrowths: 0,
    maxPlacementAttempts: 1,
    maxRerolls: 2,
  });
  assert.equal(result.ok, false);
});

// ---- wildcardCountFor helper ----

test("DEFAULT_CONFIG matches the ADR-0002 bounded-generation budget", () => {
  // Ties the exported defaults directly to the acceptance criterion / ADR-0002 so a stray edit to
  // the loop budget is caught here rather than silently changing generation behaviour.
  assert.equal(DEFAULT_CONFIG.maxPlacementAttempts, 200); // 200 placement attempts per size
  assert.equal(DEFAULT_CONFIG.maxGrowths, 10); // grow the bounds up to ~10 times
  assert.equal(DEFAULT_CONFIG.maxRerolls, 20); // ~20 whole-sequence re-rolls
  assert.equal(DEFAULT_CONFIG.growthFactor, 1.1); // +10% per growth step
  assert.equal(DEFAULT_CONFIG.minSegment, 60); // segment length range 60..140px
  assert.equal(DEFAULT_CONFIG.maxSegment, 140);
  assert.equal(DEFAULT_CONFIG.maxScale, 8); // scalable up to 8x
});

test("wildcardCountFor: max(1, round(count/9)) clamped to the interior count", () => {
  assert.equal(wildcardCountFor(2), 0); // no interior waypoints
  assert.equal(wildcardCountFor(3), 1);
  assert.equal(wildcardCountFor(10), 1);
  assert.equal(wildcardCountFor(18), 2);
  assert.equal(wildcardCountFor(45), 5);
  assert.equal(wildcardCountFor(90), 10);
});

// ---- input guard ----

test("generate throws RangeError for fewer than 2 waypoints", () => {
  assert.throws(() => drive(1, 7), RangeError);
});

test("generate throws RangeError for a non-integer count (clear message, not 'Invalid array length')", () => {
  assert.throws(() => drive(2.5, 7), /at least 2 \(integer\) waypoints/);
});
