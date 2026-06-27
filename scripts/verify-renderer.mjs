// Headless verification harness for the Canvas renderer (US-013+).
//
// `tsconfig.test.json` references core only, so `tests/**` cannot import the DOM-bound adapters and
// `npm test` does not cover them (see src/adapters/CLAUDE.md). This script is the headless stand-in:
// it imports the COMPILED renderer from dist/ (runtime JS has no type checks, so the DOM-typed
// adapter loads in plain Node), drives REAL generated walks through it with a recording fake
// `CanvasRenderingContext2D`, and asserts every drawing primitive the acceptance criteria call for.
//
//   npm run build && node scripts/verify-renderer.mjs     (or: npm run verify:renderer)
//
// Exits non-zero on the first failed assertion so it is usable as a gate. As US-014 (turn labels,
// wildcard rings) and US-015 (A4 cap / downscale / centre) extend draw(), add their assertions here.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/src");
const { walkGenerator } = await import(`${dist}/domain/walk-generator.js`);
const { SeededRandom } = await import(`${dist}/domain/seeded-random.js`);
const { WAYPOINT_RADIUS } = await import(`${dist}/domain/layout-rules.js`);
const { CanvasRenderer } = await import(`${dist}/adapters/canvas-renderer.js`);

const CANVAS_W = 794; // A4 @ 96 PPI — US-015 enforces this cap; here it is just the fake surface size.
const CANVAS_H = 1123;
const CELL = 60; // grid cell, generation-space px
const PAD = 100; // padding around the waypoint bounding box, each side

/**
 * A recording fake `CanvasRenderingContext2D`. Every op is pushed with a snapshot of the styles
 * that are LIVE at call time (fillStyle/strokeStyle/lineWidth/font/...), captured via getter/setter
 * props so e.g. a fill() records the fillStyle as it stood when fill() ran — not some later value.
 * The translate-only transform stack is tracked exactly as canvas does, so recorded coordinates are
 * in screen space; the untransformed local coordinate is kept alongside as `lx`/`ly`.
 */
function makeFakeContext() {
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "", lineJoin: "", lineCap: "" };
  const ops = [];
  let tx = 0, ty = 0;
  const stack = [];
  const snap = () => ({ ...state });
  const ctx = {
    canvas: { width: CANVAS_W, height: CANVAS_H },
    save() { stack.push({ tx, ty }); ops.push({ op: "save" }); },
    restore() { const s = stack.pop(); tx = s.tx; ty = s.ty; ops.push({ op: "restore" }); },
    setTransform(_a, _b, _c, _d, e, f) { tx = e; ty = f; ops.push({ op: "setTransform", e, f }); },
    translate(x, y) { tx += x; ty += y; ops.push({ op: "translate", x, y }); },
    beginPath() { ops.push({ op: "beginPath" }); },
    moveTo(x, y) { ops.push({ op: "moveTo", x: x + tx, y: y + ty, lx: x, ly: y }); },
    lineTo(x, y) { ops.push({ op: "lineTo", x: x + tx, y: y + ty, lx: x, ly: y }); },
    arc(x, y, r) { ops.push({ op: "arc", x: x + tx, y: y + ty, lx: x, ly: y, r, ...snap() }); },
    fillRect(x, y, w, h) { ops.push({ op: "fillRect", x, y, w, h, ...snap() }); },
    clearRect(x, y, w, h) { ops.push({ op: "clearRect", x, y, w, h }); },
    fill() { ops.push({ op: "fill", ...snap() }); },
    stroke() { ops.push({ op: "stroke", ...snap() }); },
    fillText(text, x, y) { ops.push({ op: "fillText", text, x: x + tx, y: y + ty, lx: x, ly: y, ...snap() }); },
  };
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { state[k] = v; } });
  }
  return { ctx, ops };
}

