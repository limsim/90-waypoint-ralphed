import { Point } from "./point.js";
import { Waypoint } from "./waypoint.js";
import { Segment } from "./segment.js";
import { Bounds } from "./bounds.js";

export const WAYPOINT_RADIUS = 25;
/**
 * Minimum *gap* (between circle edges) that two NON-adjacent waypoints must keep, so unrelated
 * parts of the walk never appear to touch (ADR-0007). Adjacent waypoints are joined by a path
 * segment and are exempt. Their centres must therefore sit at least
 * `2 * WAYPOINT_RADIUS + MIN_WAYPOINT_GAP` (70px) apart.
 */
export const MIN_WAYPOINT_GAP = 20;
export const MIN_PARALLEL_SEPARATION = 55;
export const MIN_SEGMENT_WAYPOINT_CLEARANCE = 35;
export const TURN_LABEL_OFFSET = 46;
export const TURN_LABEL_CLEARANCE = 8;
/**
 * Radius of the disc that approximates a rendered turn-label glyph (bold 16px Arial, centred). The
 * widest glyph ("W") has a bounding-box half-diagonal of ≈ 9.2px, so 10 is a deliberate slight
 * over-approximation (ADR-0008). Used to keep a label clear of non-adjacent waypoint circles.
 */
export const TURN_LABEL_RADIUS = 10;
export const BOUNDS_PADDING = 30;

// NE (45°) offset in screen coordinates (y increases downward)
const NE_DX = TURN_LABEL_OFFSET * Math.cos(Math.PI / 4);
const NE_DY = -TURN_LABEL_OFFSET * Math.sin(Math.PI / 4);

/**
 * The fixed NE (45°, 46px-from-centre) position where a waypoint's outbound turn label sits.
 * Exported so the walk-generator (US-010) computes label clearance with the exact same geometry
 * the invariant uses — there must be no divergence between the generator's hot loop and this rule.
 */
export function turnLabelPoint(position: Point): Point {
  return new Point(position.x + NE_DX, position.y + NE_DY);
}

