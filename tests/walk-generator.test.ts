import test from "node:test";
import assert from "node:assert/strict";
import {
  walkGenerator,
  wildcardCountFor,
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

// ---- progress yields ----

test("the generator yields a small progress value (once per re-roll / batch)", () => {
  const gen = walkGenerator.generate(10, new SeededRandom(7));
  const first = gen.next();
  assert.equal(first.done, false);
  const progress = first.value as GenerationProgress;
  assert.equal(typeof progress.attempts, "number");
  assert.equal(typeof progress.rerolls, "number");
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
