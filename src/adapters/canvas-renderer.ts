import { Walk } from "../domain/walk.js";
import { Waypoint } from "../domain/waypoint.js";
import { Turn } from "../domain/turn.js";
import { WAYPOINT_RADIUS, turnLabelPoint } from "../domain/layout-rules.js";
import { DisplayOptions, Renderer } from "../application/renderer-port.js";

/**
 * Canvas 2D implementation of the `Renderer` driven port (docs/adr/0003).
 *
 * This is one of the two real output boundaries of the hexagon — **all** DOM/Canvas usage for
 * drawing a walk is confined to this file. The domain hands over an always-valid {@link Walk} in
 * generation-space px; this adapter is the only place those coordinates meet a pixel surface.
 *
 * US-013 scope: the subtle grid, the connected orthogonal path, and the numbered waypoint circles.
 * US-014 adds, on top of that base picture: each interior waypoint's outbound turn label (L / R, or
 * W for a wildcard) at the fixed NE 46px-from-centre position, and an orange ring around every
 * wildcard waypoint. These two layers are toggled INDEPENDENTLY by the `DisplayOptions` — the
 * L/R/W label by `showTurns`, the orange ring by `showWildcards`. The A4 cap / uniform downscale /
 * auto-centre / viewport fit land in US-015. To keep the walk visible before US-015, `draw` applies
 * a plain translate so the padded content box starts at the canvas origin; US-015 layers the
 * scale + centre transform on top of that.
 */

/** Generation-space size of one grid cell (px). */
const GRID_CELL = 60;
/** Padding drawn around the waypoints' bounding box, on each side (px). */
const GRID_PADDING = 100;

/** Stroke widths (generation-space px; transform is 1:1 until US-015 adds scaling). */
const SEGMENT_WIDTH = 2;
const GRID_WIDTH = 1;
const WAYPOINT_BORDER_WIDTH = 2;
const WILDCARD_RING_WIDTH = 3;

/** Wildcard ring: an orange circle at radius 30px from the waypoint centre (US-014). */
const WILDCARD_RING_RADIUS = 30;

/** Colours. */
const BACKGROUND_COLOUR = "#ffffff";
const GRID_COLOUR = "#e6e6e6"; // subtle light grey
const SEGMENT_COLOUR = "#222222"; // dark grey / near-black
const TERMINAL_FILL = "#000000";
const TERMINAL_BORDER = "#ffffff";
const TERMINAL_TEXT = "#ffffff";
const WAYPOINT_FILL = "#ffffff";
const WAYPOINT_BORDER = "#000000";
const WAYPOINT_TEXT = "#000000";
const TURN_LABEL_COLOUR = "#222222"; // L / R / W labels — same dark ink as the path
const WILDCARD_RING_COLOUR = "#ff8c00"; // orange

const WAYPOINT_FONT = "bold 20px Arial";
const TURN_LABEL_FONT = "bold 16px Arial";
/** Wildcard turn label — the walker goes straight, so the skipped turn shows as a W. */
const WILDCARD_LABEL = "W";

