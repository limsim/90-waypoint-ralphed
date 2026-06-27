import test from "node:test";
import assert from "node:assert/strict";
import { GenerateWalk } from "../src/application/generate-walk.js";
import { Yield } from "../src/application/yield-port.js";
import {
  walkGenerator,
  GenerationResult,
  GeneratorConfig,
} from "../src/domain/walk-generator.js";
import { Walk } from "../src/domain/walk.js";
import { Bounds } from "../src/domain/bounds.js";
import { SeededRandom } from "../src/domain/seeded-random.js";

// ---- test doubles for the Yield port ----

/** Immediate, no-op Yield: resolves on a microtask without touching any real timer. */
const immediateYield: Yield = { yieldToEventLoop: () => Promise.resolve() };

/** Records how many times the use case handed control back to the event loop. */
class CountingYield implements Yield {
  calls = 0;
  async yieldToEventLoop(): Promise<void> {
    this.calls++;
  }
}

/** A generation config small enough to never fit a walk, so the bounded re-rolls exhaust. */
const EXHAUSTING_CONFIG: Partial<GeneratorConfig> = {
  initialRegion: new Bounds(0, 0, 100, 100),
  maxGrowths: 0,
  maxPlacementAttempts: 3,
  maxRerolls: 3,
};

function expectWalk(result: GenerationResult): Walk {
  assert.ok(result.ok, "expected a successful generation");
  return (result as { ok: true; walk: Walk }).walk;
}

/** Drive the raw generator synchronously to completion — the reference the use case must match. */
function driveGeneratorDirectly(
  count: number,
  seed: number,
  config?: Partial<GeneratorConfig>
): GenerationResult {
  const gen = walkGenerator.generate(count, new SeededRandom(seed), config);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

const shape = (w: Walk) =>
  w.waypoints.map(p => [p.position.x, p.position.y, p.outboundTurn, p.wildcard]);

// ---- success path ----

for (const count of [10, 90]) {
  test(`execute returns a valid Walk on success (count=${count})`, async () => {
    const useCase = new GenerateWalk(immediateYield);
    const result = await useCase.execute(count, new SeededRandom(4242));
    const walk = expectWalk(result);
    assert.ok(walk instanceof Walk);
    assert.equal(walk.waypointCount, count);
    assert.equal(walk.segments.length, count - 1);
  });
}

test("execute hands control back to the Yield port at least once during a generation", async () => {
  // The whole point of the use case is to free the event loop so the overlay can paint; prove the
  // injected port is actually awaited rather than the iterator being drained synchronously.
  const counting = new CountingYield();
  const useCase = new GenerateWalk(counting);
  expectWalk(await useCase.execute(10, new SeededRandom(4242)));
  assert.ok(counting.calls >= 1, "yieldToEventLoop should be awaited at least once");
});

test("the use case is a faithful driver: same result as driving the generator directly", async () => {
  // The async wrapper must not perturb the random stream or the outcome — for the same seed it must
  // produce exactly the walk the synchronous generator produces. (Also demonstrates the yielded
  // progress value is discarded: the result carries only the walk, never any progress.)
  const useCase = new GenerateWalk(immediateYield);
  for (const count of [10, 90]) {
    const viaUseCase = expectWalk(await useCase.execute(count, new SeededRandom(31)));
    const direct = expectWalk(driveGeneratorDirectly(count, 31));
    assert.deepEqual(shape(viaUseCase), shape(direct));
  }
});

test("a fixed seed reproduces an identical Walk through the use case (determinism)", async () => {
  const useCase = new GenerateWalk(immediateYield);
  const a = expectWalk(await useCase.execute(40, new SeededRandom(999)));
  const b = expectWalk(await useCase.execute(40, new SeededRandom(999)));
  assert.deepEqual(shape(a), shape(b));
});

// ---- failure path ----

test("execute surfaces the failure signal when the bounded re-rolls are exhausted", async () => {
  // The walk can never fit the tiny region and growth is disabled, so the generator exhausts its
  // re-rolls and returns a failure signal — which the use case must surface (not throw, not hang).
  const useCase = new GenerateWalk(immediateYield);
  const result = await useCase.execute(10, new SeededRandom(7), EXHAUSTING_CONFIG);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /re-roll/i);
    assert.equal(result.rerolls, 3);
  }
});

test("execute yields between batches across multiple re-rolls on the failure path", async () => {
  // The failure path runs several re-rolls; the use case must await the Yield port on each so the
  // UI keeps breathing throughout a long, ultimately-failing generation rather than blocking once.
  const counting = new CountingYield();
  const useCase = new GenerateWalk(counting);
  const result = await useCase.execute(10, new SeededRandom(7), EXHAUSTING_CONFIG);
  assert.equal(result.ok, false);
  assert.ok(counting.calls >= 3, "expected at least one yield per re-roll on the failure path");
});

// ---- input-guard propagation ----

test("execute rejects with RangeError for fewer than 2 waypoints", async () => {
  const useCase = new GenerateWalk(immediateYield);
  await assert.rejects(() => useCase.execute(1, new SeededRandom(7)), RangeError);
});

test("execute rejects with a clear RangeError for a non-integer count", async () => {
  const useCase = new GenerateWalk(immediateYield);
  await assert.rejects(
    () => useCase.execute(2.5, new SeededRandom(7)),
    /at least 2 \(integer\) waypoints/
  );
});
