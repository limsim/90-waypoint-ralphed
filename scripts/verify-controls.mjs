// Headless verification harness for the DOM controls adapter (US-016).
//
// `tsconfig.test.json` references core only, so `tests/**` cannot import the DOM-bound adapters and
// `npm test` does not cover them (see src/adapters/CLAUDE.md). This script is the headless stand-in:
// it imports the COMPILED adapter from dist/ (runtime JS has no type checks, so the DOM-typed adapter
// loads in plain Node), drives a REAL GenerateWalk / ClearWalk through DomControls with hand-rolled
// fake DOM elements + a recording fake Renderer, and asserts every control behaviour the acceptance
// criteria call for.
//
//   npm run build && node scripts/verify-controls.mjs     (or: npm run verify:controls)
//
// Exits non-zero on the first failed assertion so it is usable as a gate.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist/src");
const { DomControls, CONTROL_IDS } = await import(`${dist}/adapters/dom-controls.js`);
const { GenerateWalk } = await import(`${dist}/application/generate-walk.js`);
const { ClearWalk } = await import(`${dist}/application/clear-walk.js`);
const { SeededRandom } = await import(`${dist}/domain/seeded-random.js`);
const { Bounds } = await import(`${dist}/domain/bounds.js`);

const SEED = 4242;

/**
 * A generator config that NO placement can satisfy: a 100×100 region too small to fit even a
 * 10-waypoint walk, with no growth (`maxGrowths: 0`) so a bigger canvas never rescues it, exhausting
 * in a few bounded re-rolls. Mirrors `tests/generate-walk.test.ts`'s `EXHAUSTING_CONFIG`, so US-020's
 * end-to-end failure check drives the SAME proven exhausted-re-roll path. DomControls passes no config
 * to `execute`, so the test wraps `execute` to inject this as the third argument.
 */
const EXHAUSTING_CONFIG = {
  initialRegion: new Bounds(0, 0, 100, 100),
  maxGrowths: 0,
  maxPlacementAttempts: 3,
  maxRerolls: 3,
};

/** A fake DOM element: records added listeners + lets the harness dispatch events synchronously. */
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
    // Mouse-event listeners (US-017) read event.clientX/clientY — dispatch forwards an optional event.
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };
}

/** A fake canvas: a fakeEl that also reports a layout box (for hit-testing / tooltip positioning). */
function fakeCanvas(rect = { left: 0, top: 0, width: 794, height: 1123 }) {
  return fakeEl({ getBoundingClientRect: () => rect });
}

/**
 * A recording fake InteractiveRenderer (the driven port). Tracks draw/clear calls + the on-screen
 * walk, plus US-017's hit-testing and hover highlight: `hitTarget` is what `hitTest` returns (set by
 * the test), `hitArgs` records the (clientX, clientY) it was called with, and `highlights` records
 * every `highlight()` argument. The real coordinate-inversion `hitTest` is proven in verify-renderer.
 */
function makeFakeRenderer() {
  const calls = [];
  return {
    calls,
    current: null,
    hitTarget: null,
    hitArgs: [],
    highlights: [],
    draw(walk, options) {
      calls.push({ type: "draw", walk, options });
      this.current = walk;
    },
    clear() {
      calls.push({ type: "clear" });
      this.current = null;
    },
    hitTest(clientX, clientY) {
      this.hitArgs.push([clientX, clientY]);
      return this.hitTarget;
    },
    highlight(waypoint) {
      this.highlights.push(waypoint);
      calls.push({ type: "highlight", waypoint });
    },
    drawsOf() {
      return calls.filter((c) => c.type === "draw");
    },
    clearsOf() {
      return calls.filter((c) => c.type === "clear");
    },
  };
}

/** A fresh set of control elements with the index.html defaults (90 waypoints, both toggles on). */
function makeElements() {
  return {
    generateButton: fakeEl(),
    clearButton: fakeEl(),
    waypointInput: fakeEl({ value: "90" }),
    wildcardsToggle: fakeEl({ checked: true }),
    turnsToggle: fakeEl({ checked: true }),
    printButton: fakeEl(),
    loadingOverlay: fakeEl(),
    errorOverlay: fakeEl(),
    canvas: fakeCanvas(),
    tooltip: fakeEl(),
  };
}

/** A real-ish dependency set built around a fresh recording renderer + a seeded source factory. */
function makeDeps(yieldPort = { yieldToEventLoop: () => Promise.resolve() }, seed = SEED) {
  const renderer = makeFakeRenderer();
  return {
    deps: {
      generateWalk: new GenerateWalk(yieldPort),
      clearWalk: new ClearWalk(renderer),
      renderer,
      createRandom: () => new SeededRandom(seed),
    },
    renderer,
  };
}

/** Drain all pending microtasks (the immediate Yield port resolves as microtasks). */
const drainMicrotasks = () => new Promise((r) => setImmediate(r));

