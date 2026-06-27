import { Renderer } from "./renderer-port.js";

/**
 * Application use case: clear the current walk in response to the user's Clear action
 * (docs/adr/0003).
 *
 * Per ADR-0003 this is a *stateless* generative toy — persistence/repository are deliberately
 * omitted as unjustified ceremony, so there is no stored "current walk" to mutate. The rendered
 * view *is* the current-walk state, and the only real rendering boundary is inverted as the
 * {@link Renderer} port. Clearing therefore means emptying that view through the port (removing
 * every waypoint and line), which resets the current-walk state to empty.
 *
 * It depends only on a driven port — no DOM, no Canvas, no domain mutation — mirroring the
 * {@link import("./generate-walk.js").GenerateWalk} use case: collaborators are injected, the
 * `execute` method acts, and no state is held here. That keeps it trivially testable headlessly
 * with a fake Renderer while the DOM/Canvas stays confined to the adapter (ADR-0003).
 *
 * Unlike GenerateWalk there is no long-running work to cooperatively yield around, so this is a
 * plain synchronous method — the caller (US-016 dom-controls) invokes it directly on the Clear
 * button and, when appropriate, before each Generate.
 */
export class ClearWalk {
  constructor(private readonly renderer: Renderer) {}

  /** Reset the current-walk state to empty: remove all waypoints and lines from the view. */
  execute(): void {
    this.renderer.clear();
  }
}
