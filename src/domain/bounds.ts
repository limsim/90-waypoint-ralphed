import { Point } from "./point.js";

export class Bounds {
  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly maxX: number,
    readonly maxY: number,
  ) {}

  get width(): number {
    return this.maxX - this.minX;
  }

  get height(): number {
    return this.maxY - this.minY;
  }

  contains(point: Point, padding = 0): boolean {
    return (
      point.x >= this.minX + padding &&
      point.x <= this.maxX - padding &&
      point.y >= this.minY + padding &&
      point.y <= this.maxY - padding
    );
  }

  grow(factor: number): Bounds {
    const cx = (this.minX + this.maxX) / 2;
    const cy = (this.minY + this.maxY) / 2;
    const hw = (this.width / 2) * factor;
    const hh = (this.height / 2) * factor;
    return new Bounds(cx - hw, cy - hh, cx + hw, cy + hh);
  }
}
