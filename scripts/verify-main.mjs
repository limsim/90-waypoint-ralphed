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
// It also exercises the module's AUTO-RUN-on-load guard (the top-level `if (typeof document !== …)`
// block + its readyState / DOMContentLoaded branching) — the "auto" in "auto-generate on FIRST PAGE
// LOAD" (AC2). Every direct `bootstrap()` call below proves the wiring; the auto-run checks prove the
// module wires ITSELF up on load. They re-import main.js under a fresh URL (a `?autorun=` query, which
// Node treats as a distinct module) so its top-level code re-evaluates against a stubbed global
// `document`; importing it with NO document (line ~21, the very first import) is side-effect-free by
// design (the guard) — proven by that import succeeding and exporting bootstrap.
//
//   npm run build && node scripts/verify-main.mjs     (or: npm run verify:main)
//
// Exits non-zero on the first failed assertion so it is usable as a gate.
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist/src");
const mainUrl = pathToFileURL(resolve(dist, "main.js")).href;
// First import: NO global `document`, so the auto-run guard skips and this is side-effect-free. If the
// guard were missing, bootstrap() would run here and throw on `document` — so a clean import already
// proves the "importing main.js in Node has no side effects" clause.
const { bootstrap, productionYield, createRandom } = await import(mainUrl);
const { CONTROL_IDS } = await import(`${dist}/adapters/dom-controls.js`);
const { productionWalkUrl } = await import(`${dist}/adapters/walk-url.js`);

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

/** One macrotask hop — lets pending timers (the generator's macrotask yields) fire. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Poll `pred` once per macrotask tick until it holds, up to `maxTicks`. Used by the auto-run checks:
 * the module's top-level `bootstrap()` discards its `autoGenerated` promise, so there is no handle to
 * await — instead we wait for the canvas to be drawn. The tick cap is a bound (the generator is bounded,
 * ADR-0002): a hang / un-wired auto-run trips a clear error rather than spinning forever.
 */
async function pollUntil(pred, maxTicks, label) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`${label}: condition not met after ${maxTicks} ticks (auto-run not wired / unbounded?)`);
}

/** Re-import main.js under a fresh URL so its top-level auto-run guard re-evaluates against `globalThis.document`. */
function importFreshMain(tag) {
  return import(`${mainUrl}?autorun=${tag}`);
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
  assert.notEqual(a.source, b.source, "createRandom() returns a fresh source each call (not a shared/cached one)");
  assert.ok(Number.isInteger(a.seed) && Number.isInteger(b.seed), "createRandom() REPORTS an integer seed (US-022 — reflected to the URL)");

  // Sample a short prefix of each stream up front so we can both (i) prove entropy-seeding — two
  // independent streams, not a fixed seed — and (ii) range-check the drawn floats.
  const sample = (r) => Array.from({ length: 4 }, () => r.nextFloat());
  const streamA = sample(a.source);
  const streamB = sample(b.source);

  // AC1 "entropy-seeded by default": independent entropy seeds yield different seeds AND streams. A
  // regression to a FIXED seed would make both identical — caught here. (Collision on a 32-bit seed /
  // 4 consecutive 32-bit draws is ~2^-32 / ~2^-128, so this is not flaky.)
  assert.notEqual(a.seed, b.seed, "createRandom() is ENTROPY-seeded — two calls choose different seeds, not a fixed one");
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
  for (const [label, s] of [["first", a], ["second", b]]) {
    const n = s.source.nextInt(60, 140);
    assert.ok(Number.isInteger(n) && n >= 60 && n <= 140, `${label} source nextInt(60,140) is an int in range`);
  }
  ok("createRandom(): a fresh, ENTROPY-seeded, functional source per call that REPORTS its seed (US-022)");
}

