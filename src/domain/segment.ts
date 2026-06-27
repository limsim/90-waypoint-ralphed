import { Point } from "./point.js";

export type Orientation = "horizontal" | "vertical";

export class Segment {
  readonly start: Point;
  readonly end: Point;
  readonly orientation: Orientation;
  readonly length: number;

  constructor(start: Point, end: Point) {
    const horizontal = start.y === end.y;
    const vertical = start.x === end.x;
    if (!horizontal && !vertical) {
      throw new Error("Segment must be horizontal or vertical, not diagonal");
    }
    if (start.equals(end)) {
      throw new Error("Segment must have non-zero length");
    }
    this.start = start;
    this.end = end;
    this.orientation = horizontal ? "horizontal" : "vertical";
    this.length = horizontal
      ? Math.abs(end.x - start.x)
      : Math.abs(end.y - start.y);
  }

  distanceFrom(point: Point): number {
    if (this.orientation === "horizontal") {
      const minX = Math.min(this.start.x, this.end.x);
      const maxX = Math.max(this.start.x, this.end.x);
      const y = this.start.y;
      if (point.x < minX) return Math.hypot(point.x - minX, point.y - y);
      if (point.x > maxX) return Math.hypot(point.x - maxX, point.y - y);
      return Math.abs(point.y - y);
    } else {
      const minY = Math.min(this.start.y, this.end.y);
      const maxY = Math.max(this.start.y, this.end.y);
      const x = this.start.x;
      if (point.y < minY) return Math.hypot(point.x - x, point.y - minY);
      if (point.y > maxY) return Math.hypot(point.x - x, point.y - maxY);
      return Math.abs(point.x - x);
    }
  }

  /** Returns null when the segments have different orientations (not parallel). */
  parallelOverlap(
    other: Segment
  ): { overlapLength: number; separation: number } | null {
    if (this.orientation !== other.orientation) return null;
    if (this.orientation === "horizontal") {
      const separation = Math.abs(this.start.y - other.start.y);
      const min1 = Math.min(this.start.x, this.end.x);
      const max1 = Math.max(this.start.x, this.end.x);
      const min2 = Math.min(other.start.x, other.end.x);
      const max2 = Math.max(other.start.x, other.end.x);
      const overlapLength = Math.max(0, Math.min(max1, max2) - Math.max(min1, min2));
      return { overlapLength, separation };
    } else {
      const separation = Math.abs(this.start.x - other.start.x);
      const min1 = Math.min(this.start.y, this.end.y);
      const max1 = Math.max(this.start.y, this.end.y);
      const min2 = Math.min(other.start.y, other.end.y);
      const max2 = Math.max(other.start.y, other.end.y);
      const overlapLength = Math.max(0, Math.min(max1, max2) - Math.max(min1, min2));
      return { overlapLength, separation };
    }
  }
}
