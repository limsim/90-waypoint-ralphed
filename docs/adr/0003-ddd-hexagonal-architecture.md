# Domain-Driven Design with a hexagonal (ports & adapters) architecture

The app is small, but we deliberately structure it as a hexagon with a **pure domain core** so
that the riskiest logic — turn-sequence generation and the spacing/overlap/label constraints —
is deterministically testable by the autonomous build loop without driving a browser.

- **`domain/`** depends on nothing (no DOM, no Canvas, no `dom` lib types): value objects
  (Heading, Turn, Point, Segment, TurnSequence, Bounds), the `Waypoint` entity, the `Walk`
  aggregate root, pure `layout-rules`, and the `walk-generator` domain service.
- **`application/`** holds use cases (`generate-walk`, `clear-walk`) and depends only on `domain`.
- The only two real boundaries — **randomness** and **pixel rendering** — are inverted as driven
  ports (`RandomSource`, `Renderer`). The DOM is a driving adapter. `main.ts` is the composition root.
- The DOM and Canvas APIs appear in exactly two files (`dom-controls.ts`, `canvas-renderer.ts`).

**Consequences:**
- This **supersedes the single-file source constraint** in the original requirements. Source is
  modular TypeScript compiled by `tsc` to ES modules, loaded via `<script type="module">` and served
  over HTTP (`npm run serve`). Zero *runtime* dependencies are retained; dev/test deps are allowed.
- Scaling to A4 and fit-to-viewport are **presentation concerns** living in the canvas adapter; the
  domain uses a single generation-space coordinate system and knows nothing about A4 or the viewport.
- A seedable `RandomSource` adapter makes generation deterministic under test (`node:test`).

**Deliberately omitted as unjustified ceremony for a stateless generative toy:** repository/persistence,
domain events, CQRS.