/**
 * Reject if `promise` does not settle within `ms`. This turns US-020 AC2 ("the UI never hangs") into a
 * real assertion: a regression that made generation unbounded would hang the awaited `generate()`, and
 * the timeout trips it as a failed check rather than hanging the whole gate forever. The timer is
 * unref'd so it never keeps the process alive once the promise wins.
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

// ── AC: Generate clears the canvas, draws a fresh walk; overlay + disabled DURING, restored after ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);

  const promise = controls.generate();
  // setBusy(true) runs synchronously before the first await — assert the in-flight UI state.
  assert.equal(els.generateButton.disabled, true, "Generate button disabled during generation");
  assert.equal(els.loadingOverlay.style.display, "flex", "overlay shown during generation");

  await promise;
  assert.equal(els.generateButton.disabled, false, "Generate button re-enabled after generation");
  assert.equal(els.loadingOverlay.style.display, "none", "overlay hidden after generation");

  assert.ok(renderer.clearsOf().length >= 1, "canvas cleared during generate");
  assert.equal(renderer.drawsOf().length, 1, "exactly one draw after a successful generate");
  const draw = renderer.drawsOf()[0];
  assert.equal(draw.walk.waypointCount, 90, "default waypoint count (90) is generated");
  assert.deepEqual(
    draw.options,
    { showWildcards: true, showTurns: true },
    "default display options (both toggles on)"
  );
  // The clear precedes the draw (cleared, then the fresh walk is painted).
  assert.equal(renderer.calls[0].type, "clear", "clear happens before the draw");
  ok("Generate: clears, draws the fresh walk, overlay+disabled during, restored after");
}

// ── AC: clicking Generate is wired and triggers a generation end-to-end ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);

  els.generateButton.dispatch("click");
  // setBusy(true) is synchronous; the event loop is freed via the (microtask) Yield port.
  assert.equal(els.generateButton.disabled, true, "click disables the button synchronously");
  await drainMicrotasks();
  assert.ok(renderer.drawsOf().length === 1, "click click-wiring runs a generation to a draw");
  assert.equal(els.generateButton.disabled, false, "controls restored after click-driven generate");
  ok("Generate button click is wired to the GenerateWalk use case");
}

// ── AC: Clear removes everything from the canvas (and is wired to the click) ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);
  await controls.generate();

  renderer.calls.length = 0;
  els.clearButton.dispatch("click");
  assert.equal(renderer.clearsOf().length, 1, "Clear button calls renderer.clear once");
  assert.equal(renderer.drawsOf().length, 0, "Clear never draws");
  ok("Clear button removes all waypoints/lines from the canvas");
}

// ── AC: toggles redraw the SAME walk with new options, never regenerating ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);
  await controls.generate();
  const generatedWalk = renderer.drawsOf()[0].walk;

  // Show Wildcards off → ring suppressed, turns unaffected, same walk redrawn (no new generation).
  renderer.calls.length = 0;
  els.wildcardsToggle.checked = false;
  els.wildcardsToggle.dispatch("change");
  assert.equal(renderer.drawsOf().length, 1, "toggling wildcards redraws exactly once");
  assert.equal(renderer.clearsOf().length, 0, "toggling does not clear / regenerate");
  assert.equal(renderer.drawsOf()[0].walk, generatedWalk, "redraw reuses the SAME walk object");
  assert.deepEqual(
    renderer.drawsOf()[0].options,
    { showWildcards: false, showTurns: true },
    "Show Wildcards toggles only the wildcard option"
  );

  // Show Turns off → labels suppressed; wildcard option independent (still off from above).
  renderer.calls.length = 0;
  els.turnsToggle.checked = false;
  els.turnsToggle.dispatch("change");
  assert.deepEqual(
    renderer.drawsOf()[0].options,
    { showWildcards: false, showTurns: false },
    "Show Turns toggles only the turns option (independent of wildcards)"
  );
  assert.equal(renderer.drawsOf()[0].walk, generatedWalk, "turns redraw still reuses the same walk");
  ok("Show Wildcards / Show Turns redraw the same walk with independent options");
}

// ── AC: a toggle with no current walk is a no-op (nothing to redraw) ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);

  els.wildcardsToggle.dispatch("change");
  assert.equal(renderer.drawsOf().length, 0, "no redraw before any walk exists");

  // ...and after a Clear, the walk is forgotten so toggles stop redrawing.
  await controls.generate();
  controls.clear();
  renderer.calls.length = 0;
  els.turnsToggle.dispatch("change");
  assert.equal(renderer.drawsOf().length, 0, "no redraw after Clear forgets the walk");
  ok("Toggles are a no-op with no current walk (before first generate / after Clear)");
}

// ── AC: Waypoints input sets the count for the next generation, clamped to [10, 90] ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);

  const counts = [
    ["10", 10, "minimum"],
    ["55", 55, "in range"],
    ["90", 90, "maximum"],
    ["5", 10, "below range clamps up to 10"],
    ["999", 90, "above range clamps down to 90"],
    ["", 90, "blank falls back to default 90"],
    ["42abc", 42, "trailing junk parses the leading integer"],
  ];
  for (const [value, expected, label] of counts) {
    renderer.calls.length = 0;
    els.waypointInput.value = value;
    await controls.generate();
    const draw = renderer.drawsOf().at(-1);
    assert.equal(draw.walk.waypointCount, expected, `waypoint count "${value}" → ${expected} (${label})`);
  }
  ok("Waypoints input drives the next generation's count, clamped to [10, 90]");
}

// ── AC: Print opens the browser print dialog ──
{
  const { deps } = makeDeps();
  const els = makeElements();
  const controls = new DomControls(deps, els);

  let printed = 0;
  globalThis.window = { print: () => printed++ };
  try {
    els.printButton.dispatch("click");
    assert.equal(printed, 1, "Print button calls window.print once");
  } finally {
    delete globalThis.window;
  }
  ok("Print button opens the browser print dialog");
}

// ── US-020 AC: the exhausted-re-roll failure signal shows the error overlay; controls restored ──
// GenerateWalk surfaces { ok:false } when the bounded generator (ADR-0002) gives up — the UI must
// show a clear message over the (cleared) canvas and re-enable the controls, never hang or go silent.
{
  const renderer = makeFakeRenderer();
  const deps = {
    generateWalk: { execute: async () => ({ ok: false, reason: "exhausted", attempts: 9, rerolls: 2 }) },
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await controls.generate();
  assert.equal(renderer.clearsOf().length, 1, "failed generate still cleared the canvas");
  assert.equal(renderer.drawsOf().length, 0, "failed generate draws nothing (the error overlay stands in)");
  assert.equal(els.errorOverlay.style.display, "flex", "error overlay SHOWN on the failure signal (US-020)");
  assert.equal(els.generateButton.disabled, false, "controls restored after a failed generation (button re-enabled)");
  assert.equal(els.loadingOverlay.style.display, "none", "loading overlay hidden after a failed generation");
  ok("Failure signal (US-020): error overlay shown over the cleared canvas, controls restored in finally");
}

// ── US-020: a successful retry after a failure dismisses the error; a plain success never shows it ──
// The leading clear() in generate() hides any prior error, so retrying (or reducing the count) starts
// clean — and a success must leave the error overlay hidden.
{
  const renderer = makeFakeRenderer();
  let failNext = true;
  const deps = {
    generateWalk: {
      execute: async () =>
        failNext ? { ok: false, reason: "exhausted", attempts: 9, rerolls: 2 } : { ok: true, walk: { waypointCount: 90 } },
    },
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await controls.generate();
  assert.equal(els.errorOverlay.style.display, "flex", "error shown after the first (failed) generate");

  // Retry — this one succeeds: the error must be dismissed and the walk drawn.
  failNext = false;
  await controls.generate();
  assert.equal(els.errorOverlay.style.display, "none", "error dismissed by a successful retry");
  assert.equal(renderer.drawsOf().length, 1, "the successful retry drew the walk");
  ok("Successful retry dismisses the error overlay; a plain success never shows it");
}

// ── US-020: Clear dismisses an error left by a failed generation ──
{
  const renderer = makeFakeRenderer();
  const deps = {
    generateWalk: { execute: async () => ({ ok: false, reason: "exhausted", attempts: 9, rerolls: 2 }) },
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await controls.generate();
  assert.equal(els.errorOverlay.style.display, "flex", "error shown after the failed generate");
  els.clearButton.dispatch("click");
  assert.equal(els.errorOverlay.style.display, "none", "Clear dismisses the generation-failure error");
  ok("Clear dismisses the generation-failure error overlay");
}

// ── US-020 AC2 end-to-end: the REAL bounded generator reaches { ok:false } WITHOUT hanging ──
// The three checks above stub `generateWalk.execute` to return { ok:false } instantly, proving only
// the adapter's REACTION to a failure signal. This one mirrors the SUCCESS path (which drives a real
// GenerateWalk via makeDeps) on the FAILURE side: it drives the REAL walkGenerator — through the REAL
// GenerateWalk iterator-driver — to its exhausted-re-roll failure with a config no placement can
// satisfy (EXHAUSTING_CONFIG). AC2 ("this path is reached via the bounded generator, not an infinite
// loop") is asserted two ways: (a) the awaited generate() SETTLES within a generous timeout — an
// unbounded/hung generator would trip it; (b) DomControls then shows the error + restores the controls
// on a GENUINE (non-stubbed) signal. DomControls calls execute(count, random) with no config, so wrap
// execute to inject EXHAUSTING_CONFIG as the third argument.
{
  const renderer = makeFakeRenderer();
  const realGenerate = new GenerateWalk({ yieldToEventLoop: () => Promise.resolve() });
  const deps = {
    generateWalk: {
      execute: (count, random) => realGenerate.execute(count, random, EXHAUSTING_CONFIG),
    },
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  els.waypointInput.value = "10"; // count=10: the proven exhausting case (nothing fits a 100×100 region)
  const controls = new DomControls(deps, els);

  await withTimeout(
    controls.generate(),
    5000,
    "real bounded-generator failure (US-020 AC2: must not hang)"
  );
  assert.equal(renderer.drawsOf().length, 0, "a real bounded-generator failure draws nothing");
  assert.equal(
    els.errorOverlay.style.display,
    "flex",
    "error overlay shown for a REAL bounded-generator failure (US-020)"
  );
  assert.equal(
    els.generateButton.disabled,
    false,
    "controls restored after a real bounded failure (button re-enabled)"
  );
  assert.equal(els.loadingOverlay.style.display, "none", "loading overlay hidden after a real bounded failure");
  ok("End-to-end (US-020 AC2): the REAL bounded generator reaches { ok:false } without hanging → error overlay + controls restored");
}

// ── Robustness: controls restored in finally even when generation THROWS ──
{
  const renderer = makeFakeRenderer();
  const deps = {
    generateWalk: {
      execute: async () => {
        throw new Error("boom");
      },
    },
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await assert.rejects(() => controls.generate(), /boom/, "generate rethrows the underlying error");
  assert.equal(els.generateButton.disabled, false, "button restored after a thrown generation");
  assert.equal(els.loadingOverlay.style.display, "none", "overlay hidden after a thrown generation");
  ok("Thrown generation: controls still restored in finally (generate rethrows)");
}

// ── AC: the overlay stays up across the async generation while the event loop is free to paint ──
// DomControls shows the overlay, then AWAITS the (async) use case — it must not block the event
// loop, so the overlay/disabled state persist while external work runs, and only restore after the
// promise settles. (That GenerateWalk itself yields between batches is proven in US-011's tests; here
// we use a stub that suspends across two macrotask hops so the assertion is robust regardless of how
// many times a real generation happens to yield.)
{
  const renderer = makeFakeRenderer();
  const stubGenerate = {
    execute: async () => {
      // Two macrotask hops: external work queued after the first hop runs before the second resolves.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      return { ok: true, walk: { waypointCount: 90 } };
    },
  };
  const deps = {
    generateWalk: stubGenerate,
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  let externalRanWhileBusy = false;
  let finished = false;
  const promise = controls.generate().then(() => {
    finished = true;
  });
  // Queued right after generate suspends; it must run mid-generation, with the overlay still up.
  setImmediate(() => {
    if (!finished && els.loadingOverlay.style.display === "flex") externalRanWhileBusy = true;
  });
  await promise;
  assert.ok(externalRanWhileBusy, "external work ran mid-generation with the overlay visible");
  assert.equal(els.loadingOverlay.style.display, "none", "overlay restored after the async generate");
  assert.equal(els.generateButton.disabled, false, "button restored after the async generate");
  ok("Overlay persists across the async generation (event loop free to paint), restored after");
}

// ── AC: fromDocument resolves elements by id and wires them; missing element throws ──
{
  const { deps, renderer } = makeDeps();
  const els = makeElements();
  const byId = {
    [CONTROL_IDS.generateButton]: els.generateButton,
    [CONTROL_IDS.clearButton]: els.clearButton,
    [CONTROL_IDS.waypointInput]: els.waypointInput,
    [CONTROL_IDS.wildcardsToggle]: els.wildcardsToggle,
    [CONTROL_IDS.turnsToggle]: els.turnsToggle,
    [CONTROL_IDS.printButton]: els.printButton,
    [CONTROL_IDS.loadingOverlay]: els.loadingOverlay,
    [CONTROL_IDS.errorOverlay]: els.errorOverlay,
    [CONTROL_IDS.canvas]: els.canvas,
    [CONTROL_IDS.tooltip]: els.tooltip,
  };
  const fakeDoc = { getElementById: (id) => byId[id] ?? null };

  DomControls.fromDocument(deps, fakeDoc);
  els.clearButton.dispatch("click");
  assert.equal(renderer.clearsOf().length, 1, "fromDocument wired the Clear button by id");

  const missingDoc = { getElementById: () => null };
  assert.throws(
    () => DomControls.fromDocument(deps, missingDoc),
    /required element/i,
    "fromDocument throws a clear error when an element is missing"
  );
  ok("fromDocument resolves controls by id and fails loudly on a missing element");
}

// ── Robustness: controls restored in finally even when the pre-generation CLEAR step throws ──
// setBusy(true) runs first, then the whole operation (clear → generate → draw) runs inside the try,
// so a failure in ANY step — including the canvas clear — still hits the finally and restores the
// overlay/button. Guards against a regression that clears OUTSIDE the try (stranding the busy state).
{
  const renderer = makeFakeRenderer();
  const deps = {
    generateWalk: { execute: async () => ({ ok: true, walk: { waypointCount: 90 } }) },
    clearWalk: {
      execute: () => {
        throw new Error("clear boom");
      },
    },
    renderer,
    createRandom: () => new SeededRandom(SEED),
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await assert.rejects(() => controls.generate(), /clear boom/, "generate rethrows a clear failure");
  assert.equal(renderer.drawsOf().length, 0, "a clear failure aborts before any draw");
  assert.equal(els.generateButton.disabled, false, "button restored after a thrown clear");
  assert.equal(els.loadingOverlay.style.display, "none", "overlay hidden after a thrown clear");
  ok("Thrown clear step: controls still restored in finally (whole operation inside the try)");
}

// ── AC: each Generate uses a FRESH RandomSource via createRandom (seed-agnostic, US-022 depends on it) ──
// The adapter must call the injected createRandom() factory exactly once per generate and never reuse
// or cache a source — otherwise walk N would depend on prior draws, breaking single-seed reproducibility.
{
  let randomsCreated = 0;
  const renderer = makeFakeRenderer();
  const deps = {
    generateWalk: new GenerateWalk({ yieldToEventLoop: () => Promise.resolve() }),
    clearWalk: new ClearWalk(renderer),
    renderer,
    createRandom: () => {
      randomsCreated++;
      return new SeededRandom(SEED);
    },
  };
  const els = makeElements();
  const controls = new DomControls(deps, els);

  await controls.generate();
  assert.equal(randomsCreated, 1, "first Generate creates exactly one fresh RandomSource");
  await controls.generate();
  assert.equal(randomsCreated, 2, "second Generate creates a NEW source (no caching/reuse)");
  // Same seed each call → byte-identical walks, proving the factory (not a shared mutable source) is used.
  assert.deepEqual(
    renderer.drawsOf().map((d) => d.walk.waypointCount),
    [90, 90],
    "both generations produced a walk"
  );
  ok("Each Generate pulls a fresh RandomSource from createRandom (no shared/cached source)");
}

// ── AC: the LIVE index.html markup matches the adapter contract (the one un-faked seam) ──
// Every other check above uses fake elements / a fake document, so a drift between CONTROL_IDS and
// the real ids in index.html — or a change to the AC-mandated markup (input range/default, toggle
// defaults, overlay spinner+text) — would only blow up in the live browser (no MCP here) while the
// harness stayed green. This block reads the real index.html and asserts that contract. AC golden
// values (10/90/90, "Generating...") are HARD-CODED here, NOT imported, so a drift in the source
// fails the gate instead of being silently agreed with (the pattern in src/adapters/CLAUDE.md).
{
  const html = readFileSync(resolve(root, "index.html"), "utf8");

  // The single tag (no nested ">") carrying a given id, or null.
  const tagWithId = (id) =>
    html.match(new RegExp(`<[^>]*\\bid=["']${id}["'][^>]*>`, "i"))?.[0] ?? null;
  const attr = (tag, name) =>
    tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;
  const hasBoolAttr = (tag, name) => new RegExp(`\\b${name}\\b`, "i").test(tag);
  // The full markup of a <div> element (incl. nested divs) starting at `openIdx`, by balancing
  // <div>/</div> tags — a non-greedy `<div ...>...</div>` regex would stop at the FIRST inner </div>
  // and so couldn't prove containment of a nested overlay. Returns null if the tags don't balance.
  const divBlockFrom = (markup, openIdx) => {
    const tag = /<\/?div\b/gi;
    tag.lastIndex = openIdx;
    let depth = 0;
    for (let m = tag.exec(markup); m !== null; m = tag.exec(markup)) {
      depth += m[0][1] === "/" ? -1 : 1;
      if (depth === 0) return markup.slice(openIdx, markup.indexOf(">", m.index) + 1);
    }
    return null;
  };

  // 1. Every element fromDocument() resolves by CONTROL_IDS must actually exist in index.html, or
  //    the live app throws "required element not found" at startup (untested by the fake-doc check).
  for (const [key, id] of Object.entries(CONTROL_IDS)) {
    assert.ok(tagWithId(id), `index.html has an element #${id} for CONTROL_IDS.${key}`);
  }

  // 2. Waypoint input: number, range 10-90, default 90 (AC) — tied to the adapter's clamp/default.
  const input = tagWithId(CONTROL_IDS.waypointInput);
  assert.equal(attr(input, "type"), "number", "waypoint input is a number input");
  assert.equal(attr(input, "min"), "10", 'waypoint input min="10"');
  assert.equal(attr(input, "max"), "90", 'waypoint input max="90"');
  assert.equal(attr(input, "value"), "90", 'waypoint input default value="90"');

  // 3. Both toggles are checkboxes, checked by default (AC: rings/labels "visible by default").
  for (const key of ["wildcardsToggle", "turnsToggle"]) {
    const toggle = tagWithId(CONTROL_IDS[key]);
    assert.equal(attr(toggle, "type"), "checkbox", `${key} is a checkbox`);
    assert.ok(hasBoolAttr(toggle, "checked"), `${key} is checked by default`);
  }

  // 4. The loading overlay (AC2: "spinner + 'Generating...'") has the spinner element, the text, and
  //    the pure-CSS keyframes that animate it once GenerateWalk frees the event loop.
  assert.ok(/class=["']spinner["']/.test(html), "overlay has a .spinner element");
  assert.ok(/Generating\.\.\./.test(html), 'overlay shows the "Generating..." text');
  assert.ok(/@keyframes\s+spin\b/.test(html), "spinner has its @keyframes spin animation");

  // 5. The waypoint tooltip (US-017) is a DOM OVERLAY — not painted on the canvas (AC1): an element
  //    with the right id, absolutely positioned, non-interactive (so it never swallows the next
  //    click/hover on the canvas), and pre-line so the adapter's 3 newline-separated facts render as
  //    separate lines. Asserted from the real index.html, the one seam the fake elements can't cover.
  assert.ok(tagWithId(CONTROL_IDS.tooltip), "index.html has the #waypoint-tooltip overlay element");
  assert.ok(/#waypoint-tooltip\s*\{[^}]*position:\s*absolute/i.test(html), "tooltip is absolutely positioned (a DOM overlay)");
  assert.ok(/#waypoint-tooltip\s*\{[^}]*pointer-events:\s*none/i.test(html), "tooltip is non-interactive (pointer-events: none)");
  assert.ok(/#waypoint-tooltip\s*\{[^}]*white-space:\s*pre-line/i.test(html), "tooltip renders multi-line text (white-space: pre-line)");
  ok("index.html markup matches the adapter contract (ids, input range/default, toggles, overlay, tooltip)");

  // 5b. Error overlay (US-020): a DOM overlay over the canvas carrying the exact failure message, so
  //     a failed generation shows a clear error rather than a silent blank or a hang. The message
  //     lives in the markup (like "Generating..."), the adapter only flips its display — so this is
  //     its wording gate. The golden text is HARD-CODED here, NOT imported, so a drift fails the gate.
  //     Scope the message + role to the #error-overlay block so an unrelated page string can't satisfy
  //     it vacuously. Positioned absolutely (`position:absolute`) so it sits OVER the canvas (AC1).
  const ERROR_MESSAGE = "Couldn't generate a walk - try again or reduce the waypoint count";
  assert.ok(tagWithId(CONTROL_IDS.errorOverlay), "index.html has the #error-overlay element");
  const errorBlock = html.match(/<div\b[^>]*\bid=["']error-overlay["'][\s\S]*?<\/div>/i)?.[0] ?? null;
  assert.ok(errorBlock, "index.html has a <div id=error-overlay> ... </div> block");
  assert.ok(errorBlock.includes(ERROR_MESSAGE), `error overlay shows the exact AC message: "${ERROR_MESSAGE}"`);
  assert.ok(/\brole=["']alert["']/i.test(errorBlock), "error overlay is role=alert (announced to assistive tech)");
  assert.ok(/#error-overlay\s*\{[^}]*position:\s*absolute/i.test(html), "error overlay is absolutely positioned (over the canvas)");

  // AC1 says the error is shown OVER THE CANVAS — and `position: absolute` alone does NOT prove that.
  // An absolutely-positioned element covers the canvas only if it is (a) a DESCENDANT of the
  // `position: relative` `.canvas-wrap` (its containing block, shared with the canvas + loading
  // overlay) and (b) given `inset: 0` so it SPANS that block rather than sitting at its static-flow
  // corner. Without (a) the message would resolve against a different ancestor (or the viewport) and
  // float off the map; without (b) it would be a small box wherever the flow put it. Neither was
  // asserted — the bare position:absolute check above stays green through both regressions (proven to
  // bite: move `#error-overlay` out of `.canvas-wrap`, or drop its `inset: 0`). So pin the structure
  // here (mirrors the legend's "below the canvas" document-order check in item 6).
  const wrapOpenAt = html.search(/<div\b[^>]*\bclass=["'][^"']*\bcanvas-wrap\b/i);
  assert.ok(wrapOpenAt !== -1, "index.html has the .canvas-wrap element");
  const wrapBlock = divBlockFrom(html, wrapOpenAt);
  assert.ok(wrapBlock, "index.html .canvas-wrap is a balanced <div> ... </div> block");
  assert.ok(
    /\bid=["']error-overlay["']/i.test(wrapBlock),
    "error overlay is INSIDE .canvas-wrap (so it covers the canvas, not the rest of the page)"
  );
  assert.ok(
    /\.canvas-wrap\s*\{[^}]*position:\s*relative/i.test(html),
    ".canvas-wrap is position:relative (the overlay's containing block, so inset:0 resolves to it)"
  );
  assert.ok(
    /#error-overlay\s*\{[^}]*inset:\s*0/i.test(html),
    "error overlay spans the canvas (inset: 0) — position:absolute alone leaves it at its flow corner"
  );
  ok("Error overlay (US-020): DOM overlay OVER the canvas (inside .canvas-wrap, inset:0) with the exact failure message");

  // 6. Legend (US-018): a DOM/HTML legend BELOW the canvas (not canvas-painted) with three entries —
  //    Start/End, Waypoint, Wildcard — whose swatches MIRROR the canvas symbol colours. There is no
  //    other gate for it (the legend is static markup; the adapter never touches it), so this is its
  //    regression check. Golden colours are HARD-CODED here, NOT imported; the gate reads BOTH the
  //    legend CSS (index.html) AND the renderer constants (canvas-renderer.ts) and anchors each to the
  //    same golden set, so a drift on EITHER side fails. "Below the canvas" is document order.
  assert.ok(tagWithId("legend"), "index.html has a #legend element");
  const canvasAt = html.search(new RegExp(`\\bid=["']${CONTROL_IDS.canvas}["']`, "i"));
  const legendAt = html.search(/\bid=["']legend["']/i);
  assert.ok(canvasAt !== -1 && legendAt > canvasAt, "legend is below the canvas (after it in document order)");

  // Scope the entry checks to the actual <ul id="legend"> ... </ul> markup block — NOT the whole
  // page. "Waypoint" is a substring of the "Waypoints" control label and "Wildcard" appears in the
  // "Show Wildcards" toggle, so an unscoped html.includes(label) passes even with the legend <li>
  // deleted (proven to bite). Pairing each AC swatch class with its AC label INSIDE one <li> proves
  // the three entries actually exist in the legend, correctly labelled.
  const legendBlock = html.match(/<ul\b[^>]*\bid=["']legend["'][\s\S]*?<\/ul>/i)?.[0] ?? null;
  assert.ok(legendBlock, "index.html has a <ul id=legend> ... </ul> block");
  const entries = legendBlock.match(/<li\b[\s\S]*?<\/li>/gi) ?? [];
  assert.equal(entries.length, 3, "legend has exactly three entries (AC)");
  // Each AC entry: the swatch class and its label live together in one <li> (so the swatch is paired
  // with the right symbol, and the label isn't satisfied by chrome text elsewhere on the page).
  const acEntries = [
    { swatch: "swatch-terminal", label: "Start / End" },
    { swatch: "swatch-waypoint", label: "Waypoint" },
    { swatch: "swatch-wildcard", label: "Wildcard" },
  ];
  for (const { swatch, label } of acEntries) {
    const entry = entries.find((li) => li.includes(swatch));
    assert.ok(entry, `legend has an entry with the .${swatch} swatch`);
    assert.ok(entry.includes(label), `the .${swatch} legend entry is labelled "${label}"`);
  }
  assert.ok(/walker goes straight/i.test(legendBlock), 'wildcard entry explains "walker goes straight"');

  // Swatches mirror the canvas (canvas-renderer.ts): terminal black fill; waypoint white fill + black
  // border; wildcard orange ring. Golden hex values hard-coded.
  assert.ok(/swatch-terminal\s*\{[^}]*background:\s*#000000/i.test(html), "Start/End swatch is a black filled circle (#000000)");
  assert.ok(/swatch-waypoint\s*\{[^}]*background:\s*#ffffff/i.test(html), "Waypoint swatch is white-filled (#ffffff)");
  assert.ok(/swatch-waypoint\s*\{[^}]*border:[^;}]*#000000/i.test(html), "Waypoint swatch has a black border (#000000)");
  assert.ok(/swatch-wildcard\s*\{[^}]*border:[^;}]*#ff8c00/i.test(html), "Wildcard swatch is an orange ring (#ff8c00 border)");
  assert.ok(/\.legend\s+\.swatch\s*\{[^}]*border-radius:\s*50%/i.test(html), "legend swatches are circular (border-radius: 50%)");

  // The legend exists to MIRROR the canvas symbols, and the CSS carries a "keep in sync" comment — so
  // the gate must also catch a drift on the RENDERER side, not just the legend CSS. Read the REAL
  // canvas-renderer.ts source and assert its colour constants equal the SAME hard-coded golden values
  // the legend swatches were checked against above. Anchoring BOTH files to one golden set proves,
  // transitively, legend === renderer AND both === the AC spec: a drift in the legend fails the CSS
  // checks above; a drift in WILDCARD_RING_COLOUR/TERMINAL_FILL/etc. (which would silently leave the
  // legend showing a colour the canvas no longer draws) fails the checks here. We read the .ts source
  // (not the compiled dist) because these are private module-level consts, not exports.
  const rendererSrc = readFileSync(resolve(root, "src/adapters/canvas-renderer.ts"), "utf8");
  const rendererColour = (name) =>
    rendererSrc.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]?.toLowerCase() ?? null;
  const RENDERER_GOLDEN = {
    TERMINAL_FILL: "#000000", // Start/End swatch fill
    WAYPOINT_FILL: "#ffffff", // Waypoint swatch fill
    WAYPOINT_BORDER: "#000000", // Waypoint swatch border
    WILDCARD_RING_COLOUR: "#ff8c00", // Wildcard swatch ring
  };
  for (const [name, want] of Object.entries(RENDERER_GOLDEN)) {
    assert.equal(rendererColour(name), want, `canvas-renderer ${name} is ${want} — legend swatch mirrors it (keep in sync)`);
  }
  ok("Legend (US-018): DOM/HTML below the canvas, three entries, swatches mirror the canvas colours");

  // 7. Print stylesheet (US-019): an @media print block prints ONLY the map + legend on a single A4
  //    page. All other chrome (the controls, the loading overlay, the click tooltip) and the page
  //    heading are HIDDEN; the legend is KEPT; and the A4-sized canvas is capped so both fit on one
  //    sheet. This is a pure-CSS, markup-only feature (no adapter change), so — exactly like the
  //    legend (item 6) — this real-index.html assertion is its only regression gate.
  //
  //    @media / @page rules NEST braces, so a flat `[^}]*` body regex stops at the first inner `}`.
  //    Balance braces from the opening `{` to get the whole block, then strip CSS comments so prose
  //    words like "canvas"/"display"/"max-height" can't satisfy a check vacuously.
  const blockFrom = (css, openBraceIdx) => {
    let depth = 0;
    for (let i = openBraceIdx; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(openBraceIdx, i + 1);
    }
    return null;
  };
  const printAt = html.search(/@media\s+print\b/i);
  assert.ok(printAt !== -1, "index.html has an @media print stylesheet (US-019)");
  const printBlock = (blockFrom(html, html.indexOf("{", printAt)) ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(printBlock, "the @media print block has balanced braces");

  // Single A4 page: the page box is sized to A4 (so the printout is one A4 sheet).
  assert.ok(/@page[^{]*\{[^}]*size\s*:\s*a4/i.test(printBlock), "@media print sets @page size: A4 (single A4 page)");

  // The rule (selector list + body) a given selector belongs to, within the print block.
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ruleFor = (selectorRe) => printBlock.match(new RegExp(`${selectorRe}[^{}]*\\{[^}]*\\}`, "i"))?.[0] ?? null;

  // Chrome + heading hidden in print. The overlay/tooltip/error hides MUST be !important: the adapter
  // sets their display via INLINE style (loading overlay during generation, error overlay on a failed
  // generation, tooltip on a waypoint click), which would otherwise beat the stylesheet and print a
  // stuck overlay / an error message / an open tooltip over the map.
  const mustImportant = new Set(["#loading-overlay", "#error-overlay", "#waypoint-tooltip"]);
  for (const selector of [".controls", "#loading-overlay", "#error-overlay", "#waypoint-tooltip", "h1"]) {
    const rule = ruleFor(escapeRe(selector));
    assert.ok(rule && /display\s*:\s*none/i.test(rule), `${selector} is hidden in print (display: none)`);
    if (mustImportant.has(selector)) {
      assert.ok(/display\s*:\s*none\s*!important/i.test(rule), `${selector} hide is !important (beats the adapter's inline style.display)`);
    }
  }

  // The legend + canvas are KEPT (NOT hidden) in print — that's what separates them from the chrome
  // above (AC: "the map and legend ... all OTHER UI chrome hidden"). `canvas` needs a leading
  // boundary so it doesn't match `.canvas-wrap` / `#walk-canvas`.
  for (const selectorRe of [escapeRe(".legend"), "(?<![\\w.#-])canvas"]) {
    const rule = ruleFor(selectorRe);
    assert.ok(!rule || !/display\s*:\s*none/i.test(rule), `${selectorRe} is NOT hidden in print (map + legend are kept)`);
  }

  // The canvas backing store is A4-sized (794×1123 ≈ 210×297mm), so at natural size it fills the
  // whole page and pushes the legend onto a second sheet. Capping its height is the single-A4-page
  // mechanism (with width/height:auto preserving the A4 aspect ratio).
  assert.ok(
    /(?<![\w.#-])canvas[^{}]*\{[^}]*max-height/i.test(printBlock),
    "print caps the canvas height (max-height) so the legend fits on the same A4 page"
  );

  // ...but the bare "a cap exists" check above passes for ANY value — `max-height: 999mm`, or dropping
  // the `@page` margin, would still push the legend onto page 2 yet stay green. The story's headline
  // AC ("a single A4 page") is an ARITHMETIC claim, so verify the arithmetic from the real numbers:
  // A4 portrait is 297mm tall; `@page { margin: Nmm }` leaves a printable height of 297 - 2N; the
  // canvas cap + the legend's top gap + the legend's own rendered height must all fit inside it. We
  // assert the INEQUALITY (not specific values), so any correct cap satisfies it and only a
  // page-breaking one trips it. LEGEND_RESERVE_MM is a generous lower bound on the legend's height
  // (one flex row of 20px ≈ 5.3mm swatches + line height) so a legitimate cap tweak never spuriously
  // fails — it bites only when the cap genuinely leaves no room for the legend on the same sheet.
  const A4_HEIGHT_MM = 297;
  const LEGEND_RESERVE_MM = 10;
  const mmOf = (rule, prop) => {
    if (!rule) return null;
    const m = rule.match(new RegExp(`(?<![-\\w])${prop}(?![-\\w])\\s*:\\s*(\\d+(?:\\.\\d+)?)mm`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  const pageMarginMm = mmOf(printBlock.match(/@page[^{]*\{[^}]*\}/i)?.[0] ?? null, "margin");
  const canvasMaxMm = mmOf(ruleFor("(?<![\\w.#-])canvas"), "max-height");
  const legendTopMm = mmOf(ruleFor(escapeRe(".legend")), "margin-top") ?? 0;
  assert.ok(pageMarginMm !== null, "@page margin is given in mm (it drives the A4 printable height)");
  assert.ok(canvasMaxMm !== null, "canvas max-height is given in mm (it drives the single-page fit)");
  const printableMm = A4_HEIGHT_MM - 2 * pageMarginMm;
  assert.ok(
    canvasMaxMm + legendTopMm + LEGEND_RESERVE_MM <= printableMm,
    `canvas cap (${canvasMaxMm}mm) + legend gap (${legendTopMm}mm) + legend (~${LEGEND_RESERVE_MM}mm) <= A4 printable height (${printableMm}mm @ ${pageMarginMm}mm margin) — fits one A4 page`
  );

  // The legend swatches are CSS BACKGROUND colours (the Start/End swatch is a pure `background:
  // #000000` fill with no border). Browsers default to `print-color-adjust: economy`, which drops
  // background colours when printing — so without `print-color-adjust: exact` the black Start/End
  // swatch prints as an EMPTY white circle and the printed legend no longer mirrors the canvas
  // symbols (the AC: "print ... the legend"). The lookbehind `(?<!-)` requires the STANDARD
  // unprefixed property, not just the `-webkit-` prefix, so the spec-compliant rule is present.
  const swatchRule = ruleFor(escapeRe(".legend .swatch"));
  assert.ok(swatchRule, "print has a .legend .swatch rule to control swatch colour printing");
  assert.ok(
    /(?<!-)print-color-adjust\s*:\s*exact/i.test(swatchRule),
    "print forces legend swatch fills to print (print-color-adjust: exact), so the black Start/End swatch isn't dropped"
  );

  ok("Print stylesheet (US-019): @media print hides chrome, keeps map + legend, fits one A4 page");
}

// ── US-017: clicking a waypoint shows the DOM-overlay tooltip with number / turn / distance ──
// The expected turn description mirrors the adapter's turnDescription (kept in sync deliberately).
function expectedTurnDesc(wp) {
  if (wp.isFirst) return "none (start)";
  if (wp.isLast) return "none (end)";
  if (wp.wildcard) return "Wildcard";
  if (wp.outboundTurn === "L") return "L"; // Turn.Left
  if (wp.outboundTurn === "R") return "R"; // Turn.Right
  return "none";
}

/** Generate a real walk through DomControls and hand back the wiring + the drawn Walk for US-017 tests. */
async function generated(seed = SEED) {
  const { deps, renderer } = makeDeps(undefined, seed);
  const els = makeElements();
  const controls = new DomControls(deps, els);
  await controls.generate();
  return { controls, els, renderer, walk: renderer.drawsOf()[0].walk };
}

