import { Point } from "./point.js";
import { Heading } from "./heading.js";
import { Segment } from "./segment.js";
import { Bounds } from "./bounds.js";
import { Waypoint } from "./waypoint.js";
import { Walk } from "./walk.js";
import { TurnSequence } from "./turn-sequence.js";
import { RandomSource } from "./random-source.js";
import {
  turnLabelPoint,
  WAYPOINT_RADIUS,
  MIN_PARALLEL_SEPARATION,
  MIN_SEGMENT_WAYPOINT_CLEARANCE,
  TURN_LABEL_CLEARANCE,
  BOUNDS_PADDING,
} from "./layout-rules.js";

/**
 * The core domain service that places a random turn sequence under the layout-rules spacing
 * constraints (docs/adr/0002, 0004, 0006).
 *
 * `walkGenerator.generate` is a pure synchronous **generator function** (`function*`): it touches
 * no timers and no DOM, only cooperative `yield` pause points, so it is fully deterministic given a
 * `RandomSource` and can be driven straight to completion in headless tests. It yields a small
 * progress value roughly every batch (~50 attempts, and once per re-roll) and **returns** either a
 * valid `Walk` or a failure signal once the bounded re-rolls are exhausted.
 *
 * It never builds a draft `Walk` (ADR-0004): it works on a lightweight mutable placement buffer of
 * plain `Point`s and `Segment`s, checking the *same* spacing predicates the `Walk` invariant uses,
 * and wraps the finished, valid placement into `Walk.create(...)` exactly once at the end.
 *
 * Bounded control flow guarantees termination (ADR-0002):
 *   `maxPlacementAttempts` placement attempts per bounds size
 *     → grow the bounds `growthFactor` up to `maxGrowths` times
 *       → re-randomise the entire turn sequence up to `maxRerolls` times
 *         → return a failure signal.
 */

/** A small progress value yielded during generation. The driving use case (US-011) ignores it. */
export interface GenerationProgress {
  /** Total placement attempts made so far across all sizes and re-rolls. */
  readonly attempts: number;
  /** The current re-roll index (0-based). */
  readonly rerolls: number;
}

/** The terminal result of generation: a valid `Walk`, or a failure signal. */
export type GenerationResult =
  | { readonly ok: true; readonly walk: Walk }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly attempts: number;
      readonly rerolls: number;
    };

/** Tunable bounds for the generator's loops. Defaults match ADR-0002; tests may override them. */
export interface GeneratorConfig {
  /** Placement attempts per bounds size (ADR-0002: 200). */
  readonly maxPlacementAttempts: number;
  /** How many times the bounds may grow before re-rolling the sequence (ADR-0002: ~10). */
  readonly maxGrowths: number;
  /** How many whole-sequence re-rolls before giving up (ADR-0002: ~20). */
  readonly maxRerolls: number;
  /** Minimum random segment length, px. */
  readonly minSegment: number;
  /** Maximum random segment length, px (before scaling). */
  readonly maxSegment: number;
  /** A segment may be scaled up to this multiple of its base length to satisfy spacing. */
  readonly maxScale: number;
  /** Upper bound on the placement DFS's length-choice evaluations before abandoning an attempt. */
  readonly maxPlacementSteps: number;
  /** Bounds growth factor per growth step (ADR-0002: 1.1 = +10%). */
  readonly growthFactor: number;
  /** Emit a progress value roughly every this many attempts. */
  readonly yieldEvery: number;
  /** Optional fixed initial generation region; defaults to a size derived from the count. */
  readonly initialRegion?: Bounds;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  maxPlacementAttempts: 200,
  maxGrowths: 10,
  maxRerolls: 20,
  minSegment: 60,
  maxSegment: 140,
  maxScale: 8,
  maxPlacementSteps: 6000,
  growthFactor: 1.1,
  yieldEvery: 50,
};

/** Generation-space region the first placement is sized to fit; growth handles the outliers. */
function initialRegionFor(count: number): Bounds {
  const side = Math.max(800, Math.ceil(Math.sqrt(count) * 240));
  return new Bounds(0, 0, side, side);
}

