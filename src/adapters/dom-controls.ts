import { Walk } from "../domain/walk.js";
import { Waypoint } from "../domain/waypoint.js";
import { Turn } from "../domain/turn.js";
import { RandomSource } from "../domain/random-source.js";
import { DisplayOptions } from "../application/renderer-port.js";
import { GenerateWalk } from "../application/generate-walk.js";
import { ClearWalk } from "../application/clear-walk.js";
import { InteractiveRenderer } from "./interactive-renderer.js";

/**
 * DOM control-surface adapter (docs/adr/0003).
 *
 * This is the input boundary of the hexagon: it owns ALL of the page's interactive chrome —
 * the Generate / Clear / Print buttons, the waypoint-count input, and the Show Wildcards / Show
 * Turns toggles — and translates user gestures into calls on the {@link GenerateWalk} and
 * {@link ClearWalk} use cases plus redraws through the {@link Renderer} port. All DOM access is
 * confined to this file (it is compiled by `tsconfig.adapters` with the `DOM` lib; the
 * domain/application layers cannot see DOM types).
 *
 * State: per ADR-0003 the app is a stateless generative toy with no repository, so the domain holds
 * no "current walk". But the two display toggles must be able to redraw the *same* walk with new
 * options without regenerating it, so this adapter keeps a reference to the last successfully
 * generated {@link Walk} (a pure view/UI concern, not domain state) and re-invokes the renderer when
 * a toggle changes. A fresh Generate replaces it; Clear drops it.
 *
 * Seeding stays out of here: a fresh {@link RandomSource} is produced per generation via the injected
 * `createRandom` factory, keeping this adapter seed-agnostic. US-021 wires the entropy-seeded
 * production source; US-022 layers the `?seed=` URL behaviour on top — neither changes this class.
 */

/** Waypoint-count input bounds and default (matches the `<input>` attributes in index.html). */
const MIN_WAYPOINTS = 10;
const MAX_WAYPOINTS = 90;
const DEFAULT_WAYPOINTS = 90;

/** Element ids in index.html that {@link DomControls.fromDocument} looks up. */
export const CONTROL_IDS = {
  generateButton: "generate-button",
  clearButton: "clear-button",
  waypointInput: "waypoint-count",
  wildcardsToggle: "toggle-wildcards",
  turnsToggle: "toggle-turns",
  printButton: "print-button",
  loadingOverlay: "loading-overlay",
  errorOverlay: "error-overlay",
  canvas: "walk-canvas",
  tooltip: "waypoint-tooltip",
} as const;

/** Offset (px) of the tooltip's top-left from the click point, so it sits clear of the cursor. */
const TOOLTIP_OFFSET = 12;

/** Collaborators injected by the composition root (US-021). */
export interface DomControlsDeps {
  readonly generateWalk: GenerateWalk;
  readonly clearWalk: ClearWalk;
  readonly renderer: InteractiveRenderer;
  /**
   * Produces a fresh {@link RandomSource} for each generation. US-021 supplies an entropy-seeded
   * source by default; US-022 supplies a `?seed=`-derived one. Keeping it a factory (not a single
   * shared instance) ensures each Generate starts a fresh deterministic stream, which US-022's
   * single-seed reproducibility depends on.
   */
  readonly createRandom: () => RandomSource;
}

/** The DOM elements this adapter drives. Resolved from index.html by {@link DomControls.fromDocument}. */
export interface DomControlsElements {
  readonly generateButton: HTMLButtonElement;
  readonly clearButton: HTMLButtonElement;
  readonly waypointInput: HTMLInputElement;
  readonly wildcardsToggle: HTMLInputElement;
  readonly turnsToggle: HTMLInputElement;
  readonly printButton: HTMLButtonElement;
  readonly loadingOverlay: HTMLElement;
  /** Shown over the canvas when generation exhausts its bounded re-rolls (US-020); hidden otherwise. */
  readonly errorOverlay: HTMLElement;
  /** The canvas the renderer draws to; this adapter listens here for click/hover and sets the cursor. */
  readonly canvas: HTMLCanvasElement;
  /** The DOM-overlay tooltip shown on a waypoint click (US-017); positioned over the canvas wrapper. */
  readonly tooltip: HTMLElement;
}

