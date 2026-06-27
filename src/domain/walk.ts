import { Waypoint } from "./waypoint.js";
import { Segment } from "./segment.js";
import { Bounds } from "./bounds.js";
import { checkLayout, LayoutViolation } from "./layout-rules.js";

/**
 * The `Walk` aggregate root. Always valid by construction (docs/adr/0004): `Walk.create`
 * derives the path segments from consecutive waypoints, composes the layout-rules predicates
 * (plus structural well-formedness) into a single invariant, and **throws** on any violation.
 *
 * There is deliberately no `isValid()` — an existing `Walk` instance cannot be invalid, so no
 * caller has to remember to validate it. The aggregate is built from a *finished* placement,
 * never incrementally: the generator (US-010) works on a mutable placement buffer and wraps the
 * completed positions here at the very end. There is no draft `Walk`.
 *
 * All coordinates are generation-space px; the A4 cap and viewport fit are renderer-adapter
 * transforms only (docs/adr/0005), so the bounding box and cumulative distances exposed here
 * are stable, untransformed generation-space values.
 */
export class Walk {
  private constructor(
    /** Waypoints ordered by sequence number, 1..N. */
    readonly waypoints: ReadonlyArray<Waypoint>,
    /** Path segments; `segments[i]` joins `waypoints[i]` to `waypoints[i+1]`. Length N-1. */
    readonly segments: ReadonlyArray<Segment>,
    /** Tight generation-space bounding box around all waypoint centres. */
    readonly boundingBox: Bounds,
    /** Cumulative path distance from the start to each waypoint; `[0]` is 0. Aligned with `waypoints`. */
    readonly cumulativeDistances: ReadonlyArray<number>
  ) {}

  get waypointCount(): number {
    return this.waypoints.length;
  }

  /** Total path length from the first to the last waypoint, in generation-space px. */
  get totalDistance(): number {
    return this.cumulativeDistances[this.cumulativeDistances.length - 1];
  }

  /** Cumulative path distance from the start to the waypoint at `index` (0-based), in generation-space px. */
  cumulativeDistanceTo(index: number): number {
    if (index < 0 || index >= this.cumulativeDistances.length) {
      throw new RangeError(
        `waypoint index ${index} out of bounds (length ${this.cumulativeDistances.length})`
      );
    }
    return this.cumulativeDistances[index];
  }

  /**
   * Builds a valid `Walk` from a finished placement, or throws.
   *
   * @param waypoints ordered waypoints (sequence numbers must be 1..N with N === waypoints.length)
   * @param bounds the generation-space region the walk was placed in (the within-bounds invariant
   *               requires every waypoint to sit at least 30px inside each edge)
   */
  static create(waypoints: ReadonlyArray<Waypoint>, bounds: Bounds): Walk {
    // ---- structural well-formedness ----
    if (waypoints.length < 2) {
      throw new Error(`A Walk needs at least 2 waypoints, got ${waypoints.length}`);
    }
    const total = waypoints.length;
    waypoints.forEach((wp, i) => {
      if (wp.sequenceNumber !== i + 1) {
        throw new Error(
          `Waypoints must be ordered by sequence number: expected ${i + 1} at index ${i}, got ${wp.sequenceNumber}`
        );
      }
      if (wp.totalWaypoints !== total) {
        throw new Error(
          `Waypoint ${wp.sequenceNumber} reports totalWaypoints ${wp.totalWaypoints}, but the walk has ${total} waypoints`
        );
      }
    });

    // ---- derive path segments (orthogonality enforced by the Segment constructor) ----
    const wps: Waypoint[] = [...waypoints];
    const segments: Segment[] = [];
    for (let i = 0; i < wps.length - 1; i++) {
      segments.push(new Segment(wps[i].position, wps[i + 1].position));
    }

    // ---- layout-rules invariant (the "Iterate design" constraints, docs/adr/0004) ----
    const violations: LayoutViolation[] = checkLayout(wps, segments, bounds);
    if (violations.length > 0) {
      throw new Error(
        `Invalid Walk layout: ${violations.map(v => v.rule).join(", ")}`
      );
    }

    // ---- cumulative distance per waypoint ----
    const cumulativeDistances: number[] = [0];
    for (const seg of segments) {
      cumulativeDistances.push(cumulativeDistances[cumulativeDistances.length - 1] + seg.length);
    }

    return new Walk(wps, segments, boundingBoxOf(wps), cumulativeDistances);
  }
}

/** Tight generation-space bounding box around the waypoint centres. */
function boundingBoxOf(waypoints: ReadonlyArray<Waypoint>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wp of waypoints) {
    minX = Math.min(minX, wp.position.x);
    minY = Math.min(minY, wp.position.y);
    maxX = Math.max(maxX, wp.position.x);
    maxY = Math.max(maxY, wp.position.y);
  }
  return new Bounds(minX, minY, maxX, maxY);
}
