// Headless verification harness for the composition root (US-021, src/main.ts).
//
// `tsconfig.test.json` references core only, so `tests/**` cannot import the DOM-bound adapters /
// composition root and `npm test` does not cover them (see src/adapters/CLAUDE.md). main.ts wires the
// real adapters to the real use cases and injects the production driven ports — its acceptance criteria
// are "typecheck + auto-generate on load + browser screenshot". This script is the headless stand-in
// for the functional ACs: it imports the COMPILED main.js from dist/ (runtime JS has no type checks, so
// the DOM-typed composition loads in plain Node) and drives `bootstrap` with a FAKE document (fake
// control elements + a recording fake 2D context behind the fake canvas), exercising the REAL
// GenerateWalk / ClearWalk / walkGenerator / CanvasRenderer + the REAL production Yield port.
//
//   npm run build && node scripts/verify-main.mjs     (or: npm run verify:main)
//
// Exits non-zero on the first failed assertion so it is usable as a gate.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist/src");
const { bootstrap, productionYield, createRandom } = await import(`${dist}/main.js`);
const { CONTROL_IDS } = await import(`${dist}/adapters/dom-controls.js`);

/** A recording fake 2D context: records the draw ops the harness asserts on; everything else no-ops. */
function makeFakeCtx() {
  const ops = [];
  const record = (type) => (...args) => ops.push({ type, args });
  return {
    ops,
    // Mutable state props (set by the renderer, ignored here).
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    lineJoin: "",
    lineCap: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    setTransform: record("setTransform"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    fill: record("fill"),
    stroke: record("stroke"),
    fillText: record("fillText"),
    countOf(type) {
      return ops.filter((o) => o.type === type).length;
    },
  };
}

/** A fake DOM element: records listeners + lets the harness dispatch events synchronously. */
function fakeEl(props = {}) {
  const listeners = {};
  return {
    style: {},
    disabled: false,
    checked: false,
    value: "",
    textContent: "",
    ...props,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };
}

/** A fake canvas: a fakeEl that also exposes a 2D context + a layout box (for the renderer). */
function fakeCanvas(ctx) {
  return fakeEl({
    width: 794,
    height: 1123,
    clientLeft: 0,
    clientTop: 0,
    getContext: (type) => (type === "2d" ? ctx : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 794, height: 1123 }),
  });
}

/**
 * A fake document whose getElementById returns a fresh fake per CONTROL_IDS (the canvas backed by a
 * recording ctx). `value`/`checked` mirror index.html's defaults (90 waypoints, both toggles on) so the
 * auto-generate runs the production default count. Returns the doc, the elements, and the ctx.
 */
function makeFakeDoc() {
  const ctx = makeFakeCtx();
  const els = {
    [CONTROL_IDS.generateButton]: fakeEl(),
    [CONTROL_IDS.clearButton]: fakeEl(),
    [CONTROL_IDS.waypointInput]: fakeEl({ value: "90" }),
    [CONTROL_IDS.wildcardsToggle]: fakeEl({ checked: true }),
    [CONTROL_IDS.turnsToggle]: fakeEl({ checked: true }),
    [CONTROL_IDS.printButton]: fakeEl(),
    [CONTROL_IDS.loadingOverlay]: fakeEl(),
    [CONTROL_IDS.errorOverlay]: fakeEl(),
    [CONTROL_IDS.canvas]: fakeCanvas(ctx),
    [CONTROL_IDS.tooltip]: fakeEl(),
  };
  return { ctx, els, doc: { getElementById: (id) => els[id] ?? null } };
}

