# PRD: 90 Waypoint Map

## Introduction

The **90 Waypoint Map** is a vanilla-TypeScript browser toy that generates and draws
orthogonal "walks" in the style of Marcus John Henry Brown's *90 Waypoint Walk*. Every
click of **Generate Walk** produces a fresh, randomised reinterpretation — a new sequence
of Left/Right turns, randomised segment lengths, and randomised wildcards — rendered as a
clean orthogonal grid **Map** on an HTML canvas, capped to a single A4 page.

Unlike the original (a single fixed 90-turn sequence that produces the same map anywhere),
this app deliberately randomises every generation (see `docs/adr/0001`). The hard part is
**generation under spacing constraints**: placing a fixed random turn sequence so that no
circles overlap, no parallel segments crowd each other, no segment clips a waypoint, and
every turn label stays legible — while guaranteeing the generator always terminates.

This PRD covers the **full application** as specified in `requirements/app-requirements.md`
and constrained by ADRs `0001`–`0006`. Stories are ordered **layer-first** following the
hexagonal architecture (`docs/adr/0003`): the pure, headless-testable domain core lands and
is verified before any browser code, then application use cases, then the DOM/Canvas
adapters and UI.

## Goals

- Generate a randomised, **always-valid** walk (10–90 waypoints) on every generation, with a
  bounded generator that is guaranteed to terminate (`docs/adr/0002`).
- Enforce all layout constraints (overlaps, 55px parallel separation, 35px waypoint
  clearance, 8px label clearance, in-bounds) in a **pure domain core** that is fully tested
  headless via `node:test`, with zero DOM/Canvas dependencies (`docs/adr/0003`, `0004`).
- Render the walk faithfully on canvas — grid, orthogonal segments, numbered waypoints, turn
  labels, wildcard rings — capped to A4 and scaled to fit the viewport (`docs/adr/0005`).
- Provide the full control surface: Generate, Clear, Waypoints count, Show/Hide Wildcards,
  Show Turns, Print — plus click tooltips, hover highlighting, a DOM legend, and a graceful
  failure path.
- Keep generation responsive: the "Generating…" overlay paints and the spinner animates even
  during rare pathological generations, via a cooperative-yield iterator (`docs/adr/0006`).
- Ship with **zero runtime dependencies** (dev/test deps like TypeScript and a test runner
  are fine).

## User Stories

Stories are ordered for the Ralph build loop: each is small enough for one focused session,
and earlier stories unblock later ones. **Verification gate:** domain and application stories
are gated by headless `npm test` + `npm run build`. Adapter/UI stories add the same headless
gate **plus** a screenshot captured via browser automation that the loop attaches as evidence;
a **human reviews that screenshot at story sign-off** (the in-browser check is evidence for
human review, not an autonomous loop-blocking assertion — see Resolved Decisions, OQ-4).

---

### US-001: Scaffold the project (build, test, dev, serve)
**Description:** As a developer, I need a TypeScript project skeleton with build and test
tooling so that subsequent stories have somewhere to land and a way to be verified.

**Acceptance Criteria:**
- [ ] `package.json` with no runtime dependencies; dev deps limited to TypeScript and the
      test runner (use built-in `node:test`).
- [ ] `tsconfig.json` compiles to **ES modules** with `strict` enabled; the `domain/` and
      `application/` layers do **not** include the `dom` lib.
- [ ] Directory layout created per `docs/adr/0003`: `src/domain/`, `src/application/`,
      `src/adapters/`, `src/main.ts`, plus a `tests/` (or co-located) test location.
- [ ] npm scripts present and working: `build` (`tsc`), `test` (headless `node:test`),
      `dev` (watch), `serve` (Node static server on port 8000, auto-incrementing to the next
      free port if 8000 is taken).
- [ ] `index.html` loads the compiled entry via `<script type="module">`.
- [ ] `npm run build` and `npm test` both run successfully against a trivial placeholder test.

### US-002: Point and Bounds value objects
**Description:** As a developer, I need immutable geometry primitives so the rest of the
domain can reason about coordinates and the generation-space bounding box.

