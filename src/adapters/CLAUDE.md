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
- `options: DisplayOptions` (showWildcards / showTurns) is consumed from **US-014** on. The two
  toggles are INDEPENDENT and gate two separate `draw()` passes added AFTER the base picture (inside
  the same translate, order rings-then-labels so a label is never occluded):
  - `showWildcards` → `drawWildcardRings`: an orange (`#ff8c00`) ring, 3px, at radius 30px from the
    centre of every `wp.wildcard` waypoint (the ring sits outside the r=25 circle, never overlaps it).
  - `showTurns` → `drawTurnLabels`: each interior waypoint's outbound turn label — `L`/`R`, or `W`
    for a wildcard — in `bold 16px Arial` (`#222222`), centred at `turnLabelPoint(position)` IMPORTED
    from `domain/layout-rules.js` (the exact NE 45°/46px geometry the layout invariant reserves
    clearance for — do NOT recompute it here, or the drawn label can drift from the reserved gap).
  - The wildcard `W` is a TURN label → governed by `showTurns`, NOT `showWildcards`. The orange ring
    is the separate wildcard indicator → governed by `showWildcards`. Don't conflate them.
  - Label text comes from a module fn `turnLabelText(wp)`: `null` for terminals (first/last show no
    label), `"W"` for wildcards (their `outboundTurn` is `null` by the Waypoint invariant), else
    `Turn.Left`→`"L"` / `Turn.Right`→`"R"`.
- Styling: terminals (`waypoint.isTerminal`) = black fill / white border / white number; interiors =
  white fill / black border / black number; numbers in `bold 20px Arial`, centred
  (`textAlign:"center"`, `textBaseline:"middle"`).
- `npm run verify:renderer` covers US-014: for counts 10/20/90 it asserts from the RECORDED ops across
  ALL FOUR toggle combinations (one L/R/W label per interior wp at its NE `turnLabelPoint`, terminals
  none; one orange r=30 3px ring per wildcard at its centre; labels present iff `showTurns`, rings iff
  `showWildcards`; n circles + n numbers regardless). NOTE: turn labels are `fillText` ops too — the
  US-013 "n numbers" count filters them out with `!TURN_LABELS.has(text)` (waypoint numbers are
  numeric, never L/R/W). When US-015 adds scaling, the ring radius / label offset are generation-space
  px that the US-015 transform scales along with everything else (no special-casing).
