export class Point {
  constructor(readonly x: number, readonly y: number) {}

  equals(other: Point): boolean {
    return this.x === other.x && this.y === other.y;
  }

  translate(dx: number, dy: number): Point {
    return new Point(this.x + dx, this.y + dy);
  }
}