**Acceptance Criteria:**
- [ ] `Point` is immutable (`x`, `y`); supports equality and translation.
- [ ] `Bounds` represents a generation-space rectangle; supports `contains(point)` accounting
      for a padding inset, and `grow(factor)` (used for the 10% bounds growth in US-010).
- [ ] No DOM/Canvas references; pure value objects.
- [ ] Unit tests cover equality, containment with padding, and growth; `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-003: Heading and Turn value objects
**Description:** As a developer, I need direction primitives so the generator can apply turns
and walk in a heading.

**Acceptance Criteria:**
- [ ] `Heading` enumerates North/East/South/West; **North points up** on the canvas
      (decreasing y).
- [ ] `Turn` enumerates Left (L) and Right (R).
- [ ] Applying `L` rotates the heading 90° counter-clockwise; `R` rotates 90° clockwise.
- [ ] A heading exposes its unit step vector (so segments can be built North/E/S/W).
- [ ] Unit tests verify all four headings × both turns, and the unit vectors; `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-004: Segment value object
**Description:** As a developer, I need a straight orthogonal segment with the geometry queries
the layout rules depend on.

**Acceptance Criteria:**
- [ ] `Segment` joins two `Point`s and is **always purely horizontal or vertical** (construction
      rejects diagonals).
- [ ] Exposes `length`, orientation (horizontal/vertical), distance-from-a-point, and a
      parallel-overlap query (do two parallel segments share overlapping range, and how far apart).
- [ ] No DOM/Canvas references.
- [ ] Unit tests cover length, orientation, point-distance, and parallel overlap/separation;
      `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-005: TurnSequence value object
**Description:** As a developer, I need the ordered L/R sequence that defines a walk's shape,
randomisable per generation.

**Acceptance Criteria:**
- [ ] `TurnSequence` is an immutable ordered list of `Turn` values.
- [ ] For a walk of **N** waypoints the sequence has exactly **N−2** turns (owned by waypoints
      2 … N−1); the first and last waypoints have no outbound turn.
- [ ] A factory generates a random sequence of a given length from an injected `RandomSource`
      (port defined in US-009; tests may stub it).
- [ ] Unit tests verify length math for several N (10, 90) and deterministic output under a
      seeded source; `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-006: Waypoint entity
**Description:** As a developer, I need the waypoint entity that carries its sequence number,
position, outbound turn, and wildcard state.

**Acceptance Criteria:**
- [ ] `Waypoint` has a sequence number, a `Point` position, an **outbound turn** (L/R, or none),
      and a wildcard flag.
- [ ] The **first and last** waypoints have no outbound turn and are never wildcards.
- [ ] A wildcard waypoint's turn is "skipped" semantically (heading unchanged through it); the
      entity models this state, the generator (US-010) applies it.
- [ ] Unit tests cover first/last having no turn, wildcard flag, and that wildcards are confined
      to waypoints 2 … N−1; `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-007: layout-rules pure constraint predicates
**Description:** As a developer, I need the full set of spacing/overlap constraints as pure
predicates so both the generator's hot loop and the Walk invariant can share them.

**Acceptance Criteria:**
- [ ] Pure functions (no exceptions) returning booleans / violation lists for:
  - [ ] No two waypoint circles (radius 25px) overlap.
  - [ ] No two parallel segments with overlapping range are closer than **55px**.
  - [ ] No path segment passes closer than **35px** from any non-adjacent waypoint centre
        (= 25px radius + 5px ring overhang + 5px margin).
  - [ ] No segment passes through a non-adjacent waypoint circle.
  - [ ] Every turn label's fixed **NE (45°), 46px-from-centre** position has at least **8px**
        clearance from all non-adjacent segments.
  - [ ] All waypoints lie within bounds (30px padding from edges in canvas terms / generation-space
        equivalent).
- [ ] No DOM/Canvas references; these are the riskiest logic and are tested most thoroughly.
- [ ] Unit tests include positive and negative cases for **each** constraint, including
      boundary distances (e.g. exactly 55px vs 54px); `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-008: Walk always-valid aggregate root
