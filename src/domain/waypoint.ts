import { Point } from "./point.js";
import { Turn } from "./turn.js";

export class Waypoint {
  private constructor(
    readonly sequenceNumber: number,
    readonly totalWaypoints: number,
    readonly position: Point,
    readonly outboundTurn: Turn | null,
    readonly wildcard: boolean
  ) {}

  get isFirst(): boolean {
    return this.sequenceNumber === 1;
  }

  get isLast(): boolean {
    return this.sequenceNumber === this.totalWaypoints;
  }

  get isTerminal(): boolean {
    return this.isFirst || this.isLast;
  }

  get isInterior(): boolean {
    return !this.isTerminal;
  }

  static create(
    sequenceNumber: number,
    totalWaypoints: number,
    position: Point,
    outboundTurn: Turn | null,
    wildcard: boolean
  ): Waypoint {
    if (totalWaypoints < 2) {
      throw new RangeError("totalWaypoints must be at least 2");
    }
    if (sequenceNumber < 1 || sequenceNumber > totalWaypoints) {
      throw new RangeError(
        `sequenceNumber ${sequenceNumber} out of range [1..${totalWaypoints}]`
      );
    }
    const isTerminal = sequenceNumber === 1 || sequenceNumber === totalWaypoints;
    if (isTerminal && outboundTurn !== null) {
      throw new Error("First and last waypoints must not have an outbound turn");
    }
    if (isTerminal && wildcard) {
      throw new Error("First and last waypoints cannot be wildcards");
    }
    if (wildcard && outboundTurn !== null) {
      throw new Error("Wildcard waypoints must have no outbound turn (turn is skipped)");
    }
    return new Waypoint(sequenceNumber, totalWaypoints, position, outboundTurn, wildcard);
  }
}
