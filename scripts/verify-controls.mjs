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

const SEED = 4242;

/** A fake DOM element: records added listeners + lets the harness dispatch events synchronously. */
function fakeEl(props = {}) {
  const listeners = {};
  return {
    style: {},
    disabled: false,
    checked: false,
    value: "",
    ...props,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type) {
      for (const fn of listeners[type] || []) fn();
    },
  };
}

/** A recording fake Renderer (the driven port). Tracks draw/clear calls + the on-screen walk. */
function makeFakeRenderer() {
  const calls = [];
  return {
    calls,
    current: null,
    draw(walk, options) {
      calls.push({ type: "draw", walk, options });
      this.current = walk;
    },
    clear() {
      calls.push({ type: "clear" });
      this.current = null;
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

// ── AC: controls restored in finally even when generation FAILS (bounded failure signal) ──
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
  assert.equal(renderer.drawsOf().length, 0, "failed generate draws nothing (US-020 adds the error)");
  assert.equal(els.generateButton.disabled, false, "button restored after a failed generation");
  assert.equal(els.loadingOverlay.style.display, "none", "overlay hidden after a failed generation");
  ok("Failure signal: canvas left cleared, controls restored in finally");
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
  ok("index.html markup matches the adapter contract (ids, input range/default, toggles, overlay)");
}

console.log(`\nAll ${passed} DOM-controls checks passed.`);