**Description:** As a developer, I need a `Walk` that cannot exist in an invalid state, so no
caller has to remember to validate it (`docs/adr/0004`).

**Acceptance Criteria:**
- [ ] `Walk.create(...)` composes the US-007 predicates into an invariant and **throws** on any
      violation; there is no `isValid()` method.
- [ ] A valid `Walk` exposes its waypoints, segments, generation-space bounding box, and
      cumulative distance from the start per waypoint (true summed segment lengths).
- [ ] The aggregate is built from a finished placement, **not** incrementally (the generator's
      mutable placement buffer lives in US-010, not here).
- [ ] Unit tests: a known-good layout constructs; layouts violating each invariant throw;
      `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-009: Driven ports and a seedable RandomSource
**Description:** As a developer, I need the two real boundaries (randomness, rendering) plus a
cooperative-yield boundary inverted as ports, with a deterministic random source for tests
(`docs/adr/0003`, `0006`).

**Acceptance Criteria:**
- [ ] Port interfaces defined in the domain/application layer: `RandomSource` (e.g. `nextInt`,
      `nextFloat`), `Renderer` (draw a `Walk` with display options), and a `Yield` port exposing a
      **single `yieldToEventLoop()`** method (OQ-1).
- [ ] A **seedable** `RandomSource` implementation produces a deterministic stream from a given
      seed; the **same implementation serves both tests (fixed seed) and production** (entropy seed
      by default, or a URL-supplied seed per US-022) — OQ-2.
- [ ] No DOM/Canvas types in the port definitions.
- [ ] Unit tests verify the seeded source is reproducible and the range helpers are correct;
      `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-010: walk-generator domain service (bounded generation, lookahead, re-roll)
**Description:** As a developer, I need the core generator that places a random turn sequence
under the layout constraints and is guaranteed to terminate (`docs/adr/0002`, `0004`, `0006`).

**Acceptance Criteria:**
- [ ] `walkGenerator.generate(count, randomSource)` is a pure synchronous **generator function**
      (`function*`) that yields a small progress value roughly every batch (~50 attempts, or once
      per re-roll) and returns either a valid `Walk` or a failure signal.
- [ ] Works on a lightweight **mutable placement buffer**; wraps the finished placement into
      `Walk.create(...)` at the end (never builds a draft `Walk`).
- [ ] Walk shape: starts facing **North**; segment 1→2 points straight North (no turn at
      waypoint 1); leaving waypoint *k* (k = 2 … N−1) applies `sequence[k−2]` then travels to
      *k*+1. Exactly **N−2** turns.
- [ ] Segment length randomised per segment between **60px and 140px**, scalable up to **8×** to
      satisfy spacing.
- [ ] Wildcards: **max(1, round(count / 9))** per walk, randomised positions among waypoints
      2 … N−1; a wildcard skips that waypoint's turn (heading unchanged).
- [ ] **Only the intended turn** is attempted — no opposite-turn / straight / 180° fallback, so
      labels always match the sequence.
- [ ] **Lookahead**: before committing a position for waypoint *i*, verify a valid position
      remains for *i*+1 (and *i*+2); skip candidates that dead-end future placement.
- [ ] Bounded control flow: **200** placement attempts per size → grow bounds **10%** up to
      **~10** times (≈2.6×) → **re-randomise the whole turn sequence** up to **~20** times →
      return failure signal. Termination is guaranteed.
- [ ] Headless tests with a **seeded** RandomSource verify: generation terminates; produced walks
      are valid (construct without throwing) across counts including 10 and 90; the failure signal
      is reachable; output is deterministic for a fixed seed. `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-011: GenerateWalk use case
**Description:** As a user action handler, I need a use case that drives the generator iterator
and cooperatively yields so the UI can paint during long generations.

**Acceptance Criteria:**
- [ ] `GenerateWalk` depends only on `domain` + ports; it drives the US-010 iterator to
      completion, `await`ing the injected `Yield` port's `yieldToEventLoop()` between batches. It
      **ignores the generator's yielded progress value** — the overlay spinner animates via CSS once
      the event loop is freed, so no progress data flows to the UI (OQ-1).
- [ ] Returns the valid `Walk` on success, or surfaces the failure signal for the caller to
      render an error.
- [ ] Headless tests use an **immediate/no-op** Yield port and a seeded RandomSource; they assert
      success returns a valid walk and the exhausted-re-roll path surfaces failure. `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-012: ClearWalk use case
