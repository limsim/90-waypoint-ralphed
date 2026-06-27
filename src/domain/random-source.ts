/**
 * Driven port for randomness (docs/adr/0003).
 *
 * The domain generator and value-object factories (e.g. `TurnSequence.random`) depend
 * only on this interface — never on `Math.random` directly — so a seedable
 * implementation (US-009) can make generation deterministic under test and reproducible
 * from a URL seed (US-022). Pure domain contract: no DOM/Canvas/node types.
 */
export interface RandomSource {
  /** A pseudo-random float in the half-open range [0, 1). */
  nextFloat(): number;

  /**
   * A pseudo-random integer in the half-open range [0, maxExclusive).
   * `maxExclusive` must be a positive integer.
   */
  nextInt(maxExclusive: number): number;
}
