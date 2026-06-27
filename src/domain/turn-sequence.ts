import { Turn } from "./heading.js";
import { RandomSource } from "./random-source.js";

/**
 * The immutable, ordered list of L/R turns that defines a walk's shape.
 *
 * A walk that starts facing North goes straight from waypoint 1 to 2 (no turn at
 * waypoint 1) and stops at the last waypoint (no turn there either); a turn is applied
 * only when leaving waypoints 2..N-1. So a walk of N waypoints has exactly N-2 turns
 * (see `turnCountForWaypoints`). The generator (US-010) consumes `sequence.at(k-2)`
 * when leaving waypoint k.
 *
 * Pure domain value object — no DOM/Canvas. Equality is by contents; the turn list is
 * defensively copied in and out so instances cannot be mutated.
 */
export class TurnSequence {
  private readonly _turns: readonly Turn[];

  constructor(turns: readonly Turn[]) {
    // Defensive copy so a later mutation of the caller's array can't reach inside.
    this._turns = [...turns];
  }

  /** The turns in order. A fresh copy, so the sequence stays immutable. */
  get turns(): readonly Turn[] {
    return [...this._turns];
  }

  /** How many turns this sequence holds. */
  get length(): number {
    return this._turns.length;
  }

  /** The turn at `index` (0-based). Throws if out of range. */
  at(index: number): Turn {
    if (index < 0 || index >= this._turns.length) {
      throw new RangeError(
        `TurnSequence index ${index} out of range [0, ${this._turns.length})`,
      );
    }
    return this._turns[index];
  }

  /** Structural equality: same length and same turns in the same order. */
  equals(other: TurnSequence): boolean {
    if (other._turns.length !== this._turns.length) return false;
    return this._turns.every((t, i) => t === other._turns[i]);
  }

  /**
   * The number of turns required for a walk of `waypointCount` waypoints: N-2.
   * Throws if `waypointCount` is below 2 (a walk needs at least a start and an end).
   */
  static turnCountForWaypoints(waypointCount: number): number {
    if (!Number.isInteger(waypointCount) || waypointCount < 2) {
      throw new RangeError(
        `waypointCount must be an integer >= 2, got ${waypointCount}`,
      );
    }
    return waypointCount - 2;
  }

  /**
   * A random sequence of `length` turns drawn from the injected `random` source.
   * `length` must be a non-negative integer.
   */
  static random(length: number, random: RandomSource): TurnSequence {
    if (!Number.isInteger(length) || length < 0) {
      throw new RangeError(`length must be a non-negative integer, got ${length}`);
    }
    const turns: Turn[] = [];
    for (let i = 0; i < length; i++) {
      turns.push(random.nextInt(2) === 0 ? Turn.Left : Turn.Right);
    }
    return new TurnSequence(turns);
  }

  /**
   * A random sequence sized for a walk of `waypointCount` waypoints (N-2 turns),
   * drawn from the injected `random` source.
   */
  static randomForWaypoints(
    waypointCount: number,
    random: RandomSource,
  ): TurnSequence {
    return TurnSequence.random(
      TurnSequence.turnCountForWaypoints(waypointCount),
      random,
    );
  }
}