**Description:** As a user action handler, I need a use case that clears the current walk.

**Acceptance Criteria:**
- [ ] `ClearWalk` resets the current-walk state to empty; depends only on `domain` + ports.
- [ ] Headless test asserts state is empty after clear; `npm test` passes.
- [ ] `npm run build` typecheck passes.

### US-013: Canvas renderer — grid, segments, waypoints
**Description:** As a user, I want to see the walk drawn on the canvas so the generated route is
visible.

**Acceptance Criteria:**
- [ ] Implements the `Renderer` port using the Canvas 2D API; DOM/Canvas usage confined to
      `src/adapters/canvas-renderer.ts`.
- [ ] Draws a subtle light-grey **grid**, 60px cells, covering the waypoints' bounding box with
      **100px** padding on each side.
- [ ] Draws **orthogonal** path lines (no diagonals, no mid-segment corners), dark grey/black,
      **2px** weight.
- [ ] Draws each waypoint as a **radius-25px** circle, number centred in **bold Arial 20px**:
      waypoint 1 and the last waypoint are black fill / white border / white number; all others
      white fill / black border / black number.
- [ ] `npm run build` typecheck passes.
- [ ] Capture a screenshot via browser automation showing a generated walk with grid, connected
      orthogonal segments, and correctly styled numbered waypoints; attach as evidence for human
      review at sign-off.

### US-014: Canvas renderer — turn labels and wildcard rings
**Description:** As a user, I want to see each waypoint's outbound turn and which waypoints are
wildcards.

**Acceptance Criteria:**
- [ ] Outbound turn label (**L**, **R**, or **W** for wildcard) drawn at the fixed **NE (45°)**
      position, **46px** from the waypoint centre; first and last waypoints show no label.
- [ ] Wildcard waypoints show an **orange ring**, 3px stroke, at radius 30px outside the centre.
- [ ] Rendering honours the **Show Turns** and **Show/Hide Wildcards** display options passed in
      (wired in US-016) — the W label is governed by Show Turns, the ring by Show Wildcards,
      independently.
- [ ] `npm run build` typecheck passes.
- [ ] Capture screenshots via browser automation showing labels clear of segments at NE, wildcard
      rings present, and the two toggles acting independently (Show Turns hides labels while rings
      remain, and vice versa); attach as evidence for human review at sign-off.

### US-015: A4 cap, uniform downscale, auto-centre, viewport fit
**Description:** As a user, I want the map to always fit on one A4 page and on my screen, with the
full walk centred (`docs/adr/0005`).

**Acceptance Criteria:**
- [ ] The rendered canvas is capped at **A4 (794×1123px at 96 PPI)**.
- [ ] The waypoints' bounding box (+100px padding) is uniformly scaled **down** to fit A4 when it
      exceeds those dimensions; walks already within A4 are **not** scaled up.
- [ ] The walk **auto-centres** after generation so the full route is visible.
- [ ] If the canvas is wider than the viewport, it CSS-scales down (preserving aspect ratio) so
      there is no horizontal scrolling.
- [ ] Scaling/fit are **adapter-only** transforms; the domain's generation-space coordinates are
      untouched.
- [ ] `npm run build` typecheck passes.
- [ ] Capture screenshots via browser automation showing a 90-waypoint walk fitting within A4 and
      the viewport, a small walk not enlarged, and both centred; attach as evidence for human review
      at sign-off.

### US-016: DOM controls driving adapter
**Description:** As a user, I want the control surface (Generate, Clear, Waypoints, toggles,
Print) so I can drive the app.

**Acceptance Criteria:**
- [ ] DOM usage confined to `src/adapters/dom-controls.ts`; it wires the `GenerateWalk` and
      `ClearWalk` use cases.