{
  const { els, renderer, walk } = await generated();
  const interior = walk.waypoints.find((w) => w.isInterior && !w.wildcard);
  assert.ok(interior, "the generated walk has an interior turn waypoint to inspect");

  renderer.hitTarget = interior;
  els.canvas.dispatch("click", { clientX: 123, clientY: 456 });

  assert.deepEqual(renderer.hitArgs.at(-1), [123, 456], "click forwards the event's client coords to hitTest");
  assert.equal(els.tooltip.style.display, "block", "tooltip is shown on a waypoint click");
  const text = els.tooltip.textContent;
  assert.ok(text.includes(`Waypoint ${interior.sequenceNumber}`), "tooltip shows the waypoint number");
  assert.ok(text.includes(`Turn: ${expectedTurnDesc(interior)}`), "tooltip shows the turn direction (L/R)");
  const dist = Math.round(walk.cumulativeDistanceTo(interior.sequenceNumber - 1));
  assert.ok(text.includes(`${dist} px from start`), "tooltip shows the cumulative generation-space distance");
  // Positioned at the click point (offset clear of the cursor) within the canvas wrapper.
  assert.equal(els.tooltip.style.left, "135px", "tooltip x = clientX - rect.left + offset");
  assert.equal(els.tooltip.style.top, "468px", "tooltip y = clientY - rect.top + offset");
  ok("Click a waypoint: tooltip shows number, turn direction and cumulative distance, positioned at the click");
}