// ── US-022 AC3: createRandom(seed) REPRODUCES a seed's stream and reports the canonical seed ──
// This is the basis of `?seed=` reproducibility: given the seed from a shared URL, the factory rebuilds
// the exact same stream, so the same walk is regenerated. Two calls with the same seed must be identical.
{
  const seed = 0x12345678; // 305419896
  const a = createRandom(seed);
  const b = createRandom(seed);
  assert.equal(a.seed, seed, "createRandom(seed) reports the seed it used");
  assert.equal(b.seed, seed, "...for both calls");
  const sample = (r) => Array.from({ length: 8 }, () => r.nextFloat());
  assert.deepEqual(
    sample(a.source),
    sample(b.source),
    "createRandom(seed) reproduces the SAME stream for the same seed (US-022 determinism)"
  );
  ok("createRandom(seed): reproduces a seed's stream and reports the canonical seed (US-022 AC3)");
}

// ── US-022 AC: productionWalkUrl reads ?seed=/?count= and reflects via history.replaceState ──
// The live URL gateway touches window.location + history; stub them to drive read/reflect headlessly.
// (In the bootstrap checks below, window is ABSENT, so the gateway is a safe no-op by design — see
// walk-url.ts — which is why those checks see the unchanged entropy behaviour.)
{
  let replaced = null;
  globalThis.window = {
    location: { search: "?seed=42&count=30&keep=1", pathname: "/app", hash: "#frag" },
    history: {
      replaceState: (_state, _title, url) => {
        replaced = url;
      },
    },
  };
  try {
    assert.deepEqual(productionWalkUrl.read(), { seed: 42, count: 30 }, "read() parses ?seed= and ?count= as integers");

    productionWalkUrl.reflect({ seed: 4242, count: 90 });
    assert.ok(replaced !== null, "reflect() calls history.replaceState (updates the URL WITHOUT reloading)");
    const out = new URL(`http://x${replaced}`);
    assert.equal(out.pathname, "/app", "reflect() preserves the path");
    assert.equal(out.hash, "#frag", "reflect() preserves the hash");
    assert.equal(out.searchParams.get("seed"), "4242", "reflect() writes the new seed");
    assert.equal(out.searchParams.get("count"), "90", "reflect() writes the new count");
    assert.equal(out.searchParams.get("keep"), "1", "reflect() preserves other query params");

    // Round-trip: reading the reflected URL back yields exactly the reflected seed + count (AC3).
    globalThis.window.location.search = out.search;
    assert.deepEqual(
      productionWalkUrl.read(),
      { seed: 4242, count: 90 },
      "the reflected URL reads back as the same seed + count (round-trip)"
    );
  } finally {
    globalThis.window = undefined;
  }
  ok("productionWalkUrl: reads ?seed=/?count=, reflects via replaceState (preserving path/hash/params), round-trips (US-022)");
}

