import { RandomSource } from "./random-source.js";

/**
 * Deterministic PRNG (mulberry32) seeded from a 32-bit integer.
 * Same seed → identical stream, so both tests (fixed seed) and production
 * (entropy-derived seed, or URL-supplied seed from US-022) share this class.
 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed?: number) {
    this.state = seed !== undefined ? seed >>> 0 : SeededRandom.entropy();
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
