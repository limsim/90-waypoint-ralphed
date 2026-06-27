import { Point } from "./point.js";

/** Whether a segment runs along the x-axis (horizontal) or the y-axis (vertical). */
export enum Orientation {
  Horizontal = "horizontal",
  Vertical = "vertical",
}

/**
 * The result of querying two parallel segments for how they run alongside each other.
 *
 * `overlapStart`/`overlapEnd` describe the shared interval along the segments' common
 * axis (x for two horizontals, y for two verticals); a single shared coordinate is a
 * zero-length but still-present overlap (`overlapStart === overlapEnd`). `separation`
 * is the perpendicular gap between the two parallel lines.
 */
export interface ParallelOverlap {
  readonly overlapStart: number;
  readonly overlapEnd: number;
  readonly separation: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * An immutable straight orthogonal segment joining two Points.
 *
 * A segment is always strictly horizontal or strictly vertical — construction rejects
 * diagonals (both axes differ) and degenerate zero-length segments (neither differs),
 * so `orientation` is always unambiguous. Generation-space coordinates only, no
 * DOM/Canvas. Screen-style axes (x right, y down) per the rest of the domain.
 */
export class Segment {
  /** Horizontal when the endpoints share a y; vertical when they share an x. */
  readonly orientation: Orientation;

  constructor(
    readonly a: Point,
    readonly b: Point,
  ) {
    const sameX = a.x === b.x;
    const sameY = a.y === b.y;
    // Exactly one axis must differ: sameX===sameY catches both diagonals
    // (neither matches) and degenerate points (both match).
    if (sameX === sameY) {
      throw new Error(
        `Segment must be strictly horizontal or vertical: (${a.x},${a.y})->(${b.x},${b.y})`,
      );
    }
    this.orientation = sameY ? Orientation.Horizontal : Orientation.Vertical;
  }

  /** Orthogonal length (Euclidean == Manhattan since one axis is constant). */
  get length(): number {
    return Math.abs(this.b.x - this.a.x) + Math.abs(this.b.y - this.a.y);
  }

  private get minX(): number {
    return Math.min(this.a.x, this.b.x);
  }

  private get maxX(): number {
    return Math.max(this.a.x, this.b.x);
  }

  private get minY(): number {
    return Math.min(this.a.y, this.b.y);
  }

  private get maxY(): number {
    return Math.max(this.a.y, this.b.y);
  }

  /**
   * Shortest distance from this segment to `point`. Projects the point onto the
   * segment, clamped to the endpoints; because one axis range is degenerate the
   * single clamp handles both orientations. Returns 0 for a point on the segment.
   */
  distanceToPoint(point: Point): number {
    const nearestX = clamp(point.x, this.minX, this.maxX);
    const nearestY = clamp(point.y, this.minY, this.maxY);
    return Math.hypot(point.x - nearestX, point.y - nearestY);
  }

  /**
   * If `other` is parallel to this segment (same orientation) and their ranges
   * overlap, returns the overlapping interval and the perpendicular separation
   * between the two parallel lines; otherwise returns null (perpendicular, or
   * parallel but with disjoint ranges). A shared endpoint counts as overlap.
   */
  parallelOverlap(other: Segment): ParallelOverlap | null {
    if (this.orientation !== other.orientation) return null;

    if (this.orientation === Orientation.Horizontal) {
      const overlapStart = Math.max(this.minX, other.minX);
      const overlapEnd = Math.min(this.maxX, other.maxX);
      if (overlapStart > overlapEnd) return null;
      return { overlapStart, overlapEnd, separation: Math.abs(this.a.y - other.a.y) };
    }

    const overlapStart = Math.max(this.minY, other.minY);
    const overlapEnd = Math.min(this.maxY, other.maxY);
    if (overlapStart > overlapEnd) return null;
    return { overlapStart, overlapEnd, separation: Math.abs(this.a.x - other.a.x) };
  }
}