/** Number of wildcards for a walk: `max(1, round(count/9))`, clamped to the interior count. */
export function wildcardCountFor(count: number): number {
  const interior = Math.max(0, count - 2);
  return Math.min(Math.max(1, Math.round(count / 9)), interior);
}

/**
 * Pick the (0-based) interior waypoint indices that become wildcards. Interior indices are
 * `1..count-2`; a partial Fisher–Yates shuffle keeps the selection uniform and terminating.
 */
function chooseWildcards(count: number, random: RandomSource): Set<number> {
  const interior: number[] = [];
  for (let s = 1; s <= count - 2; s++) interior.push(s);
  const k = wildcardCountFor(count);
  for (let i = 0; i < k; i++) {
    const j = i + random.nextInt(0, interior.length - 1 - i);
    const tmp = interior[i];
    interior[i] = interior[j];
    interior[j] = tmp;
  }
  return new Set(interior.slice(0, k));
}

/**
 * Headings for each of the `count-1` segments. `headings[0]` is North (segment 1→2 has no turn);
 * `headings[s]` (s ≥ 1) applies the turn leaving waypoint index `s` — unless that waypoint is a
 * wildcard, in which case the heading is unchanged (the turn is skipped).
 */
function buildHeadings(
  count: number,
  sequence: TurnSequence,
  wildcards: Set<number>
): Heading[] {
  const headings: Heading[] = new Array(count - 1);
  headings[0] = Heading.North;
  for (let s = 1; s <= count - 2; s++) {
    headings[s] = wildcards.has(s)
      ? headings[s - 1]
      : headings[s - 1].apply(sequence.get(s - 1));
  }
  return headings;
}

/**
 * Does the newly-placed waypoint at `idx` (and its inbound segment `segments[idx-1]`) violate any
 * spacing rule against the already-placed prefix `positions[0..idx-1]` / `segments[0..idx-2]`?
 *
 * This is an incremental mirror of `layout-rules`: because the prefix is already mutually valid,
 * only the new waypoint and the new segment need to be checked against it. It uses the same
 * `Segment` queries, the same constants, and the same `turnLabelPoint` geometry the `Walk`
 * invariant uses, and the same adjacency model (`segments[i]` is adjacent to `waypoints[i]` and
 * `waypoints[i+1]`). The within-bounds rule is positional, so it is checked separately, after the
 * finished placement is centred in the bounds.
 */
function newWaypointConflicts(
  positions: Point[],
  segments: Segment[],
  idx: number,
  total: number
): boolean {
  const p = positions[idx];
  const newSeg = segments[idx - 1];
  const newIsInterior = idx !== 0 && idx !== total - 1;

  // (1) no two waypoint circles overlap: new waypoint vs every prior waypoint
  for (let j = 0; j < idx; j++) {
    const q = positions[j];
    if (Math.hypot(p.x - q.x, p.y - q.y) < 2 * WAYPOINT_RADIUS) return true;
  }

  // (2) no close parallel segments: new segment vs every prior segment
  for (let s = 0; s <= idx - 2; s++) {
    const ov = newSeg.parallelOverlap(segments[s]);
    if (ov !== null && ov.overlapLength > 0 && ov.separation < MIN_PARALLEL_SEPARATION) {
      return true;
    }
  }

  // (3) no segment closer than 35px to a non-adjacent waypoint centre.
  //   new segment (adjacent only to waypoints idx-1, idx) vs prior waypoints 0..idx-2
  for (let j = 0; j <= idx - 2; j++) {
    if (newSeg.distanceFrom(positions[j]) < MIN_SEGMENT_WAYPOINT_CLEARANCE) return true;
  }
  //   prior segments (each non-adjacent to the new waypoint idx) vs the new waypoint
  for (let s = 0; s <= idx - 2; s++) {
    if (segments[s].distanceFrom(p) < MIN_SEGMENT_WAYPOINT_CLEARANCE) return true;
  }
  // (The "no segment through a non-adjacent circle" 25px rule is subsumed by the 35px rule above.)

  // (4) turn labels clear of non-adjacent segments (>= 8px).
  //   the new (interior) waypoint's label vs prior non-adjacent segments 0..idx-2
  if (newIsInterior) {
    const label = turnLabelPoint(p);
    for (let s = 0; s <= idx - 2; s++) {
      if (segments[s].distanceFrom(label) < TURN_LABEL_CLEARANCE) return true;
    }
  }
  //   prior interior waypoint labels vs the new segment (skip waypoint idx-1: it is adjacent to it)
  for (let j = 1; j <= idx - 2; j++) {
    const label = turnLabelPoint(positions[j]);
    if (newSeg.distanceFrom(label) < TURN_LABEL_CLEARANCE) return true;
  }

  return false;
}