- [ ] **Generate Walk**: clears the canvas and draws a freshly randomised walk; during
      generation the button is **disabled** and a loading overlay (spinner + "Generating…") is
      shown over the canvas; both are restored in a `finally` when generation completes.
- [ ] **Clear**: removes all waypoints and lines from the canvas.
- [ ] **Waypoints**: number input, range **10–90**, **default 90**; sets the count for the next
      generation.
- [ ] **Show/Hide Wildcards**: toggles the orange rings **only**; rings visible by default.
- [ ] **Show Turns**: toggles the L/R/W labels (first/last show none); visible by default.
- [ ] **Print**: opens the browser print dialog.
- [ ] `npm run build` typecheck passes.
- [ ] Capture screenshots via browser automation showing every control behaving as specified,
      including the overlay appearing during generation and the toggles updating the render; attach
      as evidence for human review at sign-off.

### US-017: Waypoint click tooltip and hover highlighting
**Description:** As a user, I want to click a waypoint for its details and get hover feedback so I
can inspect the walk.

**Acceptance Criteria:**
- [ ] Clicking a waypoint shows a **DOM-overlay** tooltip (not painted on canvas) with: waypoint
      number, turn direction (L / R / Wildcard), and cumulative distance from the start in
      **generation-space px** (true summed segment lengths, stable across resizes).
- [ ] Tooltip dismisses on Clear, on Generate, and on a click on empty canvas; it survives redraws.
- [ ] Hit-testing inverts **both** transforms (viewport → A4 → generation) to map the click to a
      waypoint (`docs/adr/0005`).
- [ ] Hover over a waypoint: cursor becomes a pointer, the waypoint gains a drop shadow, and its
      connecting segments thicken to **4px**; moving off the canvas removes all hover highlighting.
- [ ] `npm run build` typecheck passes.
- [ ] Capture screenshots via browser automation showing a correct tooltip on click, the tooltip
      surviving a window resize and dismissing on the specified actions, and hover effects engaging
      and clearing on exit; attach as evidence for human review at sign-off.

### US-018: Legend (DOM/HTML)
**Description:** As a user, I want a legend explaining the symbols.

**Acceptance Criteria:**
- [ ] A legend rendered as **DOM/HTML** (not canvas-painted) below the canvas, with three entries:
      **Start / End** (black filled circle), **Waypoint** (white filled circle, black border),
      **Wildcard** (orange ring — walker goes straight).
- [ ] `npm run build` typecheck passes.
- [ ] Capture a screenshot via browser automation showing the legend below the canvas with the
      three correct entries; attach as evidence for human review at sign-off.

### US-019: Print stylesheet (single A4 page)
**Description:** As a user, I want to print just the map and legend cleanly.

**Acceptance Criteria:**
- [ ] A print stylesheet prints the **canvas and legend on a single A4 page** with all other UI
      chrome hidden.
- [ ] `npm run build` typecheck passes (if any TS is involved; otherwise CSS only).
- [ ] Capture a print-preview screenshot via browser automation showing only the map + legend on
      one A4 page; attach as evidence for human review at sign-off.

### US-020: Graceful generation-failure error
**Description:** As a user, if generation can't find a valid walk, I want a clear message rather
than a hang.

**Acceptance Criteria:**
- [ ] When `GenerateWalk` surfaces the exhausted-re-roll failure signal, an error is shown over the
      canvas: **"Couldn't generate a walk — try again or reduce the waypoint count"**, and the
      controls are restored.
- [ ] The UI never hangs: this path is reached via the bounded generator (US-010), not an infinite
      loop.
- [ ] `npm run build` typecheck passes.
- [ ] Capture a screenshot via browser automation (forcing or simulating the failure path) showing
      the error overlay and re-enabled controls; attach as evidence for human review at sign-off.

### US-021: Composition root (main.ts) and auto-generate on load
**Description:** As a user, I want the app fully wired and showing a walk the moment the page
loads.

**Acceptance Criteria:**
- [ ] `src/main.ts` is the composition root: it instantiates the domain/application layers and the
      adapters (canvas renderer, DOM controls), injects the production `RandomSource`
      (**entropy-seeded by default**; the `?seed=` URL override is layered on in US-022) and a Yield
      port whose `yieldToEventLoop()` is a **macrotask** in production.
