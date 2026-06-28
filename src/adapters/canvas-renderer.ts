import { Walk } from "../domain/walk.js";
import { Waypoint } from "../domain/waypoint.js";
import { Turn } from "../domain/turn.js";
import { WAYPOINT_RADIUS, turnLabelPoint } from "../domain/layout-rules.js";
import { DisplayOptions } from "../application/renderer-port.js";
import { InteractiveRenderer } from "./interactive-renderer.js";

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
 * L/R/W label by `showTurns`, the orange ring by `showWildcards`.
 *
 * US-015 adds the A4 cap / uniform downscale / auto-centre (docs/adr/0005). The padded content box
 * is uniformly scaled DOWN to fit the A4 backing store (794×1123 @ 96 PPI) when it exceeds those
 * dimensions, never scaled UP (small walks keep their natural size), then centred so the whole route
 * is visible. This is a pure adapter transform built from `ctx.translate`/`ctx.scale` — the domain's
 * generation-space coordinates are never mutated. The complementary viewport fit (CSS-scaling the
 * canvas ELEMENT down when the window is narrower than 794px) is a stylesheet concern in index.html
 * (`canvas { max-width: 100%; height: auto }`), not a Canvas-2D drawing transform, so it lives there.
 *
 * US-017 makes the renderer pointer-interactive (it implements {@link InteractiveRenderer}, an
 * adapter-layer extension of the port — picking/hover are view concerns no use case needs). It
 * remembers the last walk + A4-fit transform so {@link hitTest} can invert BOTH transforms (the CSS
 * element scale and the A4 fit) to map a viewport click to a waypoint, and {@link highlight} can
 * re-render the same picture with one waypoint emphasised (drop shadow + 4px incident segments).
 */

/** Generation-space size of one grid cell (px). */
const GRID_CELL = 60;
/** Padding drawn around the waypoints' bounding box, on each side (px). */
const GRID_PADDING = 100;

/**
 * A4 at 96 PPI (px). The rendered output is capped to a single A4 page (US-015 / docs/adr/0005): the
 * padded content box is uniformly downscaled to fit within these dimensions when it is larger.
 */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/** Stroke widths (generation-space px; transform is 1:1 until US-015 adds scaling). */
const SEGMENT_WIDTH = 2;
const GRID_WIDTH = 1;
const WAYPOINT_BORDER_WIDTH = 2;
const WILDCARD_RING_WIDTH = 3;

/**
 * Hover highlight (US-017). The hovered waypoint's connecting segments thicken to this width, and its
 * circle gains a soft drop shadow. Generation-space px, so they scale with the A4 fit like everything else.
 */
const HIGHLIGHT_SEGMENT_WIDTH = 4;
const HIGHLIGHT_SHADOW_COLOUR = "rgba(0, 0, 0, 0.45)";
const HIGHLIGHT_SHADOW_BLUR = 8;
const HIGHLIGHT_SHADOW_OFFSET = 2;

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

