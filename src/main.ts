// Composition root for the 90 Waypoint Map app.
//
// This is the only place allowed to wire the domain/application layers to the
// adapters (Canvas renderer, DOM controls) and inject the driven ports
// (RandomSource, Renderer, Yield). The full wiring and auto-generate-on-load
// behaviour land in US-021; for the US-001 scaffold this entry just confirms the
// build pipeline boots an ES module in the browser and that the adapters project
// can import from the domain (core) project.
import { APP_NAME } from "./domain/scaffold.js";

console.info(`${APP_NAME}: scaffold loaded`);