- [ ] A walk is **automatically generated on first page load**, so the canvas is never blank.
- [ ] `npm run build` typecheck passes; `npm test` still passes (no regressions).
- [ ] Capture a screenshot via browser automation showing the page (served via `npm run serve`)
      with an auto-generated walk on load and all controls working end-to-end; attach as evidence
      for human review at sign-off.

### US-022: Shareable reproducible walks via `?seed=` URL
**Description:** As a user, I want a URL that reproduces the exact walk I'm looking at so I can
share or revisit a specific generation (OQ-2).

**Acceptance Criteria:**
- [ ] On load, if the URL has a `?seed=` parameter (and optional waypoint count), the production
      `RandomSource` is seeded with it so the **identical** walk is regenerated; with no `seed`
      param, behaviour is unchanged (entropy-seeded fresh walk).
- [ ] After each **Generate Walk**, the URL is updated (without reloading) to reflect the seed and
      waypoint count that produced the current walk, so it is always shareable.
- [ ] The seed used for a generation is derived once from the source and is recoverable — opening
      the reflected URL reproduces the same waypoints, turns, segment lengths, and wildcards.
- [ ] URL read/write lives in the adapter/composition layer only; the domain stays seed-agnostic
      (it just consumes the injected `RandomSource`).
- [ ] `npm run build` typecheck passes; a headless test confirms the same seed yields an identical
      `Walk` (determinism), and `npm test` passes.
- [ ] Capture screenshots via browser automation showing two loads of the same `?seed=` URL produce
      visually identical walks, and that the URL updates after a fresh Generate; attach as evidence
      for human review at sign-off.

## Functional Requirements

**Generation**
- FR-1: The walk consists of a configurable **10–90 waypoints** (default 90).
- FR-2: The turn sequence (L/R per turn) is **randomised on every generation**.
- FR-3: The walker starts facing **North**; segment 1→2 points straight North with no turn at
  waypoint 1.
- FR-4: Leaving waypoint *k* (k = 2 … N−1), apply `sequence[k−2]` (L = 90° CCW, R = 90° CW), then
  travel to *k*+1. A walk of N waypoints uses exactly **N−2** turns.
- FR-5: Each waypoint records its **outbound turn**; the first and last waypoints have none and
  display no label.
- FR-6: Segment length is **randomised per segment between 60px and 140px**, scalable up to **8×**
  to satisfy spacing.
- FR-7: Wildcards number **max(1, round(count / 9))** per walk, at randomised positions among
  waypoints 2 … N−1; a wildcard skips that waypoint's turn (heading unchanged).
- FR-8: Only the **intended turn** is attempted — no opposite-turn, straight, or 180° fallback;
  labels always match the sequence exactly.
- FR-9: A **lookahead** check ensures placing waypoint *i* still allows valid placement of *i*+1
  (and *i*+2); dead-end candidates are skipped.

**Layout constraints (generation-space)**
- FR-10: No two waypoint circles (radius 25px) overlap.
- FR-11: No two parallel segments with overlapping range are closer than **55px**.
- FR-12: No segment passes closer than **35px** from any non-adjacent waypoint centre.
- FR-13: No segment passes through a non-adjacent waypoint circle.
- FR-14: Every turn label's fixed **NE (45°), 46px-from-centre** position keeps at least **8px**
  clearance from non-adjacent segments.
- FR-15: All waypoints stay within bounds (30px padding from edges).

**Termination**
- FR-16: Generation is bounded: **200** attempts per size → grow bounds **10%** up to ~**10** times
  → re-randomise the whole sequence up to ~**20** times → graceful failure. It always terminates.

**Rendering**
- FR-17: Draw a light-grey grid, **60px** cells, covering the bounding box + **100px** padding.
- FR-18: Draw orthogonal path lines, dark grey/black, **2px**.
- FR-19: Draw waypoints as **radius-25px** circles with bold Arial 20px centred numbers; start/end
  black-filled, others white-filled.
