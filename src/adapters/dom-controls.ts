import { Walk } from "../domain/walk.js";
import { RandomSource } from "../domain/random-source.js";
import { DisplayOptions, Renderer } from "../application/renderer-port.js";
import { GenerateWalk } from "../application/generate-walk.js";
import { ClearWalk } from "../application/clear-walk.js";

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
} as const;

/** Collaborators injected by the composition root (US-021). */
export interface DomControlsDeps {
  readonly generateWalk: GenerateWalk;
  readonly clearWalk: ClearWalk;
  readonly renderer: Renderer;
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
}

export class DomControls {
  /** The last successfully generated walk, kept so the toggles can redraw it without regenerating. */
  private currentWalk: Walk | null = null;

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
    });
  }

  private wire(): void {
    const { generateButton, clearButton, printButton, wildcardsToggle, turnsToggle } = this.elements;
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
  }

  /**
   * Clear the canvas, then generate and draw a freshly randomised walk for the current waypoint
   * count. The Generate button is disabled and the loading overlay shown for the whole generation,
   * both restored in a `finally`. On the bounded generator's failure signal the canvas is left
   * cleared (US-020 renders the error message); the overlay/button are restored either way.
   */
  async generate(): Promise<void> {
    this.setBusy(true);
    this.deps.clearWalk.execute();
    this.currentWalk = null;
    try {
      const count = this.readCount();
      const result = await this.deps.generateWalk.execute(count, this.deps.createRandom());
      if (result.ok) {
        this.currentWalk = result.walk;
        this.deps.renderer.draw(result.walk, this.displayOptions());
      }
      // result.ok === false: the canvas stays cleared; US-020 layers the error overlay on top.
    } finally {
      this.setBusy(false);
    }
  }

  /** Remove all waypoints and lines from the canvas and forget the current walk. */
  clear(): void {
    this.deps.clearWalk.execute();
    this.currentWalk = null;
  }

  /** Open the browser print dialog. */
  print(): void {
    window.print();
  }

  /** Redraw the current walk with the live toggle options, or do nothing if there is no walk yet. */
  private rerender(): void {
    if (this.currentWalk !== null) {
      this.deps.renderer.draw(this.currentWalk, this.displayOptions());
    }
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
}

function required<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (el === null) {
    throw new Error(`DomControls: required element #${id} not found in the document`);
  }
  return el as T;
}
