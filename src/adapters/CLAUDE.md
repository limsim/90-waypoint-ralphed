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

## interactive-renderer.ts + pointer interaction (US-017)
- **Where hit-testing / hover live.** Mapping a screen point back to a waypoint, and the hover
  drop-shadow/thick-segment emphasis, are **canvas/view** concerns — no application use case picks or
  hovers. So they are NOT on the application `Renderer` port (keeping that the minimal "draw a Walk"
  contract that `GenerateWalk`/`ClearWalk` and their core-test fakes depend on). They live on
  `InteractiveRenderer extends Renderer` in `src/adapters/interactive-renderer.ts`:
  `hitTest(clientX, clientY): Waypoint | null` and `highlight(waypoint | null): void`. Signatures use
  only numbers + a domain `Waypoint` (no DOM types leak), so `DomControls` depends on the interface and
  is unit-testable with a fake. `CanvasRenderer implements InteractiveRenderer`; `DomControlsDeps.renderer`
  is an `InteractiveRenderer`. Do NOT add these to the application port — adding a method there forces
  every `Renderer` fake (e.g. `tests/clear-walk.test.ts`) to grow for a capability it never uses.
- **hitTest inverts BOTH transforms** (AC: "viewport → A4 → generation"): (1) the canvas element's CSS
  scale — `getBoundingClientRect()` gives the displayed rect, which on a narrow viewport is smaller than
  the 794×1123 backing store (`canvas { max-width: 100% }`), so `backing = (client − contentOrigin) /
  contentSize * canvas.size`; (2) the A4 fit — `gen = (backing − offset) / scale + min`, inverting the
  `translate→scale→translate` `draw` applies. `CanvasRenderer` therefore REMEMBERS the last walk +
  the fit `{scale, offsetX, offsetY, minX, minY}` (set in the shared `render()`, nulled in `clear()`),
  and finds the nearest waypoint within `WAYPOINT_RADIUS`. Returns null before any draw / over empty
  canvas. The layout invariant (circles ≥ 50px apart) makes the hit unique.
  - GOTCHA — `getBoundingClientRect()` returns the **border box**, but the backing store maps to the
    **content box**, and index.html gives the canvas a 1px border. So hitTest subtracts the (uniform)
    border from BOTH the origin and the size before scaling: `borderX = canvas.clientLeft`,
    `contentW = rect.width − 2·borderX`, `backing = (client − rect.left − borderX) / contentW *
    canvas.width`. Ignoring the border skews the mapping off-centre — negligibly at full size with a
    1px border (sub-pixel), but the error GROWS the more the element is CSS-downscaled, because the
    border does NOT scale with the content. `clientLeft/clientTop` are 0 on an unbordered canvas, where
    this reduces to the plain border-box mapping. `verify:renderer`'s `verifyHitTest` takes an optional
    `border`: the fake canvas's `rect` is the border box (`content + 2·border`) with matching
    `clientLeft/clientTop/clientWidth/clientHeight`, and a `border 24` + half-size case derives the
    client coords through the CONTENT box. Proven to bite — reverting hitTest to the border-box mapping
    (`(client − rect.left) / rect.width`) fails the `border 24` case (outer waypoints no longer within
    `WAYPOINT_RADIUS` of their true centre) while every `border 0` case still passes.
- **draw/highlight share one `render()`.** `draw(walk, options)` stores walk+options, resets the
  highlight (a fresh picture has no hover), and calls `render()`; `highlight(wp|null)` sets the hover
  and calls `render()` (no-op if no walk). `render()` computes + stores the fit ONCE. The hovered
  waypoint's incident segments are redrawn at 4px AFTER the base 2px path but BEFORE the circles (so
  circles cover the endpoints); its circle gets a drop shadow SCOPED in its own `ctx.save()/restore()`
  so it never bleeds onto later circles or the number (the number is drawn after the restore, crisp).