export class CanvasRenderer implements InteractiveRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  /**
   * The walk and display options from the last {@link draw}, kept so a hover {@link highlight} can
   * re-render the same picture without the caller re-supplying them, and so {@link hitTest} has a
   * walk to test pointer positions against. Null before the first draw and after {@link clear}.
   */
  private lastWalk: Walk | null = null;
  private lastOptions: DisplayOptions | null = null;

  /**
   * The A4-fit transform applied by the last {@link draw} (generation-space → backing-store px):
   * `screen = offset + scale·(gen − min)`. {@link hitTest} inverts it (together with the canvas
   * element's CSS scale) to map a viewport click back to a waypoint. Null until the first draw.
   */
  private fit: { scale: number; offsetX: number; offsetY: number; minX: number; minY: number } | null =
    null;

  /** The hovered waypoint to emphasise (drop shadow + thick incident segments), or null (US-017). */
  private highlighted: Waypoint | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("Canvas 2D context is unavailable");
    }
    this.ctx = ctx;
  }

  /** Removes everything from the canvas and forgets the drawn walk + hover state (US-012 ClearWalk). */
  clear(): void {
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.lastWalk = null;
    this.lastOptions = null;
    this.fit = null;
    this.highlighted = null;
  }

  /**
   * Draws the full walk: white background, grid, connected orthogonal path, numbered waypoints,
   * and — toggled independently by `options` — the wildcard rings (`showWildcards`) and the
   * outbound turn labels (`showTurns`).
   *
   * A fresh draw clears any hover highlight (the picture changed); a subsequent pointer move
   * re-establishes it through {@link highlight}. The walk, options and A4-fit transform are
   * remembered so {@link highlight} can re-render and {@link hitTest} can invert the transform.
   */
  draw(walk: Walk, options: DisplayOptions): void {
    this.lastWalk = walk;
    this.lastOptions = options;
    this.highlighted = null;
    this.render();
  }

  /**
   * Re-render the last drawn walk with `waypoint` emphasised as the hover target — a drop shadow on
   * its circle and its connecting segments thickened to {@link HIGHLIGHT_SEGMENT_WIDTH}px — or pass
   * null to clear the emphasis (US-017). A no-op when there is no current walk (before the first
   * {@link draw} / after {@link clear}).
   */
  highlight(waypoint: Waypoint | null): void {
    if (this.lastWalk === null) return;
    this.highlighted = waypoint;
    this.render();
  }

  /**
   * Map a viewport (client) coordinate to the waypoint under it, or null when the point is over empty
   * canvas (US-017 / docs/adr/0005). Inverts BOTH transforms in turn:
   *  1. the canvas element's CSS scale (viewport → backing store), from `getBoundingClientRect` — the
   *     element may be displayed smaller than its 794×1123 backing store on a narrow viewport. The
   *     rect is the BORDER box, so the element's border (index.html's 1px) is removed first so the
   *     CONTENT box, which is what the backing store maps to, is the one that is scaled;
   *  2. the A4 fit (backing store → generation space), from the stored {@link fit}.
   * Returns the nearest waypoint whose circle (radius {@link WAYPOINT_RADIUS}) contains the point.
   * Null before the first draw / after clear, or when the element has no layout box (zero-sized).
   */
  hitTest(clientX: number, clientY: number): Waypoint | null {
    const walk = this.lastWalk;
    const fit = this.fit;
    if (walk === null || fit === null) return null;

    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();

    // viewport → backing store: undo the CSS element scale (index.html's `canvas { max-width: 100% }`).
    // getBoundingClientRect() returns the element's BORDER box, but the backing store maps to its
    // CONTENT box — index.html gives the canvas a 1px border. So subtract the (uniform) border
    // (clientLeft/clientTop) from the origin and from both sides of the size before scaling, or the
    // mapping is skewed off-centre — increasingly so the more the element is CSS-downscaled, since the
    // border does not scale with the content. clientLeft/clientTop are 0 on an unbordered canvas, where
    // this reduces to the plain border-box mapping.
    const borderX = canvas.clientLeft;
    const borderY = canvas.clientTop;
    const contentW = rect.width - 2 * borderX;
    const contentH = rect.height - 2 * borderY;
    if (contentW <= 0 || contentH <= 0) return null;

    const backingX = ((clientX - rect.left - borderX) / contentW) * canvas.width;
    const backingY = ((clientY - rect.top - borderY) / contentH) * canvas.height;

    // backing store → generation space: undo the A4 fit (translate → scale → translate).
    const genX = (backingX - fit.offsetX) / fit.scale + fit.minX;
    const genY = (backingY - fit.offsetY) / fit.scale + fit.minY;

    let nearest: Waypoint | null = null;
    let nearestDistance = WAYPOINT_RADIUS;
    for (const wp of walk.waypoints) {
      const distance = Math.hypot(wp.position.x - genX, wp.position.y - genY);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearest = wp;
      }
    }
    return nearest;
  }

  /**
   * The actual draw, shared by {@link draw} (fresh) and {@link highlight} (hover re-render) so the
   * transform is computed in exactly one place. Rings are drawn before labels so a label is never
   * occluded by a ring; the highlighted waypoint's thick segments go under the circles.
   *
   * The padded content box is uniformly scaled to FIT the A4-capped backing store and centred
   * within the canvas (US-015): a walk larger than A4 is shrunk to fit; a walk already within A4 is
   * never enlarged (the scale is clamped to ≤ 1). All drawing stays in generation-space px — the
   * scale + centre is applied purely through the canvas transform, which is recorded in {@link fit}.
   */
  private render(): void {
    const walk = this.lastWalk;
    const options = this.lastOptions;
    if (walk === null || options === null) return;
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
    const contentW = maxX - minX; // ≥ 2*GRID_PADDING, so never zero (no divide-by-zero below)
    const contentH = maxY - minY;

    // A4 cap + uniform downscale (US-015 / docs/adr/0005). Fit within the A4 page, never larger than
    // the backing store, and never scale a small walk UP (clamp to ≤ 1 so walks within A4 keep size).
    const capW = Math.min(A4_WIDTH, canvas.width);
    const capH = Math.min(A4_HEIGHT, canvas.height);
    const scale = Math.min(1, capW / contentW, capH / contentH);

    // Auto-centre the scaled content box within the canvas so the full route is visible.
    const offsetX = (canvas.width - contentW * scale) / 2;
    const offsetY = (canvas.height - contentH * scale) / 2;

    // Remember the transform so hitTest can invert it (generation ↔ backing store).
    this.fit = { scale, offsetX, offsetY, minX, minY };

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.translate(-minX, -minY);

    this.drawGrid(minX, minY, maxX, maxY);
    this.drawPath(walk);
    this.drawHighlightedSegments(walk);
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
   * Hover emphasis for the path (US-017): the segments incident to the highlighted waypoint redrawn
   * at {@link HIGHLIGHT_SEGMENT_WIDTH}px on top of the 2px base path. Drawn before the waypoint
   * circles so the circles cover the thick segments' endpoints, exactly as for the base path. A
   * no-op when nothing is highlighted. An interior waypoint thickens both its incoming and outgoing
   * segments; a terminal thickens its single connecting segment.
   */
  private drawHighlightedSegments(walk: Walk): void {
    const highlighted = this.highlighted;
    if (highlighted === null) return;
    const waypoints = walk.waypoints;
    const i = highlighted.sequenceNumber - 1; // sequence numbers are 1-based
    if (i < 0 || i >= waypoints.length) return;

    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = SEGMENT_COLOUR;
    ctx.lineWidth = HIGHLIGHT_SEGMENT_WIDTH;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    ctx.beginPath();
    if (i > 0) {
      ctx.moveTo(waypoints[i - 1].position.x, waypoints[i - 1].position.y);
      ctx.lineTo(waypoints[i].position.x, waypoints[i].position.y);
    }
    if (i < waypoints.length - 1) {
      ctx.moveTo(waypoints[i].position.x, waypoints[i].position.y);
      ctx.lineTo(waypoints[i + 1].position.x, waypoints[i + 1].position.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Each waypoint as a radius-25 circle with its number centred in bold 20px Arial.
   * First + last waypoints: black fill / white border / white number; all others the inverse.
   * The hovered waypoint (US-017) is drawn with a soft drop shadow on its circle; the shadow is
   * scoped to that circle (its own save/restore) so it never bleeds onto other circles or the number.
   */
  private drawWaypoints(walk: Walk): void {
    const { ctx } = this;
    const highlighted = this.highlighted;
    ctx.save();
    ctx.font = WAYPOINT_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = WAYPOINT_BORDER_WIDTH;
    for (const wp of walk.waypoints) {
      const terminal = wp.isTerminal;
      const { x, y } = wp.position;
      const isHighlighted = highlighted !== null && wp.sequenceNumber === highlighted.sequenceNumber;

      ctx.save();
      if (isHighlighted) {
        ctx.shadowColor = HIGHLIGHT_SHADOW_COLOUR;
        ctx.shadowBlur = HIGHLIGHT_SHADOW_BLUR;
        ctx.shadowOffsetX = HIGHLIGHT_SHADOW_OFFSET;
        ctx.shadowOffsetY = HIGHLIGHT_SHADOW_OFFSET;
      }
      ctx.beginPath();
      ctx.arc(x, y, WAYPOINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = terminal ? TERMINAL_FILL : WAYPOINT_FILL;
      ctx.fill();
      ctx.strokeStyle = terminal ? TERMINAL_BORDER : WAYPOINT_BORDER;
      ctx.stroke();
      ctx.restore(); // drop the shadow before the number so it stays crisp

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