- FR-20: Draw wildcard **orange rings** (3px, radius 30px); draw turn labels (L/R/W) at NE 46px.
- FR-21: Cap output at **A4 (794×1123px)**; uniformly downscale the bounding box (+100px) to fit
  when larger; auto-centre; CSS-fit to viewport without horizontal scroll. Generation-space is
  never mutated by these transforms.

**Controls & interaction**
- FR-22: Provide **Generate Walk** (with disabled-button + "Generating…" overlay, restored in
  `finally`), **Clear**, **Waypoints** (10–90, default 90), **Show/Hide Wildcards** (rings only),
  **Show Turns**, and **Print**.
- FR-23: Clicking a waypoint shows a **DOM-overlay** tooltip (number, turn, cumulative distance in
  generation-space px); it survives redraws and dismisses on Clear/Generate/empty-canvas click.
- FR-24: Hover thickens connecting segments to **4px**, adds a drop shadow, and sets a pointer
  cursor; leaving the canvas clears all hover state.
- FR-25: Hit-testing inverts viewport → A4 → generation transforms.
- FR-26: Display a **DOM/HTML legend** (Start/End, Waypoint, Wildcard) below the canvas, included
  in print.
- FR-27: **Print** outputs canvas + legend on a single A4 page with other chrome hidden.
- FR-28: On exhausted re-rolls, show **"Couldn't generate a walk — try again or reduce the waypoint
  count"** and restore controls.
- FR-29: Auto-generate a walk on first page load.

**Architecture & tech**
- FR-30: Vanilla TypeScript + Canvas 2D API; **zero runtime dependencies** (dev/test deps allowed).
- FR-31: DDD + hexagonal architecture: pure `domain/`, `application/` use cases, `adapters/` (DOM
  driving adapter; canvas-renderer and random-source driven adapters), wired in `main.ts`. DOM and
  Canvas appear only in adapter files.
- FR-32: `Walk` is an always-valid aggregate (`create` throws on invariant violation; no
  `isValid()`); generation uses a separate mutable placement buffer.
- FR-33: `walkGenerator.generate` is a pure `function*` iterator that yields a progress value; the
  use case awaits the injected Yield port's single `yieldToEventLoop()` between batches (macrotask in
  production, immediate/no-op in tests) and **ignores the yielded value** — the spinner is CSS-driven.
- FR-34: Build with `tsc` to ES modules loaded via `<script type="module">`; test headless with
  `node:test`; `npm run serve` serves on port 8000 (auto-incrementing if taken).

**Sharing**
- FR-35: If the page URL carries a `?seed=` parameter (and optional waypoint count), seed the
  production `RandomSource` with it so the identical walk regenerates; with no `seed`, generate a
  fresh entropy-seeded walk.
- FR-36: After each generation, update the URL (without reload) to reflect the seed and waypoint
  count that produced the current walk, so it is always shareable; the domain stays seed-agnostic
  and the URL read/write lives only in the adapter/composition layer.

## Non-Goals (Out of Scope)

- **Faithful reproduction** of the original fixed 90-turn walk — this app is generative by design
  (`docs/adr/0001`); "the map stays the same" does **not** hold here.
- **Per-turn fallbacks** (turning the other way, going straight, 180°) to force a layout — rejected
  because a label must never lie about its turn (`docs/adr/0002`).
- **Unbounded canvas growth** — rejected; it cannot escape topologically infeasible sequences and
  could hang the UI (`docs/adr/0002`).
- **Guaranteed physical 55px spacing in rendered pixels** for dense walks — constraints are
  generation-space guarantees; dense downscaled A4 output is intended (`docs/adr/0005`).
- **Web Worker / true off-main-thread generation** — cooperative yielding is sufficient
  (`docs/adr/0006`).
- **Persistence / repository / domain events / CQRS** — unjustified for a stateless generative toy
  (`docs/adr/0003`).
- **Saving or exporting** walks (image/file download, server-side persistence) beyond the browser
  Print dialog. The **only** sharing mechanism in scope is the shareable `?seed=` URL (US-022) — no
  image export, gallery, or account-bound saves.