/** Candidate lengths used by the lookahead feasibility probe (does not consume randomness). */
function probeLengths(config: GeneratorConfig): number[] {
  const mid = Math.round((config.minSegment + config.maxSegment) / 2);
  return [
    config.minSegment,
    mid,
    config.maxSegment,
    config.maxSegment * 2,
    config.maxSegment * 4,
    config.maxSegment * config.maxScale,
  ];
}

/**
 * Lookahead: after tentatively committing waypoint `i`, verify a valid position still remains for
 * `i+1` (and, where it exists, `i+2`) so dead-end candidates are skipped (AC). It only probes for
 * *existence* with a fixed set of candidate lengths — it draws no randomness, keeping the committed
 * stream tied solely to committed decisions, and it writes only to scratch slots beyond `i`.
 */
function canExtend(
  positions: Point[],
  segments: Segment[],
  i: number,
  headings: Heading[],
  total: number,
  config: GeneratorConfig
): boolean {
  if (i >= total - 1) return true; // i is the last waypoint — nothing more to place
  const lengths = probeLengths(config);
  const h1 = headings[i];
  for (const l1 of lengths) {
    const p1 = positions[i].translate(h1.dx * l1, h1.dy * l1);
    positions[i + 1] = p1;
    segments[i] = new Segment(positions[i], p1);
    if (newWaypointConflicts(positions, segments, i + 1, total)) continue;
    if (i + 1 >= total - 1) return true; // i+1 is the last waypoint — one step was enough
    const h2 = headings[i + 1];
    for (const l2 of lengths) {
      const p2 = p1.translate(h2.dx * l2, h2.dy * l2);
      positions[i + 2] = p2;
      segments[i + 1] = new Segment(p1, p2);
      if (!newWaypointConflicts(positions, segments, i + 2, total)) return true;
    }
  }
  return false;
}

/**
 * Build one spacing-valid placement (relative coordinates), or `null` if no placement is found
 * within the step budget. Each segment takes a random base length in `[minSegment, maxSegment]`,
 * scalable up to `maxScale×` to clear a conflict; only the *intended* turn is ever applied (the
 * direction is fixed by the heading — scaling changes distance only; no opposite-turn / straight /
 * 180° fallback, ADR-0002).
 *
 * Placement is a depth-first search with **bounded backtracking** over each segment's length
 * multiplier: when a waypoint dead-ends (no multiplier yields a conflict-free, extendable
 * position), it backs up and re-lengthens the previous segment. Per-segment base lengths are drawn
 * once per attempt, so backtracking explores length *scalings* of a fixed random shape; fresh bases
 * (next attempt) and a fresh turn sequence (re-roll) provide the larger search. `maxPlacementSteps`
 * bounds the search so a single attempt always terminates.
 */
function placeOnce(
  count: number,
  headings: Heading[],
  random: RandomSource,
  config: GeneratorConfig
): Point[] | null {
  const positions: Point[] = new Array(count);
  const segments: Segment[] = new Array(count - 1);
  positions[0] = new Point(0, 0);

  // One random base length per segment, drawn up front in index order (keeps the random stream
  // deterministic regardless of how backtracking revisits indices).
  const base: number[] = new Array(count);
  for (let i = 1; i < count; i++) base[i] = random.nextInt(config.minSegment, config.maxSegment);

  // nextMult[i] is the next length multiplier (1..maxScale) to try when placing waypoint i.
  const nextMult: number[] = new Array(count).fill(1);
  let i = 1;
  let steps = 0;

  while (i >= 1 && i < count) {
    const heading = headings[i - 1];
    let placed = false;
    while (nextMult[i] <= config.maxScale) {
      const mult = nextMult[i]++;
      if (++steps > config.maxPlacementSteps) return null; // abandon this attempt
      const len = base[i] * mult;
      positions[i] = positions[i - 1].translate(heading.dx * len, heading.dy * len);
      segments[i - 1] = new Segment(positions[i - 1], positions[i]);
      if (newWaypointConflicts(positions, segments, i, count)) continue;
      if (!canExtend(positions, segments, i, headings, count, config)) continue;
      placed = true;
      break;
    }
    if (placed) {
      i++;
      if (i < count) nextMult[i] = 1; // a fresh set of choices for the next waypoint
    } else {
      i--; // dead-end: back up and re-lengthen the previous segment
    }
  }

  return i >= count ? positions.slice(0, count) : null;
}