- **verify:renderer** gained `verifyHitTest` (drives the REAL renderer: takes each waypoint's recorded
  SCREEN centre, converts it to a client coord via a given rect — incl. a HALF-SIZE, OFFSET rect to
  exercise the CSS-scale inversion, and an A4-downscaled count=90 to exercise the fit inversion — and
  asserts `hitTest` returns that waypoint; plus empty→null and before-draw→null) and `verifyHighlight`
  (4px incident-segment path through the right neighbours; drop shadow on the highlighted fill but NOT
  the number nor a LATER circle — catches shadow bleed; `highlight(null)` clears; before-draw no-op).
  GOTCHA: this required `makeFakeContext`'s `save`/`restore` to model the FULL state stack (matrix +
  styles incl. the new `shadow*` keys), not just the matrix — a matrix-only restore leaks the shadow
  and silently passes the scoping regression. Both gates were proven to bite (drop the rect-scale
  division → the half-rect hitTest fails; unscope the shadow → the "number carries no shadow" check
  fails) then reverted. NB: revert a proof-of-bite with a precise Edit, NOT `git checkout <file>` — the
  file is uncommitted, so checkout wipes the WHOLE story's edits, not just the temporary one.

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
- **Pointer interaction + tooltip (US-017).** `DomControls` also owns the canvas (`#walk-canvas`) and a
  DOM-overlay tooltip (`#waypoint-tooltip`) — both added to `CONTROL_IDS`/`DomControlsElements` and
  resolved by `fromDocument`. It listens on the canvas for `click` (→ `renderer.hitTest` → show the
  tooltip for the waypoint, or dismiss it over empty canvas), `mousemove` (→ hit-test → set cursor
  `pointer`/`default` + `renderer.highlight(wp|null)`; only on a CHANGE of hovered waypoint, so a
  90-waypoint walk is not re-rendered every pixel) and `mouseleave` (→ clear hover). The tooltip's
  three facts (number / turn direction L·R·Wildcard / cumulative distance) come from the domain
  `Waypoint` + `walk.cumulativeDistanceTo(seq-1)` — the distance is GENERATION-space px so it is stable
  across redraws/resizes. Tooltip dismissed on Clear and Generate (both route through `clear()`, which
  now also `hideTooltip()` + `clearHover()`); it SURVIVES a toggle redraw because it is a separate DOM
  element `rerender()` never touches (rerender re-applies the hover highlight after the draw, since a
  fresh `draw` resets the renderer's highlight). The MARKUP + CSS live in index.html
  (`#waypoint-tooltip { position:absolute; display:none; pointer-events:none; white-space:pre-line }` —
  `pointer-events:none` so it can't swallow the next canvas click; `pre-line` renders the adapter's
  `\n`-joined text as lines). `verify:controls` drives all of this with a fake canvas
  (`getBoundingClientRect`) + fake renderer (`hitTarget`/`hitArgs`/`highlights`) and reads the real
  index.html for the tooltip's overlay CSS contract; `fakeEl.dispatch(type, event)` now forwards a
  mouse event so listeners can read `clientX`/`clientY`.
- **Print stylesheet (US-019).** Pure CSS in `index.html` — an `@media print { … }` block (no adapter
  change), like the legend. It prints ONLY the map + legend on a single A4 page: it hides the chrome
  (`.controls`, `#loading-overlay`, `#waypoint-tooltip`) and the `h1`, sets `@page { size: A4 }`, and
  CAPS the canvas with `max-height` (width/height:auto preserving the A4 aspect ratio) so the legend
  fits beneath it on the SAME sheet — the canvas backing store is A4-sized (794×1123 ≈ 210×297mm), so
  at natural size it would fill the whole page and push the legend onto page 2. GOTCHA: the
  overlay/tooltip hides MUST be `display: none !important`, because the adapter sets their `display`
  via INLINE `style.display` (overlay during generation, tooltip on a waypoint click) and an inline
  style beats a normal stylesheet rule — without `!important` an open tooltip prints over the map.
  Its only regression gate is `verify:controls` item 7 (reads the real `index.html`): asserts the
  `@media print` block exists, `@page size: A4`, each chrome/`h1` selector is `display:none` (overlay
  + tooltip with `!important`), the legend + canvas are NOT hidden, and the canvas has a `max-height`
  cap. GOTCHA parsing it: `@media`/`@page` NEST braces, so a flat `selector { [^}]* }` regex stops at
  the first inner `}` — balance braces from the opening `{` to extract the block, and strip CSS
  comments first so prose words ("canvas"/"display"/"max-height") can't satisfy a check vacuously. A
  bare `canvas` selector regex also matches `.canvas-wrap`/`#walk-canvas`, so anchor it with a
  `(?<![\w.#-])` lookbehind. Both new assertions proven to bite (drop `!important` / drop `max-height`).
  GOTCHA (print colour): the legend swatches are CSS `background` colours (the Start/End swatch is a
  pure `background: #000000` fill, NO border), and browsers default to `print-color-adjust: economy`
  which DROPS background colours when printing — so without `print-color-adjust: exact` the black
  Start/End swatch prints as an EMPTY white circle and the legend no longer mirrors the canvas. The
  print block sets `.legend .swatch { -webkit-print-color-adjust: exact; print-color-adjust: exact }`
  (the `-webkit-` prefix for older Blink/WebKit, the unprefixed for the spec). verify:controls item 7
  asserts the unprefixed property via a `(?<!-)print-color-adjust:exact` lookbehind (so the prefix
  alone doesn't satisfy it); proven to bite by dropping the standard line. Any future swatch / printed
  background colour needs this too — borders (the waypoint outline, wildcard ring) print regardless.
- **Generation-failure error overlay (US-020).** When `GenerateWalk` returns the bounded generator's
  exhausted-re-roll failure signal (`result.ok === false` — ADR-0002 guarantees this path is REACHED,
  never an infinite hang), `generate()`'s `else` branch calls `showError()`, which flips the
  `#error-overlay` element's inline `display` to `"flex"` over the (already-cleared) canvas. The MESSAGE
  text ("Couldn't generate a walk - try again or reduce the waypoint count") lives in the MARKUP
  (index.html `#error-overlay`), exactly like the loading overlay's "Generating..." — the adapter only
  reveals/hides it, it never sets `textContent`. It is hidden again by `clear()` (so it's dismissed at
  the START of every Generate — a retry / smaller count starts clean — AND on the Clear button) and
  stays hidden on a successful generate. The controls are restored by the SAME `setBusy(false)` finally
  as every other path (so a failure re-enables the button). `#error-overlay` is added to
  `CONTROL_IDS`/`DomControlsElements`/`fromDocument`, and to the `@media print` hide list with
  `display: none !important` (the adapter sets its display INLINE, so a non-important hide would print
  the error over the map — same reason as the loading overlay/tooltip). `verify:controls` covers it:
  the failure-signal behaviour check now also asserts the overlay is SHOWN on `{ ok:false }` (proven to
  bite — remove `showError()` → the check fails), plus a successful-retry-dismisses and a Clear-dismisses
  check; the index.html-markup block asserts the `#error-overlay` element exists, carries the EXACT AC
  message (golden text hard-coded, scoped to the `#error-overlay` block — proven to bite), is
  `role=alert` + `position:absolute`, and is in the print hide list (`!important`).
  - GOTCHA — "OVER the canvas" (AC1) is STRUCTURAL, not `position: absolute`. An absolutely-positioned
    element covers the canvas only if it is (a) a DESCENDANT of the `position: relative` `.canvas-wrap`
    (its containing block, shared with the canvas + loading overlay) and (b) given `inset: 0` so it
    SPANS that block instead of sitting at its static-flow corner. The bare `position:absolute` check
    proves NEITHER — moving `#error-overlay` out of `.canvas-wrap`, or dropping its `inset: 0`, floats
    the message off the map yet keeps that check green (both proven to bite). So `verify:controls` item
    5b also asserts the overlay id appears INSIDE the div-balanced `.canvas-wrap` block (a helper
    `divBlockFrom(html, openIdx)` balances `<div>`/`</div>` — a non-greedy `<div>…</div>` would stop at
    the first inner `</div>` and miss nested overlays), that `.canvas-wrap` is `position: relative`, and
    that `#error-overlay` has `inset: 0`. Mirrors the legend's "below the canvas" document-order check.
- CAVEAT (carried from US-013/14/15/16): a LIVE browser screenshot for human sign-off is still pending —
  no browser/Playwright MCP in this env, and the controls (incl. US-017 click/hover, which need
  `DomControls` constructed) only become interactive once US-021 wires main.ts (composition root +
  auto-generate-on-load). The headless harnesses stand in for the functional ACs; the screenshot is a
  review gate, not a code defect.

## canvas-renderer.ts (US-013+)
- Implements the `Renderer` port (`src/application/renderer-port.ts`): `draw(walk, options)` + `clear()`.
- Imports `WAYPOINT_RADIUS` from `domain/layout-rules.js` so the DRAWN circle radius is the SAME
  single source of truth as the layout invariant — never hard-code 25 here.
- **Colour constants ↔ legend (US-018).** The symbol colours (`TERMINAL_FILL` #000000, `WAYPOINT_FILL`
  #ffffff, `WAYPOINT_BORDER` #000000, `WILDCARD_RING_COLOUR` #ff8c00) are MIRRORED by the legend swatches
  in `index.html` (`.swatch-terminal/-waypoint/-wildcard`). If you change one of these, update the
  matching legend swatch CSS too — `verify:controls` reads BOTH this source file and the legend CSS and
  anchors each to the same hard-coded golden set, so a drift on either side fails the gate.
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