/** No two waypoint circles (radius 25px) overlap (distance between centres < 50px). */
export function noWaypointCirclesOverlap(waypoints: Waypoint[]): boolean {
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      if (
        Math.hypot(
          waypoints[j].position.x - waypoints[i].position.x,
          waypoints[j].position.y - waypoints[i].position.y
        ) <
        2 * WAYPOINT_RADIUS
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Every NON-adjacent waypoint pair (sequence gap > 1) keeps a minimum gap: their centres are at
 * least `2 * WAYPOINT_RADIUS + MIN_WAYPOINT_GAP` (70px) apart, leaving `MIN_WAYPOINT_GAP` (20px)
 * of clear space between their circle edges. ADJACENT (consecutive) waypoints are exempt — they
 * are joined by a visible path segment and are *meant* to sit close (ADR-0007). Waypoints are
 * ordered by sequence number, so array-index neighbours (`j - i === 1`) are the adjacent pairs;
 * this is the same adjacency model the other layout rules use. The separate 50px hard-overlap
 * floor (`noWaypointCirclesOverlap`) still applies to *every* pair, adjacent included.
 */
export function nonAdjacentWaypointsKeepMinGap(waypoints: Waypoint[]): boolean {
  const minSeparation = 2 * WAYPOINT_RADIUS + MIN_WAYPOINT_GAP;
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      if (j - i === 1) continue; // adjacent — exempt
      if (
        Math.hypot(
          waypoints[j].position.x - waypoints[i].position.x,
          waypoints[j].position.y - waypoints[i].position.y
        ) < minSeparation
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * No two parallel segments with overlapping projected range are closer than 55px.
 */
export function noCloseParallelSegments(segments: Segment[]): boolean {
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const ov = segments[i].parallelOverlap(segments[j]);
      if (ov !== null && ov.overlapLength > 0 && ov.separation < MIN_PARALLEL_SEPARATION) {
        return false;
      }
    }
  }
  return true;
}

/**
 * No segment passes closer than 35px from any non-adjacent waypoint centre.
 * segments[i] is adjacent to waypoints[i] and waypoints[i+1].
 */
export function noSegmentCloseToNonAdjacentWaypoint(
  waypoints: Waypoint[],
  segments: Segment[]
): boolean {
  for (let si = 0; si < segments.length; si++) {
    for (let wi = 0; wi < waypoints.length; wi++) {
      if (wi === si || wi === si + 1) continue;
      if (segments[si].distanceFrom(waypoints[wi].position) < MIN_SEGMENT_WAYPOINT_CLEARANCE) {
        return false;
      }
    }
  }
  return true;
}

/**
 * No segment passes through a non-adjacent waypoint circle (within radius 25px of centre).
 * Same adjacency model as noSegmentCloseToNonAdjacentWaypoint.
 */
export function noSegmentThroughNonAdjacentWaypointCircle(
  waypoints: Waypoint[],
  segments: Segment[]
): boolean {
  for (let si = 0; si < segments.length; si++) {
    for (let wi = 0; wi < waypoints.length; wi++) {
      if (wi === si || wi === si + 1) continue;
      if (segments[si].distanceFrom(waypoints[wi].position) < WAYPOINT_RADIUS) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Every interior waypoint's turn-label (NE 45°, 46px from centre) has >= 8px clearance
 * from all non-adjacent segments.
 * segments[wi-1] and segments[wi] are the segments adjacent to waypoints[wi].
 */
export function turnLabelsClearOfNonAdjacentSegments(
  waypoints: Waypoint[],
  segments: Segment[]
): boolean {
  for (let wi = 0; wi < waypoints.length; wi++) {
    if (waypoints[wi].isTerminal) continue;
    const label = turnLabelPoint(waypoints[wi].position);
    for (let si = 0; si < segments.length; si++) {
      if (si === wi - 1 || si === wi) continue;
      if (segments[si].distanceFrom(label) < TURN_LABEL_CLEARANCE) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Every INTERIOR waypoint's turn-label (NE 45°, 46px from centre) keeps clear of the CIRCLE of every
 * NON-adjacent waypoint: the label point sits at least
 * `WAYPOINT_RADIUS + TURN_LABEL_RADIUS + TURN_LABEL_CLEARANCE` (25 + 10 + 8 = 43px) from that
 * waypoint's centre, so the label disc (radius `TURN_LABEL_RADIUS`) stays `TURN_LABEL_CLEARANCE`
 * clear of the 25px circle. Only interior waypoints own a label, but the PROTECTED circle may be
 * terminal — terminals are NOT skipped on the circle side. ADJACENT waypoints (`|i - j| <= 1`) are
 * exempt: they are joined by a visible path segment and are meant to sit close, and the closest such
 * case (an N/E neighbour at the 60px min segment) is ≈ 42.58px from the NE label — just inside 43px,
 * so without the exemption a legitimate placement near the 60px floor would be wrongly rejected
 * (ADR-0008). ADR-0007 gave non-adjacent *circles* a 70px centre gap, but a circle 70px out along
 * the NE ray still sits only 70 − 46 = 24px from the label; this rule closes that gap. Uses the same
 * `turnLabelPoint` geometry as the renderer, so the drawn label and this invariant never diverge.
 */
export function turnLabelsClearOfNonAdjacentWaypoints(waypoints: Waypoint[]): boolean {
  const minDistance = WAYPOINT_RADIUS + TURN_LABEL_RADIUS + TURN_LABEL_CLEARANCE;
  for (let wi = 0; wi < waypoints.length; wi++) {
    if (waypoints[wi].isTerminal) continue; // terminals own no label
    const label = turnLabelPoint(waypoints[wi].position);
    for (let j = 0; j < waypoints.length; j++) {
      if (Math.abs(j - wi) <= 1) continue; // self and adjacent neighbours are exempt
      if (
        Math.hypot(waypoints[j].position.x - label.x, waypoints[j].position.y - label.y) <
        minDistance
      ) {
        return false;
      }
    }
  }
  return true;
}

/** All waypoints lie within bounds with 30px padding from each edge. */
export function allWaypointsWithinBounds(waypoints: Waypoint[], bounds: Bounds): boolean {
  return waypoints.every(wp => bounds.contains(wp.position, BOUNDS_PADDING));
}

export interface LayoutViolation {
  rule: string;
}

/** Runs all layout constraints; returns an empty list when the layout is valid. */
export function checkLayout(
  waypoints: Waypoint[],
  segments: Segment[],
  bounds: Bounds
): LayoutViolation[] {
  const v: LayoutViolation[] = [];
  if (!noWaypointCirclesOverlap(waypoints)) v.push({ rule: "waypoint-circles-overlap" });
  if (!nonAdjacentWaypointsKeepMinGap(waypoints))
    v.push({ rule: "non-adjacent-waypoints-too-close" });
  if (!noCloseParallelSegments(segments)) v.push({ rule: "parallel-segments-too-close" });
  if (!noSegmentCloseToNonAdjacentWaypoint(waypoints, segments))
    v.push({ rule: "segment-too-close-to-waypoint" });
  if (!noSegmentThroughNonAdjacentWaypointCircle(waypoints, segments))
    v.push({ rule: "segment-through-waypoint-circle" });
  if (!turnLabelsClearOfNonAdjacentSegments(waypoints, segments))
    v.push({ rule: "turn-label-too-close-to-segment" });
  if (!turnLabelsClearOfNonAdjacentWaypoints(waypoints))
    v.push({ rule: "turn-label-too-close-to-waypoint" });
  if (!allWaypointsWithinBounds(waypoints, bounds)) v.push({ rule: "waypoint-out-of-bounds" });
  return v;
}
