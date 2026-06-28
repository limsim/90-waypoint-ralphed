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

## dom-controls.ts (US-016)
- The INPUT boundary of the hexagon: owns all interactive chrome (Generate / Clear / Print buttons,
  the waypoint-count input, the Show Wildcards / Show Turns toggles) and translates gestures into
  `GenerateWalk` / `ClearWalk` calls + `Renderer.draw` redraws. All DOM access lives here.
- **Split for testability**: the constructor takes EXPLICIT element references
  (`DomControlsElements`); the static `DomControls.fromDocument(deps, doc = document)` is the ONLY
  `document`-touching path (it resolves each element by `CONTROL_IDS` and THROWS if any is missing,
  so a markup mismatch fails loudly at startup). That split lets the headless harness construct
  `DomControls` with fake elements directly — no fake `document` needed except for the `fromDocument`
  test itself (pass a `{ getElementById }` stub). Element ids are exported as `CONTROL_IDS` and MUST
  match the ids in index.html.
- **Markup + styling live in index.html, behaviour lives here.** index.html holds the control
  `<div class="controls">`, the `.canvas-wrap` (positioned so the overlay sits over the canvas), the
  `#loading-overlay` (spinner + "Generating..."), and the spinner `@keyframes` CSS. The adapter only
  shows/hides the overlay (`loadingOverlay.style.display = "flex" | "none"`) and toggles
  `generateButton.disabled`. The spinner is a PURE-CSS animation — it animates once `GenerateWalk`
  frees the event loop between batches; the adapter never drives the animation.
- **Overlay timing**: `setBusy(true)` runs SYNCHRONOUSLY at the top of `generate()` BEFORE the
  `await generateWalk.execute(...)`, so the overlay/disabled state are committed before the event loop
  is ceded and the browser paints them; `setBusy(false)` runs in a `finally` so they are ALWAYS
  restored — on success, on the bounded failure signal (`ok:false`), and on a thrown error. `generate`
  rethrows; the click listener owns the rejection (`.catch(console.error)`) so a stray failure can't
  become an unhandled promise rejection. The WHOLE operation (the canvas clear → generate → draw) runs
  INSIDE the `try` after `setBusy(true)`, so a failure in ANY step — including the clear — still hits
  the `finally` and restores the controls; nothing between `setBusy(true)` and the `try` can strand the
  busy state. `generate()` reuses `this.clear()` for that first step (no duplicated clear logic).
- **Current-walk view state**: per ADR-0003 the domain holds no "current walk", but the two display
  toggles must redraw the SAME walk with new options WITHOUT regenerating it — so this adapter keeps a
  `currentWalk: Walk | null` (a pure UI/view concern). A toggle `change` → `renderer.draw(currentWalk,
  options)`; a fresh Generate replaces it; Clear nulls it (so toggles become a no-op until the next
  Generate). Do NOT push this state into the domain.