// ── US-017: tooltip content for a terminal (Start) waypoint — no turn, distance 0 ──
{
  const { els, renderer, walk } = await generated();
  const first = walk.waypoints[0];
  renderer.hitTarget = first;
  els.canvas.dispatch("click", { clientX: 10, clientY: 10 });
  const text = els.tooltip.textContent;
  assert.ok(text.includes("Waypoint 1"), "start tooltip shows waypoint 1");
  assert.ok(text.includes("Turn: none (start)"), "start tooltip marks it as the start with no turn");
  assert.ok(text.includes("0 px from start"), "start waypoint cumulative distance is 0");
  ok("Click the Start waypoint: tooltip shows it as the start with distance 0");
}

// ── US-017: tooltip content for the terminal End (last) waypoint — no turn, full cumulative distance ──
// Exercises turnDescription's isLast branch ("none (end)"), the only terminal branch the Start test
// above does not cover, and asserts the end waypoint's distance is the walk's TOTAL path length.
{
  const { els, renderer, walk } = await generated();
  const last = walk.waypoints[walk.waypoints.length - 1];
  assert.ok(last.isLast, "the last waypoint is the End terminal");
  renderer.hitTarget = last;
  els.canvas.dispatch("click", { clientX: 700, clientY: 700 });
  const text = els.tooltip.textContent;
  assert.ok(text.includes(`Waypoint ${last.sequenceNumber}`), "end tooltip shows the last waypoint number");
  assert.ok(text.includes("Turn: none (end)"), "end tooltip marks it as the end with no turn");
  const total = Math.round(walk.totalDistance);
  assert.equal(total, Math.round(walk.cumulativeDistanceTo(last.sequenceNumber - 1)), "end cumulative distance is the total");
  assert.ok(text.includes(`${total} px from start`), "end tooltip shows the full cumulative distance (the total)");
  ok("Click the End waypoint: tooltip shows it as the end with the full cumulative distance");
}

