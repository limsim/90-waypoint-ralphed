# src/adapters — DOM + Canvas boundary

This is the ONLY layer allowed to touch the DOM / Canvas. Compiled by `tsconfig.adapters.json`
(adds `DOM`, `DOM.Iterable` libs; references `core`). The domain/application layers cannot see
DOM types — that's enforced mechanically (`tsconfig.core.json` has `lib: ["ES2022"]` only).

## Testing adapters (important constraint)
- `tsconfig.test.json` references **core only**, so `tests/**` CANNOT import from `src/adapters/`.
  Adapters are NOT covered by `npm test`. That's why DOM-bound stories (e.g. US-013) have
  **typecheck + browser screenshot** as their acceptance criteria, not "Tests pass (npm test)".
- A committed headless harness exists: **`npm run verify:renderer`** (`scripts/verify-renderer.mjs`)
  builds then drives REAL generated walks (counts 2/10/20/90) through `CanvasRenderer` with a recording
  fake 2D context and asserts every primitive (grid lattice & box, orthogonal polyline, r=25 circles,
  terminal/interior fill·border·number colours, exactly-2-black-terminals, `clear()`, null-context
  throw). It is the regression gate for the renderer — **extend it when US-014/US-015 add to `draw()`**.
- To verify a renderer headlessly from scratch: after `tsc -b`, import the COMPILED
  `dist/src/adapters/*.js` from a standalone Node script (the compiled JS has no type checks at
  runtime), pass a hand-rolled **recording fake** `CanvasRenderingContext2D` (record every op +
  the current `fillStyle`/`strokeStyle`/`lineWidth`/`font` at call time via getter/setter props),
  drive a REAL generated `Walk` through it, and assert the emitted primitives. For VISUAL evidence,
  replay those recorded ops as SVG (track the `save`/`restore`/`translate` transform stack exactly
  as canvas would, so the SVG is derived from the real output, not a reimplementation) and rasterize
  with `qlmanage -t -s 1123 -o <dir> file.svg` (macOS QuickLook; no rsvg/imagemagick needed).

## canvas-renderer.ts (US-013+)
- Implements the `Renderer` port (`src/application/renderer-port.ts`): `draw(walk, options)` + `clear()`.
- Imports `WAYPOINT_RADIUS` from `domain/layout-rules.js` so the DRAWN circle radius is the SAME
  single source of truth as the layout invariant — never hard-code 25 here.
- Coordinate transform: content box = `walk.boundingBox` grown by `GRID_PADDING` (100px) each side.
  `draw` fills the background white in SCREEN space (identity transform) THEN
  `ctx.translate(-contentMinX, -contentMinY)` inside a `save`/`restore` so the walk is visible
  wherever it sits in generation space. **US-015** layers the A4 cap / uniform downscale / auto-centre
  / viewport-fit transform on top of this translate — don't add scaling in US-013.
- Grid lines are lattice-aligned (`Math.ceil(min/60)*60`) and clipped to the content box.
- Path is one connected polyline through the waypoint centres — orthogonality is guaranteed by the
  `Segment` constructor (corners only at waypoints, no diagonals, no mid-segment bends).
- `options: DisplayOptions` (showWildcards / showTurns) is accepted but only CONSUMED from **US-014**
  (turn labels + wildcard rings). US-014 should reuse `turnLabelPoint(position)` exported from
  `domain/layout-rules.js` for the NE-label geometry (same geometry as the invariant — no divergence).
- Styling: terminals (`waypoint.isTerminal`) = black fill / white border / white number; interiors =
  white fill / black border / black number; numbers in `bold 20px Arial`, centred
  (`textAlign:"center"`, `textBaseline:"middle"`).