- **Seed-agnostic**: a fresh `RandomSource` is produced per generation via the injected
  `createRandom: () => RandomSource` factory (NOT a single shared instance — each Generate must start a
  fresh deterministic stream, which US-022's single-seed reproducibility depends on). US-021 supplies
  the entropy-seeded factory; US-022 layers `?seed=` on top — neither changes this class.
- **Count clamping**: `readCount()` parses the input and clamps to `[10, 90]`, falling back to 90 on a
  blank/non-numeric value, so the generator always gets a valid integer count (its guard rejects
  non-integer / `< 2`). The `<input min="10" max="90" value="90">` attributes mirror these bounds.
- **Headless gate** (`npm run verify:controls`, `scripts/verify-controls.mjs`): adapters aren't covered
  by `npm test` (tsconfig.test references core only), so this is the regression gate. It drives a REAL
  `GenerateWalk`/`ClearWalk` through `DomControls` with fake elements + a recording fake `Renderer`,
  and asserts: clear-then-draw on Generate; overlay+disabled DURING (asserted synchronously, before the
  await) and restored after; Clear clears; toggles redraw the SAME walk object with independent options
  (and are a no-op with no current walk); the count input drives + clamps; Print calls `window.print`;
  the overlay restores in `finally` on the `ok:false` failure signal, on a thrown generation, AND on a
  thrown CLEAR step (proving the whole operation is inside the try, not just the post-clear part); each
  Generate pulls a FRESH source from `createRandom` exactly once (no shared/cached source — the
  seed-agnostic contract US-022 depends on); and `fromDocument` resolves by id + throws on a missing
  element. **Extend it** when US-017 (tooltip/hover) and US-020 (failure error overlay) add to this
  adapter. NOTE: `window.print` is a global — the harness
  stubs `globalThis.window` around the print check; the adapter reads `window` at call time.
- **The one un-faked seam — index.html ↔ adapter contract.** Every behaviour check uses FAKE elements
  and a FAKE document, so a drift between `CONTROL_IDS` and the real ids in `index.html` (or a change to
  AC-mandated markup) would only blow up in the live browser — which can't be tested here — while the
  harness stayed green. `verify:controls` therefore reads the REAL `index.html` and asserts: every
  `CONTROL_IDS` value exists as an `id` (so `fromDocument` won't throw at startup); the waypoint input is
  `type=number min=10 max=90 value=90` (AC "range 10-90, default 90"); both toggles are checkboxes
  `checked` by default (AC "visible by default"); and the overlay has a `.spinner`, the "Generating..."
  text, and its `@keyframes spin` (AC2). The golden values (10/90/90, "Generating...") are HARD-CODED in
  the harness, NOT imported, so a drift in the markup fails the gate. Proven to bite (rename an id /
  change the default / drop `checked` / remove the keyframes → the gate fails; reverted). When you
  ADD/RENAME a control id or change its AC-mandated markup, update BOTH `index.html` and this check.
- CAVEAT (carried from US-013/14/15): a LIVE browser screenshot for human sign-off is still pending —
  no browser/Playwright MCP in this env, and the controls only become interactive once US-021 wires
  main.ts (composition root + auto-generate-on-load). The headless harness stands in for the functional
  ACs; the screenshot is a review gate, not a code defect.

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
  - The `cap = min(A4, canvas dim)` clause (the literal "capped at A4") is load-bearing only when the
    canvas is LARGER than A4 — on an A4-sized canvas `min(A4, canvas) == A4 == canvas`, so a regression
    capping at the canvas instead of A4 is invisible. `verify:renderer` therefore renders count=90 onto a
    canvas STRICTLY larger than A4 (and big enough that the walk fits at 1:1, so a canvas-only cap would
    NOT downscale) and asserts the derived scale is still the A4 cap — proven to bite (drop the `Math.min`
    → harness fails on the larger-canvas check while every A4-sized check still passes). `makeFakeContext`/
    `renderToOps` take optional `(canvasW, canvasH)` for this; default to A4.
  - The `s = min(1, A4_W/contentW, A4_H/contentH)` downscale must hold whichever axis BINDS, but a walk's
    bounding box has ONE aspect — so a single downscale seed only ever exercises ONE binding axis. The
    big default walk (count=90 seed=4242) is WIDTH-bound, so for a long time the `A4_H/contentH` term was
    never the active constraint: a regression to `s = min(1, A4_W/contentW)` (dropping the height term)
    passed everything yet overflowed A4 vertically on a tall walk. `verify:renderer` now ALSO runs a
    HEIGHT-bound downscale (count=30 seed=17: width 652px fits A4, height 1278px overflows → only the
    height term forces the scale), `verifyA4Fit` asserts the binding axis fills its A4 edge EXACTLY
    (`contentDim*s === A4 dim`), and a coverage gate asserts the downscale cases span BOTH "WIDTH" and
    "HEIGHT" binds so the height case can't be silently dropped. Lesson: an aspect-driven `min(...)` needs
    a fixture per binding term, or the un-exercised term rots. Proven to bite (width-only scale → the
    height-bound case fails on the A4-fit-formula check; every width-bound check still passes).
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