// ── US-017: a wildcard waypoint's tooltip reports the Wildcard turn ──
{
  const { els, renderer, walk } = await generated();
  const wildcard = walk.waypoints.find((w) => w.wildcard);
  assert.ok(wildcard, "the generated walk has a wildcard to inspect");
  renderer.hitTarget = wildcard;
  els.canvas.dispatch("click", { clientX: 5, clientY: 5 });
  assert.ok(els.tooltip.textContent.includes("Turn: Wildcard"), "wildcard tooltip reports the Wildcard turn");
  ok("Click a wildcard waypoint: tooltip reports the Wildcard turn");
}

// ── US-017 AC1: the cumulative distance is GENERATION-space px, so it is stable across a resize ──
// The tooltip's distance must come from the domain Walk, not from screen pixels — so resizing the
// canvas element (its getBoundingClientRect changes, exactly as US-015's CSS scale does on a narrow
// viewport) must not change the reported distance. Re-clicking the SAME waypoint at the SAME client
// coords after a resize must show a byte-identical distance line (only the on-screen position may move).
{
  const { els, renderer, walk } = await generated();
  const interior = walk.waypoints.find((w) => w.isInterior);
  const distanceLine = (text) => text.split("\n").find((line) => line.endsWith("px from start"));
  const expected = `${Math.round(walk.cumulativeDistanceTo(interior.sequenceNumber - 1))} px from start`;

  renderer.hitTarget = interior;
  els.canvas.dispatch("click", { clientX: 300, clientY: 300 });
  const before = distanceLine(els.tooltip.textContent);
  const posBefore = [els.tooltip.style.left, els.tooltip.style.top];
  assert.equal(before, expected, "distance line is the generation-space value before the resize");

  // Resize: the element is now displayed half-size and shifted (a narrower viewport / scroll).
  const rect = els.canvas.getBoundingClientRect(); // fakeCanvas returns the same mutable object
  rect.left = 40;
  rect.top = 60;
  rect.width = 397;
  rect.height = 561.5;

  els.canvas.dispatch("click", { clientX: 300, clientY: 300 });
  const after = distanceLine(els.tooltip.textContent);
  assert.equal(after, before, "distance line is unchanged after the resize (generation-space, not screen px)");
  assert.equal(after, expected, "distance line still equals the generation-space value after the resize");
  // Sanity: the rect IS genuinely consulted (position tracked the moved origin), so the test isn't vacuous.
  assert.notDeepEqual([els.tooltip.style.left, els.tooltip.style.top], posBefore, "tooltip position tracked the resized rect");
  ok("Tooltip distance is generation-space px, stable across a canvas resize (AC1)");
}