- **Real-world mapping / distances** — the walk is abstract; distances are random px, not metres.
- **Editing a walk by hand** (dragging waypoints, editing turns) — generation only.
- **Animating the walker** along the route.

## Design Considerations

- A single canvas with a DOM control bar above and a DOM legend below; tooltip and loading overlay
  are **DOM overlays** positioned over the canvas, not painted on it (so they survive redraws and
  print correctly).
- Reuse the `Renderer` port abstraction so display options (Show Turns, Show Wildcards) flow as
  data into the renderer rather than the renderer reaching back into UI state.
- Visual styling is fixed by the requirements (colours, radii, fonts, offsets) — implement to the
  exact numbers in the Functional Requirements.

## Technical Considerations

- **The six ADRs (`docs/adr/0001`–`0006`) are binding constraints**, not suggestions. They
  supersede the original single-file source constraint (`docs/adr/0003`).
- The **layout-rules predicates (US-007)** are the riskiest logic and the foundation of both the
  generator hot loop and the Walk invariant — invest the most test coverage here, including
  boundary distances.
- Generation must be **deterministic under a seeded `RandomSource`** so the build loop can test it
  headless without a browser (`docs/adr/0006`). The **same seedable source backs production**: it is
  entropy-seeded normally and seed-overridden from `?seed=` for shareable reproducible walks (US-022),
  so determinism is a shipped property, not just a test affordance.
- The placement buffer must **never** be refactored into a `Walk` state — that would reintroduce
  representable invalid walks (`docs/adr/0004`).
- Cumulative distance shown in the tooltip is **generation-space px**, label it neutrally
  (`docs/adr/0005`).
- Use the project glossary in `CONTEXT.md` for naming (Walk, Map, Waypoint, Turn Sequence, Heading,
  Outbound turn, Segment, Wildcard) and avoid the discouraged synonyms.

## Success Metrics

- Domain + application layers achieve high headless test coverage; `npm test` and `npm run build`
  are green and are the gate for every non-UI story.
- Generation **always terminates** — no possible hang — across waypoint counts 10–90, verified by
  seeded tests.
- A 90-waypoint walk renders within A4 and fits the viewport without horizontal scrolling.
- Every rendered turn label matches the walk's actual turn sequence (no lying labels).
- The "Generating…" overlay paints and the spinner keeps animating during pathological generations
  (no full-page freeze).
- DOM/Canvas APIs appear in **exactly two adapter files** (`dom-controls.ts`, `canvas-renderer.ts`).
- Opening a reflected `?seed=` URL reproduces a pixel-identical walk (verified by a headless
  determinism test and human screenshot review).

## Resolved Decisions

All four open questions were resolved on 2026-06-27.

- **OQ-1 — Yield port seam: minimal `yieldToEventLoop()`.** The `Yield` port exposes a single
  `yieldToEventLoop()` the use case awaits between batches; the generator's yielded progress value is
  not consumed by the UI, and the overlay spinner animates via CSS. Lowest coupling, matches
  `docs/adr/0006`. _Reflected in US-009, US-011, FR-33._
- **OQ-2 — RandomSource seeding: entropy by default, overridable via `?seed=` URL.** Shareable,
  reproducible walks are now **in scope**: load honours a `?seed=` param, and the URL is updated after
  each generation. The single seedable source backs both tests and production. _Reflected in US-009,
  US-021, US-022, FR-35/FR-36, Non-Goals, Technical Considerations._
- **OQ-3 — Dense walks: accept A4 output as-is.** No on-screen legibility floor; dense downscaled A4
  is intended generative-art output, per `docs/adr/0005`. No new logic required. _Already covered by
  Non-Goals and `docs/adr/0005`._
- **OQ-4 — UI verification: screenshot evidence + human sign-off.** The Ralph loop is gated on
  deterministic headless `npm test` + `npm run build`. UI stories additionally have the loop capture a
  browser screenshot as **evidence**; a human reviews it at story sign-off — visual correctness is not
  an autonomous loop-blocking assertion. _Reflected in the User Stories verification-gate preamble and
  every UI story's final acceptance criterion._
