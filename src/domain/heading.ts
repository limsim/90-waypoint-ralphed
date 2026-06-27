import { Turn } from "./turn.js";

export class Heading {
  static readonly North = new Heading(0, -1);
  static readonly East  = new Heading(1,  0);
  static readonly South = new Heading(0,  1);
  static readonly West  = new Heading(-1, 0);

  private static readonly ALL: Heading[] = [
    Heading.North,
    Heading.East,
    Heading.South,
    Heading.West,
  ];

  private constructor(readonly dx: number, readonly dy: number) {}

  apply(turn: Turn): Heading {
    const idx = Heading.ALL.indexOf(this);
    // Right (CW) = +1 step; Left (CCW) = -1 step = +3 mod 4
    const delta = turn === Turn.Right ? 1 : 3;
    return Heading.ALL[(idx + delta) % 4];
  }
}
