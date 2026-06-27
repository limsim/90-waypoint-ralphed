import { Point } from "./point.js";
import { Waypoint } from "./waypoint.js";
import { Segment } from "./segment.js";
import { Bounds } from "./bounds.js";

export const WAYPOINT_RADIUS = 25;
export const MIN_PARALLEL_SEPARATION = 55;
export const MIN_SEGMENT_WAYPOINT_CLEARANCE = 35;
export const TURN_LABEL_OFFSET = 46;
export const TURN_LABEL_CLEARANCE = 8;
export const BOUNDS_PADDING = 30;

// NE (45°) offset in screen coordinates (y increases downward)
const NE_DX = TURN_LABEL_OFFSET * Math.cos(Math.PI / 4);
const NE_DY = -TURN_LABEL_OFFSET * Math.sin(Math.PI / 4);

function turnLabelPoint(wp: Waypoint): Point {
  return new Point(wp.position.x + NE_DX, wp.position.y + NE_DY);
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
    const label = turnLabelPoint(waypoints[wi]);
    for (let si = 0; si < segments.length; si++) {
      if (si === wi - 1 || si === wi) continue;
      if (segments[si].distanceFrom(label) < TURN_LABEL_CLEARANCE) {
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
  if (!noCloseParallelSegments(segments)) v.push({ rule: "parallel-segments-too-close" });
  if (!noSegmentCloseToNonAdjacentWaypoint(waypoints, segments))
    v.push({ rule: "segment-too-close-to-waypoint" });
  if (!noSegmentThroughNonAdjacentWaypointCircle(waypoints, segments))
    v.push({ rule: "segment-through-waypoint-circle" });
  if (!turnLabelsClearOfNonAdjacentSegments(waypoints, segments))
    v.push({ rule: "turn-label-too-close-to-segment" });
  if (!allWaypointsWithinBounds(waypoints, bounds)) v.push({ rule: "waypoint-out-of-bounds" });
  return v;
}
