import { Waypoint } from "../domain/waypoint.js";
import { Renderer } from "../application/renderer-port.js";

/**
 * A {@link Renderer} that also supports pointer interaction (US-017).
 *
 * Hit-testing (mapping a screen coordinate back to a waypoint) and hover highlighting are **canvas /
 * view** concerns: they deal with screen pixels and visual feedback, and no application use case ever
 * picks or hovers. So they live here in the adapter layer, deliberately NOT on the application
 * {@link Renderer} port — keeping that port the minimal "draw a Walk for a use case" contract that
 * `GenerateWalk` / `ClearWalk` (and their test fakes) depend on.
 *
 * The signatures use only numbers and a domain {@link Waypoint} — no DOM/Canvas types leak out — so
 * {@link DomControls} can depend on this interface and be unit-tested against a fake (the concrete
 * {@link CanvasRenderer} owns the actual `getBoundingClientRect` + transform inversion).
 */
export interface InteractiveRenderer extends Renderer {
  /**
   * Map a viewport (client) coordinate — e.g. a `MouseEvent`'s `clientX`/`clientY` — to the waypoint
   * under it, or null when the point is over empty canvas. Inverts both the canvas element's CSS scale
   * (viewport → backing store) and the A4 fit (backing store → generation space).
   */
  hitTest(clientX: number, clientY: number): Waypoint | null;

  /**
   * Re-render the current walk with one waypoint emphasised as the hover target (a drop shadow on its
   * circle and its connecting segments thickened), or pass null to clear the emphasis. A no-op when
   * there is no current walk.
   */
  highlight(waypoint: Waypoint | null): void;
}
