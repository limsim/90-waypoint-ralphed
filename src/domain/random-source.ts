export interface RandomSource {
  /** Returns a value in [0, 1). */
  nextFloat(): number;
  /** Returns an integer in [minInclusive, maxInclusive]. */
  nextInt(minInclusive: number, maxInclusive: number): number;
}
