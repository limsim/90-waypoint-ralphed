import { Point } from "./point.js";

/**
 * A 90° turn applied when leaving a waypoint.
 *
 * The values "L" / "R" double as the renderer's labels (US-014). Left rotates the
 * heading counter-clockwise and Right clockwise, as seen on screen.
 */
export enum Turn {
  Left = "L",
  Right = "R",
}

/**
 * One of the four cardinal headings in the domain's generation-space.
 *
 * Screen-style axes: x increases to the right, y increases downward, so North
 * points up (decreasing y). Headings are value objects: use the four canonical
 * singletons (`Heading.North`, …) — the constructor is private so equality is
 * identity. Pure domain — no DOM/Canvas.
 */
export class Heading {
  private constructor(
    /** Human-readable cardinal name, e.g. for debugging/rendering. */
    readonly name: "North" | "East" | "South" | "West",
    /** Position in clockwise order: 0=N, 1=E, 2=S, 3=W. */
    private readonly index: number,
    private readonly dx: number,
    private readonly dy: number,
  ) {}

  static readonly North = new Heading("North", 0, 0, -1);
  static readonly East = new Heading("East", 1, 1, 0);
  static readonly South = new Heading("South", 2, 0, 1);
  static readonly West = new Heading("West", 3, -1, 0);

  /** The four headings in clockwise order, starting at North. */
  private static readonly CLOCKWISE: readonly Heading[] = [
    Heading.North,
    Heading.East,
    Heading.South,
    Heading.West,
  ];

  /**
   * The unit step vector (length 1) for travelling one step in this heading,
   * expressed as a Point offset under screen-style axes (y down).
   */
  get unitStep(): Point {
    return new Point(this.dx, this.dy);
  }

  /**
   * The heading after applying `turn`: Left rotates 90° counter-clockwise,
   * Right rotates 90° clockwise. Returns the canonical singleton.
   */
  turn(turn: Turn): Heading {
    const delta = turn === Turn.Right ? 1 : -1;
    const next = (this.index + delta + 4) % 4;
    return Heading.CLOCKWISE[next];
  }
}
