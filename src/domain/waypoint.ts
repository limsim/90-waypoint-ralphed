import { Point } from "./point.js";
import { Turn } from "./turn.js";

export class Waypoint {
  private constructor(
    readonly sequenceNumber: number,
    readonly position: Point,
    readonly outboundTurn: Turn | null,
    readonly wildcard: boolean
  ) {}

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
    return new Waypoint(sequenceNumber, position, outboundTurn, wildcard);
  }
}