/** Drive the synchronous generator iterator to its terminal result and return a valid Walk. */
function generateWalk(count, seed) {
  const it = walkGenerator.generate(count, new SeededRandom(seed));
  let step = it.next();
  while (!step.done) step = it.next();
  assert.equal(step.value.ok, true, `generation should succeed for count=${count} seed=${seed}`);
  return step.value.walk;
}

function renderToOps(walk) {
  const { ctx, ops } = makeFakeContext();
  const renderer = new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => ctx });
  renderer.draw(walk, { showWildcards: true, showTurns: true });
  return ops;
}

function verifyDraw(count, seed) {
  const walk = generateWalk(count, seed);
  const ops = renderToOps(walk);
  const n = walk.waypoints.length;
  const box = walk.boundingBox;
  const minX = box.minX - PAD, minY = box.minY - PAD, maxX = box.maxX + PAD, maxY = box.maxY + PAD;

  // AC: white background covering the whole canvas, painted in screen space (identity transform).
  const bg = ops.find((o) => o.op === "fillRect");
  assert.ok(bg && bg.x === 0 && bg.y === 0 && bg.w === CANVAS_W && bg.h === CANVAS_H, "background fillRect covers canvas");
  assert.equal(bg.fillStyle, "#ffffff", "background is white");

  // AC: subtle light-grey grid, 60px cells, covering the bounding box + 100px padding each side.
  const gridStroke = ops.find((o) => o.op === "stroke" && o.strokeStyle === "#e6e6e6");
  assert.ok(gridStroke, "grid is stroked light grey");
  assert.equal(gridStroke.lineWidth, 1, "grid lines are 1px");
  const gridIdx = ops.indexOf(gridStroke);
  const gridSegs = ops.slice(0, gridIdx).filter((o) => o.op === "moveTo" || o.op === "lineTo");
  const verticals = [], horizontals = [];
  for (let i = 0; i + 1 < gridSegs.length; i += 2) {
    const a = gridSegs[i], b = gridSegs[i + 1];
    assert.equal(a.op, "moveTo", "grid line begins with moveTo");
    assert.equal(b.op, "lineTo", "grid line ends with lineTo");
    if (a.lx === b.lx) verticals.push(a);
    else if (a.ly === b.ly) horizontals.push(a);
    else assert.fail(`grid line neither horizontal nor vertical: ${JSON.stringify([a, b])}`);
  }
  assert.ok(verticals.length > 0 && horizontals.length > 0, "grid has both vertical and horizontal lines");
  for (const v of verticals) {
    assert.equal(v.lx % CELL, 0, `vertical lattice-aligned at x=${v.lx}`);
    assert.ok(v.lx >= minX - 1e-9 && v.lx <= maxX + 1e-9, `vertical x=${v.lx} inside padded box`);
  }
  for (const h of horizontals) {
    assert.equal(h.ly % CELL, 0, `horizontal lattice-aligned at y=${h.ly}`);
    assert.ok(h.ly >= minY - 1e-9 && h.ly <= maxY + 1e-9, `horizontal y=${h.ly} inside padded box`);
  }

  // AC: orthogonal path — one connected polyline through waypoint centres, dark grey/black, 2px.
  const pathStroke = ops.find((o) => o.op === "stroke" && o.strokeStyle === "#222222");
  assert.ok(pathStroke, "path is stroked dark");
  assert.equal(pathStroke.lineWidth, 2, "path is 2px");
  const pathIdx = ops.indexOf(pathStroke);
  const polyMoves = ops.slice(0, pathIdx).filter((o) => o.op === "moveTo");
  const start = polyMoves[polyMoves.length - 1]; // the path moveTo follows all grid moveTos
  assert.ok(start && start.lx === walk.waypoints[0].position.x && start.ly === walk.waypoints[0].position.y, "polyline starts at waypoint 1");
  for (let i = 1; i < n; i++) {
    const p = walk.waypoints[i].position, q = walk.waypoints[i - 1].position;
    assert.ok(p.x === q.x || p.y === q.y, `segment ${i - 1}->${i} is orthogonal`);
  }

  // AC: each waypoint a radius-25 circle; terminals (first+last) black fill/white border/white number,
  // interiors white fill/black border/black number; number centred in bold 20px Arial. Read styles from
  // the fill/stroke/fillText ops AFTER each arc (the renderer sets the style just before those calls).
  const circles = ops.filter((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS);
  assert.equal(circles.length, n, `${n} radius-${WAYPOINT_RADIUS} circles`);
  const texts = ops.filter((o) => o.op === "fillText");
  assert.equal(texts.length, n, `${n} numbers`);
  let blackTerminals = 0;
  for (const wp of walk.waypoints) {
    const arcIdx = ops.findIndex((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS && o.lx === wp.position.x && o.ly === wp.position.y);
    assert.ok(arcIdx >= 0, `circle at waypoint ${wp.sequenceNumber}`);
    const rest = ops.slice(arcIdx);
    const fillOp = rest.find((o) => o.op === "fill");
    const strokeOp = rest.find((o) => o.op === "stroke");
    const textOp = rest.find((o) => o.op === "fillText" && o.lx === wp.position.x && o.ly === wp.position.y);
    const [fill, border, ink] = wp.isTerminal ? ["#000000", "#ffffff", "#ffffff"] : ["#ffffff", "#000000", "#000000"];
    if (wp.isTerminal) blackTerminals++;
    assert.equal(fillOp.fillStyle, fill, `wp${wp.sequenceNumber} fill`);
    assert.equal(strokeOp.strokeStyle, border, `wp${wp.sequenceNumber} border`);
    assert.ok(textOp, `wp${wp.sequenceNumber} number`);
    assert.equal(textOp.text, String(wp.sequenceNumber), `wp${wp.sequenceNumber} number value`);
    assert.equal(textOp.font, "bold 20px Arial", `wp${wp.sequenceNumber} font`);
    assert.equal(textOp.textAlign, "center", `wp${wp.sequenceNumber} number centred (align)`);
    assert.equal(textOp.textBaseline, "middle", `wp${wp.sequenceNumber} number centred (baseline)`);
    assert.equal(textOp.fillStyle, ink, `wp${wp.sequenceNumber} number colour`);
  }
  assert.equal(blackTerminals, 2, "exactly two black terminals");
  assert.ok(walk.waypoints[0].isTerminal && walk.waypoints[n - 1].isTerminal, "the terminals are the first and last waypoints");

  console.log(`  ✓ count=${count} seed=${seed}: ${n} waypoints, ${circles.length} circles, ${verticals.length}×${horizontals.length} grid, ${texts.length} numbers`);
}

function verifyClear() {
  const { ctx, ops } = makeFakeContext();
  const renderer = new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => ctx });
  renderer.clear();
  const reset = ops.find((o) => o.op === "setTransform");
  assert.ok(reset && reset.e === 0 && reset.f === 0, "clear resets the transform to the origin");
  const cleared = ops.find((o) => o.op === "clearRect");
  assert.ok(cleared && cleared.x === 0 && cleared.y === 0 && cleared.w === CANVAS_W && cleared.h === CANVAS_H, "clear wipes the whole canvas");
  console.log("  ✓ clear() resets transform and wipes the full canvas");
}

function verifyMissingContext() {
  assert.throws(() => new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => null }), /context/i, "ctor throws when 2D context is unavailable");
  console.log("  ✓ constructor throws when the 2D context is unavailable");
}

console.log("US-013 CanvasRenderer headless verification:");
// counts 2 (minimum: single straight-North segment, both waypoints terminal), 10, 20, 90 (max).
verifyDraw(2, 7);
verifyDraw(10, 4242);
verifyDraw(20, 99);
verifyDraw(90, 4242);
verifyClear();
verifyMissingContext();
console.log("ALL RENDERER ASSERTIONS PASSED");
