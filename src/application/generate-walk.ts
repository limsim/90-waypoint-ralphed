import { RandomSource } from "../domain/random-source.js";
import {
  walkGenerator,
  GenerationResult,
  GeneratorConfig,
} from "../domain/walk-generator.js";
import { Yield } from "./yield-port.js";

/**
 * Application use case: generate a fresh randomised walk in response to a user action
 * (docs/adr/0003, 0006).
 *
 * The walk-generator is a *synchronous* generator function (`function*`) — driving it straight to
 * completion would block the event loop for the whole (potentially multi-millisecond) generation,
 * freezing the page so the loading overlay never paints. This use case instead drives the iterator
 * one step at a time, `await`ing the injected {@link Yield} port between batches so the browser can
 * paint the overlay and animate its (CSS) spinner before the next synchronous chunk of placement
 * work runs.
 *
 * It depends only on the domain and on ports — no DOM, no Canvas, no timers — so it is fully
 * deterministic under a seeded {@link RandomSource} and an immediate Yield, and testable headlessly.
 *
 * The progress value the generator yields is deliberately ignored: the overlay is a pure-CSS
 * animation, so freeing the event loop is all the UI needs. The terminal {@link GenerationResult}
 * is returned verbatim — `{ ok: true, walk }` on success, or the `{ ok: false, reason, ... }`
 * failure signal for the caller (US-020) to render as an error. Generation is bounded (ADR-0002),
 * so this method always settles; it never hangs.
 */
export class GenerateWalk {
  constructor(private readonly eventLoopYield: Yield) {}

  /**
   * Drive a single generation to completion.
   *
   * @param count  number of waypoints (>= 2 integer; the generator throws a `RangeError` otherwise,
   *               which surfaces here as a rejected promise).
   * @param random the per-generation random stream; a fresh seeded source makes the walk
   *               reproducible (US-022) and keeps this use case seed-agnostic.
   * @param config optional generator-budget override, forwarded verbatim — mainly for tests that
   *               need to force the bounded failure path deterministically.
   */
  async execute(
    count: number,
    random: RandomSource,
    config?: Partial<GeneratorConfig>
  ): Promise<GenerationResult> {
    const iterator = walkGenerator.generate(count, random, config);
    let step = iterator.next();
    while (!step.done) {
      // Ignore the yielded progress value; just hand the event loop back so the overlay can paint.
      await this.eventLoopYield.yieldToEventLoop();
      step = iterator.next();
    }
    return step.value;
  }
}
