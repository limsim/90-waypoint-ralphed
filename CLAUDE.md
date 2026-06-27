# 90 Waypoint Map — project conventions

Vanilla-TypeScript Canvas app that generates randomised orthogonal "walks" in the style of
Marcus John Henry Brown's 90 Waypoint Walk. DDD + hexagonal architecture; see `docs/adr/`.

## Architecture (ADR-0003)

- `src/domain/` — pure value objects, entities, the `Walk` aggregate, `layout-rules`, and the
  `walk-generator` domain service. **No DOM, no Canvas, no `dom` lib, no node types.**
- `src/application/` — use cases (`generate-walk`, `clear-walk`). Depends only on `domain`.
- `src/adapters/` — DOM + Canvas live here ONLY (`dom-controls.ts`, `canvas-renderer.ts`).
- `src/main.ts` — composition root (wires everything; injects ports).
- The two real boundaries (randomness, rendering) plus a yield boundary are inverted as **ports**
  (`RandomSource`, `Renderer`, `Yield`). The seedable `RandomSource` makes generation deterministic.

## Build / test toolchain (US-001)

- **TypeScript project references** enforce the layering. `tsc -b` builds them in order:
  - `tsconfig.core.json` — domain + application. `lib: ["ES2022"]`, `types: []` (no DOM, no node).
  - `tsconfig.adapters.json` — adapters + main. Adds `DOM` lib. References core.
  - `tsconfig.test.json` — `tests/`. Adds `types: ["node"]` for `node:test`. References core.
  - `tsconfig.json` is the solution file (`files: []` + references); `tsconfig.base.json` is shared options.
- **ESM everywhere**: `"type": "module"`, `module/moduleResolution: NodeNext`. Relative imports MUST
  carry a `.js` extension (e.g. `import { Point } from "../domain/point.js"`) — works in both Node ESM
  and the browser. The `dist/` tree mirrors the source tree (`rootDir: "."`), so test imports like
  `../src/domain/x.js` resolve correctly from `dist/tests/`.
- **Tests** are headless `node:test` (`import test from "node:test"; import assert from "node:assert/strict"`).
  Run via `npm test` → `tsc -b && node --test "dist/tests/**/*.test.js"`.
  GOTCHA: `node --test <dir>` tries to load the dir as a module — you MUST pass a **glob** of compiled
  `.js` files, not a directory. Test files are named `*.test.ts`.
  GOTCHA: `tsc -b` does NOT delete orphaned outputs. After **removing or renaming** a source/test file,
  run `npm run clean` (`rm -rf dist`) before `npm test`, or stale `dist/tests/*.test.js` keep getting run
  by the glob. (zsh aside: `rm -rf dist *.tsbuildinfo` aborts on `no matches found` since the buildinfo
  lives inside `dist/`; just `rm -rf dist` — the `.tsbuildinfo` files go with it.)
- `npm run serve` → zero-dependency static server (`scripts/serve.mjs`), port 8000, auto-increments
  if taken. Serves the repo root so `index.html` and `dist/` are reachable.
- `dist/`, `node_modules/`, `*.tsbuildinfo` are gitignored.

## Conventions

- Zero **runtime** dependencies (dev deps only). Keep it that way.
- Domain stays in a single generation-space coordinate system; A4 cap + viewport fit are
  renderer-adapter transforms only (ADR-0005). Spacing constraints are generation-space guarantees.
- `Walk` is always-valid by construction (`Walk.create` throws on any invariant violation); there is
  no `isValid()`. Generation works on a mutable placement buffer, not a draft Walk (ADR-0004).
