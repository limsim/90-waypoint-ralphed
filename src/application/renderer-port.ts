import { Walk } from "../domain/walk.js";

export interface DisplayOptions {
  showWildcards: boolean;
  showTurns: boolean;
}

/** Driven port: render a Walk to whatever output medium the adapter provides. */
export interface Renderer {
  draw(walk: Walk, options: DisplayOptions): void;
  clear(): void;
}
