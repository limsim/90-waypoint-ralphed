import test from "node:test";
import assert from "node:assert/strict";
import { ClearWalk } from "../src/application/clear-walk.js";
import { Renderer, DisplayOptions } from "../src/application/renderer-port.js";
import { Walk } from "../src/domain/walk.js";
import { walkGenerator } from "../src/domain/walk-generator.js";
import { SeededRandom } from "../src/domain/seeded-random.js";

/**
 * Fake Renderer that makes the "current-walk state" inspectable: `draw` records the walk it is
 * showing, `clear` empties it. The real Canvas renderer (US-013) holds the same notion of "what
 * is currently on screen"; here we expose it so the headless test can assert the state is empty
 * after a clear (the AC), without any DOM/Canvas.
 */
class FakeRenderer implements Renderer {
  current: Walk | null = null;
  drawCalls = 0;
  clearCalls = 0;

  draw(walk: Walk, _options: DisplayOptions): void {
    this.current = walk;
    this.drawCalls++;
  }

  clear(): void {
    this.current = null;
    this.clearCalls++;
  }

  get isEmpty(): boolean {
    return this.current === null;
  }
}

const OPTIONS: DisplayOptions = { showWildcards: true, showTurns: true };

/** Build a valid Walk fixture by driving the generator to completion (same pattern as US-011 tests). */
function makeWalk(count = 10, seed = 4242): Walk {
  const gen = walkGenerator.generate(count, new SeededRandom(seed));
  let step = gen.next();
  while (!step.done) step = gen.next();
  const result = step.value;
  assert.ok(result.ok, "fixture walk should generate successfully");
  return (result as { ok: true; walk: Walk }).walk;
}

test("clear empties the current-walk state", () => {
  const renderer = new FakeRenderer();
  renderer.draw(makeWalk(), OPTIONS);
  assert.equal(renderer.isEmpty, false, "sanity: a walk is showing before clear");

  new ClearWalk(renderer).execute();

  assert.equal(renderer.isEmpty, true, "the current-walk state must be empty after clear");
  assert.equal(renderer.current, null);
});

test("clear invokes the Renderer port's clear() exactly once", () => {
  const renderer = new FakeRenderer();
  renderer.draw(makeWalk(), OPTIONS);

  new ClearWalk(renderer).execute();

  assert.equal(renderer.clearCalls, 1, "exactly one clear should reach the renderer port");
});

test("clear never draws — it only removes", () => {
  const renderer = new FakeRenderer();
  renderer.draw(makeWalk(), OPTIONS);
  const drawCallsBefore = renderer.drawCalls;

  new ClearWalk(renderer).execute();

  assert.equal(renderer.drawCalls, drawCallsBefore, "clear must not trigger any draw");
});

test("clearing an already-empty state is safe and idempotent", () => {
  const renderer = new FakeRenderer();
  const clearWalk = new ClearWalk(renderer);

  assert.equal(renderer.isEmpty, true, "starts empty (nothing ever drawn)");
  assert.doesNotThrow(() => clearWalk.execute());
  assert.equal(renderer.isEmpty, true, "still empty after clearing an empty state");

  // A second clear is still a no-op on the state; both reach the port.
  clearWalk.execute();
  assert.equal(renderer.isEmpty, true);
  assert.equal(renderer.clearCalls, 2);
});

test("execute is synchronous (returns void, not a Promise)", () => {
  // Unlike GenerateWalk.execute (async — it cooperatively yields around long generation), ClearWalk
  // has no long-running work, so execute is a plain synchronous method. US-016 (dom-controls) relies
  // on this: it calls clearWalk.execute() directly on the Clear button and before each Generate
  // without awaiting. Pin the contract so a stray `async` (which would make execute return a pending
  // Promise and silently defer the clear past the synchronous caller) is caught.
  const renderer = new FakeRenderer();
  renderer.draw(makeWalk(), OPTIONS);

  // execute(): void — capture the return as `unknown` so we can assert it is not a thenable. A
  // Promise is never `undefined`, so `=== undefined` alone proves the method is not async.
  const returned = new ClearWalk(renderer).execute() as unknown;

  assert.equal(returned, undefined, "execute must return undefined (void), i.e. not a Promise");
  assert.equal(renderer.isEmpty, true, "clear took effect synchronously, before this assertion");
});

test("clear after generate-draw-clear cycles always leaves the state empty", () => {
  // Mirrors the real flow: generate (draw) then clear, repeatedly. Each clear must reset to empty
  // regardless of the prior walk, and the use case holds no state across calls.
  const renderer = new FakeRenderer();
  const clearWalk = new ClearWalk(renderer);

  for (const [count, seed] of [[10, 1], [40, 2], [90, 3]] as const) {
    renderer.draw(makeWalk(count, seed), OPTIONS);
    assert.equal(renderer.isEmpty, false);
    clearWalk.execute();
    assert.equal(renderer.isEmpty, true, `state must be empty after clear (count=${count})`);
  }
});