export class DomControls {
  /** The last successfully generated walk, kept so the toggles can redraw it without regenerating. */
  private currentWalk: Walk | null = null;

  /** The waypoint the pointer is currently over (US-017 hover), or null. Drives the cursor + highlight. */
  private hoveredWaypoint: Waypoint | null = null;

  constructor(
    private readonly deps: DomControlsDeps,
    private readonly elements: DomControlsElements
  ) {
    this.wire();
  }

  /**
   * Resolve the control elements from a document by their {@link CONTROL_IDS} and construct.
   * This is the only `document`-touching code path; the constructor takes explicit element
   * references so the behaviour is unit-testable with fakes. Throws if any element is missing,
   * so a markup/composition mismatch fails loudly at startup rather than silently no-op-ing.
   */
  static fromDocument(deps: DomControlsDeps, doc: Document = document): DomControls {
    return new DomControls(deps, {
      generateButton: required<HTMLButtonElement>(doc, CONTROL_IDS.generateButton),
      clearButton: required<HTMLButtonElement>(doc, CONTROL_IDS.clearButton),
      waypointInput: required<HTMLInputElement>(doc, CONTROL_IDS.waypointInput),
      wildcardsToggle: required<HTMLInputElement>(doc, CONTROL_IDS.wildcardsToggle),
      turnsToggle: required<HTMLInputElement>(doc, CONTROL_IDS.turnsToggle),
      printButton: required<HTMLButtonElement>(doc, CONTROL_IDS.printButton),
      loadingOverlay: required<HTMLElement>(doc, CONTROL_IDS.loadingOverlay),
      errorOverlay: required<HTMLElement>(doc, CONTROL_IDS.errorOverlay),
      canvas: required<HTMLCanvasElement>(doc, CONTROL_IDS.canvas),
      tooltip: required<HTMLElement>(doc, CONTROL_IDS.tooltip),
    });
  }

  private wire(): void {
    const { generateButton, clearButton, printButton, wildcardsToggle, turnsToggle, canvas } =
      this.elements;
    // Generate is async; the listener owns the rejection so a stray failure can't become an
    // unhandled promise rejection. The button stays disabled and the overlay shown for the whole
    // in-flight generation (both restored in `generate`'s finally).
    generateButton.addEventListener("click", () => {
      void this.generate().catch((err) => console.error(err));
    });
    clearButton.addEventListener("click", () => this.clear());
    printButton.addEventListener("click", () => this.print());
    // Toggles redraw the current walk with the new options — they never regenerate.
    wildcardsToggle.addEventListener("change", () => this.rerender());
    turnsToggle.addEventListener("change", () => this.rerender());
    // Pointer interaction on the map (US-017): click a waypoint for its tooltip, hover for feedback.
    canvas.addEventListener("click", (event) => this.handlePointerClick(event));
    canvas.addEventListener("mousemove", (event) => this.handlePointerMove(event));
    canvas.addEventListener("mouseleave", () => this.clearHover());
  }

