import { RandomSource } from "./random-source.js";

/**
 * Deterministic PRNG (mulberry32) seeded from a 32-bit integer.
 * Same seed → identical stream, so both tests (fixed seed) and production
 * (entropy-derived seed, or URL-supplied seed from US-022) share this class.
 */
export class SeededRandom implements RandomSource {
  private state: number;

  /**
   * The canonical 32-bit seed this stream was constructed from (the supplied seed coerced with
   * `>>> 0`, or an entropy-derived one when none was given). It is captured once at construction —
   * the mutable PRNG `state` advances on every draw, but this stays fixed — so the seed that
   * produced a walk is recoverable and can be reflected into a shareable `?seed=` URL (US-022).
   * `RandomSource` itself stays seed-agnostic; only this concrete PRNG exposes its seed.
   */
  readonly seed: number;

  constructor(seed?: number) {
    this.seed = seed !== undefined ? seed >>> 0 : SeededRandom.entropy();
    this.state = this.seed;
  }

  /** Mix current time with Math.random for unpredictable production seeds. */
  private static entropy(): number {
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  nextFloat(): number {
    // mulberry32 — fast, well-distributed 32-bit PRNG
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.nextFloat() * (maxInclusive - minInclusive + 1));
  }
}