// ── US-022: blank/non-numeric params and the no-window (Node) path both read as "no params" ──
// So with no — or an invalid — ?seed=, behaviour is unchanged (a fresh entropy walk), and importing /
// driving the module in Node never touches `window`.
{
  globalThis.window = {
    location: { search: "?seed=&count=abc", pathname: "/", hash: "" },
    history: { replaceState() {} },
  };
  try {
    assert.deepEqual(
      productionWalkUrl.read(),
      { seed: null, count: null },
      "blank/non-numeric params read as null (entropy default, behaviour unchanged)"
    );
  } finally {
    globalThis.window = undefined;
  }
  assert.deepEqual(productionWalkUrl.read(), { seed: null, count: null }, "with no window (Node), read() reports no params");
  ok("productionWalkUrl: invalid/missing params and the Node no-window path both read as 'no params'");
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

// ── US-022 (AC2/AC4): bootstrap wires productionWalkUrl, so the auto-generated walk's seed + count
//     are reflected into the URL on load ──
// The checks above run with NO window, so the URL gateway is a no-op and never observed. Here we stub
// window.location + history (empty search → entropy walk, count 90 from the default input) and assert
// that bootstrap's auto-generate reflected a shareable ?seed=&count= URL via history.replaceState —
// proving the composition root actually wires productionWalkUrl into DomControls, not a no-op double.
{
  const { ctx, doc } = makeFakeDoc();
  let reflectedUrl = null;
  globalThis.window = {
    location: { search: "", pathname: "/", hash: "" },
    history: {
      replaceState: (_state, _title, url) => {
        reflectedUrl = url;
      },
    },
  };
  try {
    const { autoGenerated } = bootstrap(doc);
    await withTimeout(autoGenerated, 5000, "auto-generate with URL reflection (US-022)");
    assert.ok(ctx.countOf("arc") >= 90, "the auto-generated walk drew (sanity)");
    assert.ok(reflectedUrl !== null, "bootstrap's auto-generate reflected the URL (productionWalkUrl is wired, not a no-op)");
    const params = new URL(`http://x${reflectedUrl}`).searchParams;
    assert.ok(/^\d+$/.test(params.get("seed") ?? ""), "reflected URL carries a numeric seed");
    assert.equal(params.get("count"), "90", "reflected URL carries the auto-generate count (90)");
  } finally {
    globalThis.window = undefined;
  }
  ok("US-022 (AC2): bootstrap reflects the auto-generated walk's seed + count to the URL (productionWalkUrl wired)");
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

// ── AC2 (the AUTO part): the module AUTO-RUNS bootstrap on load, so the page is never blank ──
// Every check above calls bootstrap() BY HAND — none proves main.js wires ITSELF up at load time. AC2 is
// "automatically generated on FIRST PAGE LOAD" and AC5 shows a walk "on load": the load-time invocation
// is the "auto". A regression deleting / breaking the top-level `if (typeof document !== "undefined")`
// block would ship a BLANK page yet keep every direct-bootstrap check above green. We stub a global
// `document` and re-import main.js under a fresh URL so its top-level re-evaluates against the stub.
// Children resolve without the query string, so CONTROL_IDS / SeededRandom etc. are the shared instances.

// (a) A READY document (readyState !== "loading", as for a deferred `type="module"` entry) auto-runs
//     bootstrap IMMEDIATELY (no DOMContentLoaded wait) and the canvas ends up drawn.
{
  const { ctx, els } = makeFakeDoc();
  let waitedForDomContentLoaded = false;
  globalThis.document = {
    readyState: "complete",
    getElementById: (id) => els[id] ?? null,
    addEventListener() {
      waitedForDomContentLoaded = true;
    },
  };
  try {
    await importFreshMain("ready");
    assert.equal(
      waitedForDomContentLoaded,
      false,
      "a ready document must NOT defer to DOMContentLoaded — it auto-runs immediately"
    );
    await pollUntil(() => ctx.countOf("arc") >= 90, 500, "auto-run on a ready document");
    assert.ok(ctx.countOf("arc") >= 90, "the module auto-generated a walk on load (ready document)");
  } finally {
    globalThis.document = undefined;
  }
  ok("main.js AUTO-RUNS bootstrap on load when the document is ready — the page is never blank (AC2/AC5 'on load')");
}

// (b) A still-LOADING document (readyState === "loading") DEFERS bootstrap to DOMContentLoaded — nothing
//     is drawn until the event fires. Guards the belt-and-braces fallback path.
{
  const { ctx, els } = makeFakeDoc();
  let domContentLoaded = null;
  globalThis.document = {
    readyState: "loading",
    getElementById: (id) => els[id] ?? null,
    addEventListener(type, fn) {
      if (type === "DOMContentLoaded") domContentLoaded = fn;
    },
  };
  try {
    await importFreshMain("loading");
    await tick(); // give any (erroneous) immediate bootstrap a chance to draw — it must NOT
    assert.equal(ctx.countOf("arc"), 0, "bootstrap is DEFERRED while the document is still loading (nothing drawn yet)");
    assert.equal(typeof domContentLoaded, "function", "a DOMContentLoaded listener is registered while loading");
    domContentLoaded(); // simulate the browser firing the event
    await pollUntil(() => ctx.countOf("arc") >= 90, 500, "auto-run after DOMContentLoaded");
    assert.ok(ctx.countOf("arc") >= 90, "bootstrap runs and draws once DOMContentLoaded fires");
  } finally {
    globalThis.document = undefined;
  }
  ok("main.js DEFERS the auto-run to DOMContentLoaded when the document is still loading (fallback path)");
}

console.log(`\nAll ${passed} composition-root (main.ts) checks passed.`);