/**
 * Reject if `promise` does not settle within `ms`. Turns US-021's "auto-generate on load" into a real
 * assertion that the bounded generator (ADR-0002) actually settles — a regression that made generation
 * unbounded would hang the awaited promise, and the timeout trips it as a failed check rather than
 * hanging the whole gate forever. The timer is unref'd so it never keeps the process alive.
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label}: did not settle within ${ms}ms (unbounded generation / hang?)`)),
        ms
      );
      timer.unref?.();
    }),
  ]);
}

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}

// ── AC: the production Yield port's yieldToEventLoop() is a MACROTASK, not a microtask ──
// GenerateWalk awaits it between batches so the browser can paint the overlay + spin the CSS spinner; a
// microtask (Promise.resolve / queueMicrotask) drains within the current event-loop turn before the
// browser ever paints, starving the overlay. Discriminator: schedule the yield's continuation, THEN a
// fresh Promise.resolve microtask. A macrotask resolves on a LATER loop turn, so the freshly-queued
// microtask runs first → ["microtask", "yield"]. A microtask yield resolves in the SAME checkpoint, FIFO
// before the later-queued microtask → ["yield", "microtask"]. Robust to any macrotask impl (setTimeout /
// setImmediate / MessageChannel), since every macrotask is strictly later than the current microtask flush.
{
  const order = [];
  const yieldDone = productionYield.yieldToEventLoop().then(() => order.push("yield"));
  Promise.resolve().then(() => order.push("microtask"));
  await yieldDone;
  assert.deepEqual(
    order,
    ["microtask", "yield"],
    "yieldToEventLoop must be a MACROTASK (resolves after a freshly-queued microtask), or paint is starved"
  );
  ok("Production Yield port: yieldToEventLoop() is a macrotask (frees the event loop so the overlay can paint)");
}

// ── AC1: createRandom is a FRESH-per-call ENTROPY-seeded RandomSource factory (not a shared instance,
//         and not a fixed seed) ──
// Each Generate must get an independent deterministic stream — a shared mutable source would make walk N
// depend on every prior draw, breaking US-022's single-seed reproducibility; and AC1 mandates the
// production default is ENTROPY-seeded, so two factory calls must yield DIFFERENT streams. A fixed-seed
// regression (e.g. `new SeededRandom(0)`) keeps the factory returning distinct instances yet identical
// streams — so the distinct-instance check alone is too weak; we also compare a short prefix of each.
{
  const a = createRandom();
  const b = createRandom();
  assert.notEqual(a, b, "createRandom() returns a fresh instance each call (not a shared/cached source)");

  // Sample a short prefix of each stream up front so we can both (i) prove entropy-seeding — two
  // independent streams, not a fixed seed — and (ii) range-check the drawn floats.
  const sample = (r) => Array.from({ length: 4 }, () => r.nextFloat());
  const streamA = sample(a);
  const streamB = sample(b);

  // AC1 "entropy-seeded by default": independent entropy seeds yield different streams. A regression to a
  // FIXED seed would make both prefixes identical — caught here. (Collision on 4 consecutive 32-bit draws
  // is ~2^-128, so this is not flaky.)
  assert.notDeepEqual(
    streamA,
    streamB,
    "createRandom() must be ENTROPY-seeded (two sources produce different streams), not a fixed seed"
  );

  for (const [label, stream] of [["first", streamA], ["second", streamB]]) {
    for (const f of stream) {
      assert.ok(f >= 0 && f < 1, `${label} source nextFloat() is in [0, 1)`);
    }
  }
  for (const [label, r] of [["first", a], ["second", b]]) {
    const n = r.nextInt(60, 140);
    assert.ok(Number.isInteger(n) && n >= 60 && n <= 140, `${label} source nextInt(60,140) is an int in range`);
  }
  ok("createRandom(): a fresh, ENTROPY-seeded, functional RandomSource per call (distinct streams, not a fixed seed)");
}

// ── AC2 (the headline): bootstrap wires the real adapters + use cases and auto-generates on load ──
// Drive the REAL composition (CanvasRenderer ← ClearWalk/GenerateWalk ← walkGenerator, with the REAL
// productionYield macrotask) through a fake document, await the auto-generate promise (within a timeout
// so a hang trips a check, not the gate), and assert the canvas is NOT blank: a waypoint circle (arc) and
// number (fillText) per waypoint, plus the connecting path (stroke). Counts use `>=` so the assertion is
// independent of the entropy-driven walk shape (a 90-waypoint walk always draws ≥ 90 circles + numbers).
{
  const { ctx, doc } = makeFakeDoc();
  const { controls, autoGenerated } = bootstrap(doc);
  assert.ok(controls, "bootstrap returns the wired controls");
  assert.ok(autoGenerated instanceof Promise, "bootstrap returns the auto-generate promise");

  // Nothing should have been drawn before the auto-generate settles beyond the in-flight clear.
  await withTimeout(autoGenerated, 5000, "auto-generate on load (US-021 AC2)");

  const circles = ctx.countOf("arc");
  const labels = ctx.countOf("fillText");
  assert.ok(circles >= 90, `auto-generated walk draws a circle per waypoint (≥90 arcs); got ${circles}`);
  assert.ok(labels >= 90, `auto-generated walk draws a number per waypoint (≥90 fillTexts); got ${labels}`);
  assert.ok(ctx.countOf("stroke") >= 1, "auto-generated walk draws the connecting path (≥1 stroke)");
  ok("bootstrap auto-generates a walk on load — the canvas is never blank (US-021 AC2), via the real pipeline");
}

// ── AC1: the production RandomSource is ENTROPY-seeded BY DEFAULT — proven through the WHOLE composition ──
// The check above counts circles only, so it is shape-independent: a fixed-seed regression would draw the
// IDENTICAL walk on every load and still pass it. Here two independent page loads must auto-generate
// DIFFERENT walks, proving bootstrap actually WIRES the entropy `createRandom` factory end-to-end (not a
// hardcoded seed). Fingerprint = the ordered geometry the renderer emitted (moveTo/lineTo/arc args); two
// entropy-seeded count=90 walks share a fingerprint with ~0 probability (different turn sequence AND 88
// independently-drawn segment lengths), so only a fixed seed makes them equal — not flaky.
{
  const fingerprint = (ctx) =>
    JSON.stringify(
      ctx.ops.filter((o) => o.type === "moveTo" || o.type === "lineTo" || o.type === "arc").map((o) => o.args)
    );

  const first = makeFakeDoc();
  const second = makeFakeDoc();
  const a = bootstrap(first.doc);
  const b = bootstrap(second.doc);
  await withTimeout(a.autoGenerated, 5000, "entropy load #1");
  await withTimeout(b.autoGenerated, 5000, "entropy load #2");

  const fpA = fingerprint(first.ctx);
  const fpB = fingerprint(second.ctx);
  assert.ok(fpA.length > 2 && fpB.length > 2, "both loads drew a non-empty walk (geometry recorded)");
  assert.notEqual(
    fpA,
    fpB,
    "two page loads auto-generate DIFFERENT walks — the RandomSource is entropy-seeded by default, not a fixed seed"
  );
  ok("bootstrap is entropy-seeded end-to-end: two loads draw different walks (AC1 'entropy-seeded by default')");
}

// ── AC: the controls bootstrap returns are LIVE — wired to the real renderer + use cases end-to-end ──
// Clear empties the canvas (a fresh clearRect with nothing redrawn), and a subsequent Generate draws a
// new walk — proving bootstrap handed back interactive controls bound to the real CanvasRenderer.
{
  const { ctx, doc } = makeFakeDoc();
  const { controls, autoGenerated } = bootstrap(doc);
  await withTimeout(autoGenerated, 5000, "auto-generate before interactivity check");

  // Clear: the renderer resets the transform + clears, and draws nothing new.
  ctx.ops.length = 0;
  controls.clear();
  assert.ok(ctx.countOf("clearRect") >= 1, "Clear reaches the real CanvasRenderer (clearRect)");
  assert.equal(ctx.countOf("arc"), 0, "Clear draws no waypoints");

  // Generate again: a new walk is drawn (controls are live + wired to the real GenerateWalk).
  ctx.ops.length = 0;
  await withTimeout(controls.generate(), 5000, "second generate via the returned controls");
  assert.ok(ctx.countOf("arc") >= 90, "a fresh Generate via the returned controls draws a new walk");
  ok("bootstrap returns LIVE controls wired to the real renderer + use cases (Clear empties, Generate redraws)");
}

// ── Robustness: bootstrap fails loudly when the canvas element is missing ──
// A markup/composition mismatch should throw at startup with a clear message, not silently no-op or
// surface an opaque error deep in the renderer.
{
  const { doc } = makeFakeDoc();
  const noCanvasDoc = { getElementById: (id) => (id === CONTROL_IDS.canvas ? null : doc.getElementById(id)) };
  assert.throws(
    () => bootstrap(noCanvasDoc),
    /canvas .*not found/i,
    "bootstrap throws a clear error when the #walk-canvas element is missing"
  );
  ok("bootstrap throws a clear error when the canvas element is missing (fails loudly at startup)");
}

console.log(`\nAll ${passed} composition-root (main.ts) checks passed.`);
