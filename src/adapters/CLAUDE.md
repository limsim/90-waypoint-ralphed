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
  `draw` fills the background white in SCREEN space (identity transform) THEN applies the **US-015**
  A4-fit transform inside a `save`/`restore`: `translate(offsetX, offsetY)` → `scale(s, s)` →
  `translate(-contentMinX, -contentMinY)`. All drawing stays in generation-space px; the transform
  maps it to the A4 page. **Don't add a competing scale/translate inside the draw passes** — they
  draw in generation space and inherit this transform.
- **US-015 A4 cap / uniform downscale / auto-centre** (docs/adr/0005): `A4_WIDTH=794`, `A4_HEIGHT=1123`
  (@ 96 PPI). `s = Math.min(1, capW/contentW, capH/contentH)` where `cap = min(A4, canvas dim)`. The
  `min(1, …)` CLAMP is load-bearing: a walk already within A4 keeps its natural size (never enlarged);
  only walks larger than A4 are shrunk. `offset = (canvasDim - contentDim*s) / 2` centres the scaled
  padded content box, so the box's screen centre is always the canvas centre (equal margins). Stroke
  widths / ring radius / label offset are generation-space px and scale ALONG with everything (no
  special-casing) — dense sub-nominal spacing for big walks is intended (ADR-0005), not a bug.
- **Viewport fit (AC4) is CSS, not a Canvas transform** — it lives in `index.html`
  (`canvas { max-width: 100%; height: auto }`). The backing store stays A4 (794×1123); only the
  displayed element shrinks on a narrow viewport, preserving aspect ratio (no horizontal scroll).
  US-017 hit-testing must invert BOTH the CSS scale (element vs backing store) AND this A4 transform.
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
- GOTCHA when verifying the label POSITION: the harness LOCATES each label op via `turnLabelPoint`
  (shared with the renderer), so a match alone can't catch a regression in `turnLabelPoint`'s geometry
  — both sides move together and still agree. The gate therefore ALSO asserts the AC geometry
  INDEPENDENTLY from the recorded op's own coords vs the RAW waypoint centre: offset is NE (`dx>0`,
  `dy<0` — y grows downward), exactly 46px (`hypot≈46`), at 45° (`dx===-dy`). AC golden values
  (46px offset, r=30 ring, `#ff8c00`) are HARD-CODED in the harness, NOT imported from the domain, so
  a drift in the source constants fails the gate instead of being silently agreed with.