// ── US-017: tooltip dismisses on a click over empty canvas, on Clear, and on Generate; survives redraws ──
{
  const { controls, els, renderer, walk } = await generated();
  const wp = walk.waypoints.find((w) => w.isInterior);

  // Show it, then click empty canvas → dismissed.
  renderer.hitTarget = wp;
  els.canvas.dispatch("click", { clientX: 1, clientY: 1 });
  assert.equal(els.tooltip.style.display, "block", "tooltip up before the empty click");
  renderer.hitTarget = null;
  els.canvas.dispatch("click", { clientX: 2, clientY: 2 });
  assert.equal(els.tooltip.style.display, "none", "tooltip dismissed on a click over empty canvas");

  // Show again, then a toggle redraw must NOT dismiss it (it survives redraws).
  renderer.hitTarget = wp;
  els.canvas.dispatch("click", { clientX: 1, clientY: 1 });
  els.turnsToggle.checked = false;
  els.turnsToggle.dispatch("change");
  assert.equal(els.tooltip.style.display, "block", "tooltip survives a toggle redraw");

  // Clear dismisses it.
  els.clearButton.dispatch("click");
  assert.equal(els.tooltip.style.display, "none", "tooltip dismissed on Clear");

  // Show again, then Generate dismisses it (generate clears first).
  await controls.generate();
  renderer.hitTarget = renderer.drawsOf().at(-1).walk.waypoints.find((w) => w.isInterior);
  els.canvas.dispatch("click", { clientX: 1, clientY: 1 });
  assert.equal(els.tooltip.style.display, "block", "tooltip up before Generate");
  await controls.generate();
  assert.equal(els.tooltip.style.display, "none", "tooltip dismissed on Generate");
  ok("Tooltip dismisses on empty-canvas click, Clear and Generate; survives a toggle redraw");
}

