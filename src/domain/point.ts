/**
 * An immutable point in the domain's single generation-space coordinate system.
 *
 * Screen-style axes: x increases to the right, y increases downward (so North,
 * per US-003, points up / decreasing y). Pure value object — no DOM/Canvas.
 */
export class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  /** Structural equality: two points are equal when both coordinates match. */
  equals(other: Point): boolean {
    return this.x === other.x && this.y === other.y;
  }

  /** A new Point translated by (dx, dy); the original is unchanged. */
  translate(dx: number, dy: number): Point {
    return new Point(this.x + dx, this.y + dy);
  }
}