  /**
   * Clear the canvas, then generate and draw a freshly randomised walk for the current waypoint
   * count. The Generate button is disabled and the loading overlay shown for the whole generation,
   * both restored in a `finally`. On the bounded generator's exhausted-re-roll failure signal the
   * canvas is left cleared and the error overlay is shown over it (US-020); the overlay/button are
   * restored either way. Generation is bounded (ADR-0002), so this never hangs — the failure path is
   * reached and surfaced, not spun on forever.
   *
   * Everything after `setBusy(true)` runs inside the `try`, so ANY failure — the clear, the
   * generation, or the draw — still hits the `finally` and restores the controls; the busy state is
   * never stranded. A fresh {@link RandomSource} is produced per call via `createRandom`, so each
   * Generate starts an independent deterministic stream (US-022's single-seed reproducibility). The
   * leading `clear()` also dismisses any error left over from a previous failed attempt, so a retry
   * (or a smaller waypoint count) starts from a clean slate.
   */
  async generate(): Promise<void> {
    this.setBusy(true);
    try {
      this.clear();
      const count = this.readCount();
      const result = await this.deps.generateWalk.execute(count, this.deps.createRandom());
      if (result.ok) {
        this.currentWalk = result.walk;
        this.deps.renderer.draw(result.walk, this.displayOptions());
      } else {
        // The bounded generator exhausted its re-rolls (ADR-0002): show a clear error over the
        // (already-cleared) canvas rather than leaving the user with a silent blank or a hang.
        this.showError();
      }
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Remove all waypoints and lines from the canvas and forget the current walk (so the toggles
   * become a no-op until the next Generate). Also dismisses the waypoint tooltip and the generation-
   * failure error, and drops any hover highlight, since the walk they referred to is gone. Used as
   * the first step of {@link generate} too, so a fresh Generate dismisses the tooltip and any prior
   * error as well (US-017 AC2 / US-020 retry).
   */
  clear(): void {
    this.deps.clearWalk.execute();
    this.currentWalk = null;
    this.hideTooltip();
    this.hideError();
    this.clearHover();
  }

  /** Open the browser print dialog. */
  print(): void {
    window.print();
  }

  /**
   * Redraw the current walk with the live toggle options, or do nothing if there is no walk yet.
   * A full draw clears the renderer's hover emphasis, so re-apply it for the still-hovered waypoint
   * (the tooltip is a separate DOM overlay and survives the redraw untouched — US-017 AC2).
   */
  private rerender(): void {
    if (this.currentWalk === null) return;
    this.deps.renderer.draw(this.currentWalk, this.displayOptions());
    if (this.hoveredWaypoint !== null) {
      this.deps.renderer.highlight(this.hoveredWaypoint);
    }
  }

  /**
   * A click on the map: show the tooltip for the clicked waypoint, or dismiss it on a click over
   * empty canvas (US-017 AC1/AC2). Hit-testing inverts the viewport → A4 → generation transforms.
   */
  private handlePointerClick(event: MouseEvent): void {
    const waypoint = this.deps.renderer.hitTest(event.clientX, event.clientY);
    if (waypoint === null) {
      this.hideTooltip();
      return;
    }
    this.showTooltip(waypoint, event.clientX, event.clientY);
  }

  /**
   * Pointer movement over the map: when the waypoint under the cursor changes, switch the cursor to a
   * pointer and emphasise that waypoint (drop shadow + thick segments) via the renderer; over empty
   * canvas, restore the default cursor and clear the emphasis (US-017 AC4). Redraws only happen on a
   * genuine change so a 90-waypoint walk is not re-rendered on every pixel of movement.
   */
  private handlePointerMove(event: MouseEvent): void {
    const waypoint = this.deps.renderer.hitTest(event.clientX, event.clientY);
    const current = this.hoveredWaypoint;
    const unchanged =
      waypoint === null
        ? current === null
        : current !== null && waypoint.sequenceNumber === current.sequenceNumber;
    if (unchanged) return;
    this.hoveredWaypoint = waypoint;
    this.elements.canvas.style.cursor = waypoint !== null ? "pointer" : "default";
    this.deps.renderer.highlight(waypoint);
  }

  /** Drop all hover state: restore the default cursor and clear the renderer emphasis (US-017 AC4). */
  private clearHover(): void {
    if (this.hoveredWaypoint === null) return;
    this.hoveredWaypoint = null;
    this.elements.canvas.style.cursor = "default";
    this.deps.renderer.highlight(null);
  }

  /**
   * Fill and position the DOM-overlay tooltip for a clicked waypoint, then show it (US-017 AC1). The
   * cumulative distance is generation-space px (from the domain Walk), so it is stable across canvas
   * redraws and viewport resizes. Positioned at the click point within the canvas wrapper.
   */
  private showTooltip(waypoint: Waypoint, clientX: number, clientY: number): void {
    if (this.currentWalk === null) return;
    const { tooltip, canvas } = this.elements;
    const distance = Math.round(this.currentWalk.cumulativeDistanceTo(waypoint.sequenceNumber - 1));
    tooltip.textContent = tooltipText(waypoint, distance);

    const rect = canvas.getBoundingClientRect();
    tooltip.style.left = `${clientX - rect.left + TOOLTIP_OFFSET}px`;
    tooltip.style.top = `${clientY - rect.top + TOOLTIP_OFFSET}px`;
    tooltip.style.display = "block";
  }

  /** Hide the waypoint tooltip (US-017 AC2: dismiss on Clear / Generate / empty-canvas click). */
  private hideTooltip(): void {
    this.elements.tooltip.style.display = "none";
  }

  /** The current display options read live from the two toggles. */
  private displayOptions(): DisplayOptions {
    return {
      showWildcards: this.elements.wildcardsToggle.checked,
      showTurns: this.elements.turnsToggle.checked,
    };
  }

  /**
   * The waypoint count for the next generation, parsed from the input and clamped to [10, 90].
   * A blank or non-numeric value falls back to the default (90), so generation always gets a valid
   * integer count the generator will accept.
   */
  private readCount(): number {
    const parsed = Number.parseInt(this.elements.waypointInput.value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_WAYPOINTS;
    return Math.min(MAX_WAYPOINTS, Math.max(MIN_WAYPOINTS, parsed));
  }

  /** Toggle the busy state: disable the Generate button and show/hide the loading overlay. */
  private setBusy(busy: boolean): void {
    this.elements.generateButton.disabled = busy;
    this.elements.loadingOverlay.style.display = busy ? "flex" : "none";
  }

  /**
   * Show the generation-failure error over the canvas (US-020). The message itself lives in the
   * markup (index.html), like the loading overlay's "Generating..." text; this only reveals it.
   */
  private showError(): void {
    this.elements.errorOverlay.style.display = "flex";
  }

  /** Hide the generation-failure error (on Clear and at the start of each Generate — see {@link clear}). */
  private hideError(): void {
    this.elements.errorOverlay.style.display = "none";
  }
}

function required<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (el === null) {
    throw new Error(`DomControls: required element #${id} not found in the document`);
  }
  return el as T;
}

/**
 * The tooltip body for a clicked waypoint (US-017): its number, outbound turn direction, and the
 * cumulative generation-space distance from the start. Lines are newline-separated; index.html styles
 * the tooltip with `white-space: pre-line` so each becomes its own line.
 */
function tooltipText(waypoint: Waypoint, distance: number): string {
  return [
    `Waypoint ${waypoint.sequenceNumber}`,
    `Turn: ${turnDescription(waypoint)}`,
    `${distance} px from start`,
  ].join("\n");
}

/**
 * The turn direction shown in the tooltip: `L` / `R` for an interior turn, `Wildcard` when the turn
 * is skipped (the walker goes straight), and `none` for the terminal Start / End waypoints (which
 * have no outbound turn by the Waypoint invariant).
 */
function turnDescription(waypoint: Waypoint): string {
  if (waypoint.isFirst) return "none (start)";
  if (waypoint.isLast) return "none (end)";
  if (waypoint.wildcard) return "Wildcard";
  switch (waypoint.outboundTurn) {
    case Turn.Left:
      return "L";
    case Turn.Right:
      return "R";
    default:
      return "none";
  }
}