// ── US-017: hover → pointer cursor + waypoint highlight; off → default cursor + cleared highlight ──
{
  const { els, renderer, walk } = await generated();
  const wp = walk.waypoints.find((w) => w.isInterior);

  renderer.hitTarget = wp;
  els.canvas.dispatch("mousemove", { clientX: 1, clientY: 1 });
  assert.equal(els.canvas.style.cursor, "pointer", "cursor becomes a pointer over a waypoint");
  assert.equal(renderer.highlights.at(-1), wp, "hovering a waypoint highlights it (drop shadow + thick segments)");

  // Redundant movement WITHIN the same waypoint must not re-highlight (no per-pixel redraw).
  const before = renderer.highlights.length;
  els.canvas.dispatch("mousemove", { clientX: 2, clientY: 2 });
  assert.equal(renderer.highlights.length, before, "no re-highlight while still over the same waypoint");

  // Move to empty canvas → cursor restored, highlight cleared.
  renderer.hitTarget = null;
  els.canvas.dispatch("mousemove", { clientX: 3, clientY: 3 });
  assert.equal(els.canvas.style.cursor, "default", "cursor restored over empty canvas");
  assert.equal(renderer.highlights.at(-1), null, "moving off a waypoint clears the highlight");
  ok("Hover: pointer cursor + waypoint highlight; restored over empty canvas; no redundant redraws");
}

// ── US-017: moving off the canvas (mouseleave) removes all hover highlighting ──
{
  const { els, renderer, walk } = await generated();
  const wp = walk.waypoints.find((w) => w.isInterior);
  renderer.hitTarget = wp;
  els.canvas.dispatch("mousemove", { clientX: 1, clientY: 1 });
  assert.equal(renderer.highlights.at(-1), wp, "hovering set the highlight before leaving");

  els.canvas.dispatch("mouseleave");
  assert.equal(els.canvas.style.cursor, "default", "cursor restored on mouseleave");
  assert.equal(renderer.highlights.at(-1), null, "mouseleave clears the hover highlight");
  ok("Moving off the canvas (mouseleave) removes all hover highlighting");
}

console.log(`\nAll ${passed} DOM-controls checks passed.`);