export class CanvasRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.ctx = ctx;
  }

  /** Removes everything from the canvas (US-012 ClearWalk). */
  clear(): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Draws the full walk: white background, grid, connected orthogonal path, numbered waypoints,
   * and — toggled independently by `options` — the wildcard rings (`showWildcards`) and the
   * outbound turn labels (`showTurns`). Rings are drawn before labels so a label is never occluded
   * by a ring; both sit on top of the path and circles.
   */
  draw(walk: Walk, options: DisplayOptions): void {
    const { ctx, canvas } = this;

    // Background, in screen space (independent of the content transform).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = BACKGROUND_COLOUR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Content box = tight waypoint bounding box grown by GRID_PADDING on every side.
    const box = walk.boundingBox;
    const minX = box.minX - GRID_PADDING;
    const minY = box.minY - GRID_PADDING;
    const maxX = box.maxX + GRID_PADDING;
    const maxY = box.maxY + GRID_PADDING;

    // US-013: translate the padded content box to the canvas origin so the walk is visible
    // wherever it sits in generation space. US-015 replaces/extends this with the A4 fit transform.
    ctx.save();
    ctx.translate(-minX, -minY);

    this.drawGrid(minX, minY, maxX, maxY);
    this.drawPath(walk);
    this.drawWaypoints(walk);
    if (options.showWildcards) this.drawWildcardRings(walk);
    if (options.showTurns) this.drawTurnLabels(walk);

    ctx.restore();
  }

  /** Light-grey 60px lattice clipped to the padded content box. */
  private drawGrid(minX: number, minY: number, maxX: number, maxY: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = GRID_COLOUR;
    ctx.lineWidth = GRID_WIDTH;
    ctx.beginPath();
    // Anchor lines to a stable generation-space lattice, but keep them inside the content box.
    const firstX = Math.ceil(minX / GRID_CELL) * GRID_CELL;
    const firstY = Math.ceil(minY / GRID_CELL) * GRID_CELL;
    for (let x = firstX; x <= maxX; x += GRID_CELL) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = firstY; y <= maxY; y += GRID_CELL) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The path as a single connected polyline through the waypoint centres. Because every
   * {@link Walk} segment is purely horizontal or vertical (enforced by the Segment constructor),
   * this yields orthogonal lines with corners only at waypoints — no diagonals, no mid-segment bends.
   */
  private drawPath(walk: Walk): void {
    const { ctx } = this;
    const waypoints = walk.waypoints;
    if (waypoints.length < 2) return;
    ctx.save();
    ctx.strokeStyle = SEGMENT_COLOUR;
    ctx.lineWidth = SEGMENT_WIDTH;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(waypoints[0].position.x, waypoints[0].position.y);
    for (let i = 1; i < waypoints.length; i++) {
      ctx.lineTo(waypoints[i].position.x, waypoints[i].position.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Each waypoint as a radius-25 circle with its number centred in bold 20px Arial.
   * First + last waypoints: black fill / white border / white number; all others the inverse.
   */
  private drawWaypoints(walk: Walk): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = WAYPOINT_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = WAYPOINT_BORDER_WIDTH;
    for (const wp of walk.waypoints) {
      const terminal = wp.isTerminal;
      const { x, y } = wp.position;

      ctx.beginPath();
      ctx.arc(x, y, WAYPOINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = terminal ? TERMINAL_FILL : WAYPOINT_FILL;
      ctx.fill();
      ctx.strokeStyle = terminal ? TERMINAL_BORDER : WAYPOINT_BORDER;
      ctx.stroke();

      ctx.fillStyle = terminal ? TERMINAL_TEXT : WAYPOINT_TEXT;
      ctx.fillText(String(wp.sequenceNumber), x, y);
    }
    ctx.restore();
  }

  /**
   * An orange ring around every wildcard waypoint (radius 30px from the centre, 3px stroke).
   * Governed by `DisplayOptions.showWildcards`. The ring (r=30) sits outside the waypoint circle
   * (r=25), so it never overlaps the circle fill or its number.
   */
  private drawWildcardRings(walk: Walk): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = WILDCARD_RING_COLOUR;
    ctx.lineWidth = WILDCARD_RING_WIDTH;
    for (const wp of walk.waypoints) {
      if (!wp.wildcard) continue;
      ctx.beginPath();
      ctx.arc(wp.position.x, wp.position.y, WILDCARD_RING_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Each interior waypoint's outbound turn label — `L` / `R`, or `W` for a wildcard (the turn is
   * skipped, the walker goes straight). Drawn at the fixed NE (45°) position 46px from the centre,
   * via {@link turnLabelPoint} so the drawn position matches the layout invariant's reserved
   * clearance exactly. First and last waypoints are terminal and show no label. Governed by
   * `DisplayOptions.showTurns`.
   */
  private drawTurnLabels(walk: Walk): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = TURN_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TURN_LABEL_COLOUR;
    for (const wp of walk.waypoints) {
      const label = turnLabelText(wp);
      if (label === null) continue;
      const p = turnLabelPoint(wp.position);
      ctx.fillText(label, p.x, p.y);
    }
    ctx.restore();
  }
}

/**
 * The outbound turn label for a waypoint, or `null` when none should be shown.
 * Terminals (first/last) have no outbound turn → no label. A wildcard shows `W` (its turn is
 * skipped). Otherwise the label is `L` / `R` from the outbound turn.
 */
function turnLabelText(wp: Waypoint): string | null {
  if (wp.isTerminal) return null;
  if (wp.wildcard) return WILDCARD_LABEL;
  switch (wp.outboundTurn) {
    case Turn.Left:
      return "L";
    case Turn.Right:
      return "R";
    default:
      return null;
  }
}