/** Translate a placement so its bounding box is centred within `bounds`. */
function centreInBounds(positions: Point[], bounds: Bounds): Point[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const dx = (bounds.minX + bounds.maxX) / 2 - (minX + maxX) / 2;
  const dy = (bounds.minY + bounds.maxY) / 2 - (minY + maxY) / 2;
  return positions.map(p => p.translate(dx, dy));
}

/**
 * Does a *centred* placement fit within `bounds` with the 30px padding the within-bounds rule
 * requires? After centring this is exactly a size comparison (and equivalent to the invariant's
 * per-waypoint `contains(p, 30)` check).
 */
function fitsBounds(positions: Point[], bounds: Bounds): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return (
    maxX - minX + 2 * BOUNDS_PADDING <= bounds.width &&
    maxY - minY + 2 * BOUNDS_PADDING <= bounds.height
  );
}

/** Wrap a finished, spacing-valid, centred placement into the always-valid `Walk` aggregate. */
function buildWalk(
  positions: Point[],
  count: number,
  sequence: TurnSequence,
  wildcards: Set<number>,
  bounds: Bounds
): Walk {
  const waypoints: Waypoint[] = [];
  for (let s = 0; s < count; s++) {
    if (s === 0 || s === count - 1) {
      waypoints.push(Waypoint.create(s + 1, count, positions[s], null, false));
    } else {
      const isWildcard = wildcards.has(s);
      const turn = isWildcard ? null : sequence.get(s - 1);
      waypoints.push(Waypoint.create(s + 1, count, positions[s], turn, isWildcard));
    }
  }
  return Walk.create(waypoints, bounds);
}

function* generate(
  count: number,
  random: RandomSource,
  configOverride?: Partial<GeneratorConfig>
): Generator<GenerationProgress, GenerationResult, void> {
  if (count < 2) {
    throw new RangeError(`A walk needs at least 2 waypoints, got ${count}`);
  }
  const config: GeneratorConfig = { ...DEFAULT_CONFIG, ...configOverride };
  let attempts = 0;

  for (let reroll = 0; reroll < config.maxRerolls; reroll++) {
    yield { attempts, rerolls: reroll }; // once per re-roll

    const sequence = TurnSequence.generate(count, random);
    const wildcards = chooseWildcards(count, random);
    const headings = buildHeadings(count, sequence, wildcards);
    let bounds = config.initialRegion ?? initialRegionFor(count);

    for (let g = 0; g <= config.maxGrowths; g++) {
      let sawSpacingValid = false;
      for (let a = 0; a < config.maxPlacementAttempts; a++) {
        attempts++;
        if (attempts % config.yieldEvery === 0) yield { attempts, rerolls: reroll };

        const placement = placeOnce(count, headings, random, config);
        if (placement === null) continue; // dead-end — re-roll segment lengths
        sawSpacingValid = true;

        const centred = centreInBounds(placement, bounds);
        if (fitsBounds(centred, bounds)) {
          return { ok: true, walk: buildWalk(centred, count, sequence, wildcards, bounds) };
        }
      }
      // Placement is bounds-independent, so if no spacing-valid layout emerged at this size, a
      // bigger canvas cannot help — only a different turn sequence can. Re-roll immediately.
      if (!sawSpacingValid) break;
      if (g < config.maxGrowths) bounds = bounds.grow(config.growthFactor);
    }
  }

  return {
    ok: false,
    reason: "Exhausted all re-rolls without finding a valid walk",
    attempts,
    rerolls: config.maxRerolls,
  };
}

/** The walk-generator domain service (ADR-0002, 0004, 0006). */
export const walkGenerator = { generate };
