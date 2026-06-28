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
const { WAYPOINT_RADIUS, turnLabelPoint } = await import(`${dist}/domain/layout-rules.js`);
const { CanvasRenderer } = await import(`${dist}/adapters/canvas-renderer.js`);

const CANVAS_W = 794; // A4 @ 96 PPI — US-015 enforces this cap; here it is just the fake surface size.
const CANVAS_H = 1123;
const CELL = 60; // grid cell, generation-space px
const PAD = 100; // padding around the waypoint bounding box, each side

// US-014 AC values (the renderer's wildcard ring + turn label, asserted as a golden gate).
// These are GOLDEN literals straight from the acceptance criteria — deliberately NOT imported from
// the domain, so a drift in the source constants is caught here rather than silently agreed with.
const RING_RADIUS = 30; // orange wildcard ring, radius px from centre
const RING_WIDTH = 3; // orange wildcard ring stroke width
const RING_COLOUR = "#ff8c00"; // orange
const TURN_LABEL_OFFSET = 46; // NE label distance from the waypoint centre (AC: "46px from the centre")
const TURN_LABEL_COLOUR = "#222222"; // L / R / W ink
const TURN_LABEL_FONT = "bold 16px Arial";
const TURN_LABELS = new Set(["L", "R", "W"]);

// AC: the wildcard ring is drawn "at radius 30px OUTSIDE the centre" — i.e. it sits clear of the
// waypoint circle (radius 25). A one-time golden invariant so a future tweak that shrank the ring
// inside the circle (or grew the circle past it) is caught immediately.
assert.ok(RING_RADIUS > WAYPOINT_RADIUS, "wildcard ring radius sits outside the waypoint circle");

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

function renderToOps(walk, options = { showWildcards: true, showTurns: true }) {
  const { ctx, ops } = makeFakeContext();
  const renderer = new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => ctx });
  renderer.draw(walk, options);
  return ops;
}

/** The expected outbound turn label for a waypoint, or null when none should be shown. */
function expectedLabel(wp) {
  if (wp.isTerminal) return null;
  if (wp.wildcard) return "W";
  if (wp.outboundTurn === "L") return "L"; // Turn.Left
  if (wp.outboundTurn === "R") return "R"; // Turn.Right
  return null;
}

/** Recorded turn-label fillTexts (text in {L,R,W}) and wildcard-ring arcs (r=30). */
function turnLabelOps(ops) {
  return ops.filter((o) => o.op === "fillText" && TURN_LABELS.has(o.text));
}
function ringArcOps(ops) {
  return ops.filter((o) => o.op === "arc" && o.r === RING_RADIUS);
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
  // AC: "60px cells" — consecutive lattice lines are exactly one cell apart (verified from the ops,
  // not just inferred from each line being a multiple of 60).
  const vxs = [...new Set(verticals.map((v) => v.lx))].sort((a, b) => a - b);
  const hys = [...new Set(horizontals.map((h) => h.ly))].sort((a, b) => a - b);
  for (let i = 1; i < vxs.length; i++) assert.equal(vxs[i] - vxs[i - 1], CELL, `vertical grid cell is ${CELL}px at x=${vxs[i]}`);
  for (let i = 1; i < hys.length; i++) assert.equal(hys[i] - hys[i - 1], CELL, `horizontal grid cell is ${CELL}px at y=${hys[i]}`);

  // AC: orthogonal path — ONE connected polyline through the waypoint centres, dark grey/black, 2px.
  // Verified from the RECORDED path ops (not re-derived from the walk): the renderer must emit a single
  // moveTo at waypoint 1 then exactly n-1 lineTos through waypoints 2..n IN ORDER, every step axis-aligned.
  // That proves "connected" (one subpath / one moveTo), "through the centres" (coords match the waypoints),
  // and "orthogonal — no diagonals, no mid-segment corners" (each step shares an axis; corners only at wps).
  const pathStroke = ops.find((o) => o.op === "stroke" && o.strokeStyle === "#222222");
  assert.ok(pathStroke, "path is stroked dark");
  assert.equal(pathStroke.lineWidth, 2, "path is 2px");
  const pathIdx = ops.indexOf(pathStroke);
  let pathBegin = pathIdx;
  while (pathBegin >= 0 && ops[pathBegin].op !== "beginPath") pathBegin--;
  assert.ok(pathBegin >= 0, "path has its own beginPath");
  const pathPts = ops.slice(pathBegin, pathIdx).filter((o) => o.op === "moveTo" || o.op === "lineTo");
  assert.equal(pathPts.length, n, `path traces ${n} points (1 moveTo + ${n - 1} lineTo)`);
  assert.equal(pathPts.filter((o) => o.op === "moveTo").length, 1, "path is ONE connected subpath (single moveTo)");
  assert.equal(pathPts[0].op, "moveTo", "path opens with a moveTo");
  for (let i = 0; i < n; i++) {
    const wp = walk.waypoints[i].position;
    const pt = pathPts[i];
    if (i > 0) assert.equal(pt.op, "lineTo", `path point ${i} is a lineTo`);
    assert.ok(pt.lx === wp.x && pt.ly === wp.y, `path point ${i} sits on waypoint ${i + 1}'s centre`);
    if (i > 0) {
      const prev = pathPts[i - 1];
      assert.ok(pt.lx === prev.lx || pt.ly === prev.ly, `path step ${i - 1}->${i} is orthogonal (no diagonal, no mid-segment corner)`);
    }
  }

  // AC: each waypoint a radius-25 circle; terminals (first+last) black fill/white border/white number,
  // interiors white fill/black border/black number; number centred in bold 20px Arial. Read styles from
  // the fill/stroke/fillText ops AFTER each arc (the renderer sets the style just before those calls).
  const circles = ops.filter((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS);
  assert.equal(circles.length, n, `${n} radius-${WAYPOINT_RADIUS} circles`);
  // Waypoint numbers only — exclude the US-014 turn labels (L/R/W), which are also fillText ops.
  const texts = ops.filter((o) => o.op === "fillText" && !TURN_LABELS.has(o.text));
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

/**
 * US-014: outbound turn labels (L/R/W at the NE 46px position; terminals none) and orange wildcard
 * rings (r=30, 3px), each governed INDEPENDENTLY by showTurns / showWildcards. Asserts the labels
 * and rings are present & correct when their toggle is on, and absent when it is off — across all
 * four toggle combinations — proving the W label tracks Show Turns and the ring tracks Show Wildcards.
 */
function verifyTurnsAndWildcards(count, seed) {
  const walk = generateWalk(count, seed);
  const n = walk.waypoints.length;
  const wildcards = walk.waypoints.filter((wp) => wp.wildcard);
  const labelled = walk.waypoints.filter((wp) => expectedLabel(wp) !== null);
  assert.ok(wildcards.length > 0, `count=${count} seed=${seed} has at least one wildcard to test`);
  assert.ok(labelled.length > 0, `count=${count} seed=${seed} has at least one turn label to test`);

  // --- Turn labels (showTurns on): one L/R/W per interior waypoint, at its NE 46px label position.
  const opsT = renderToOps(walk, { showWildcards: false, showTurns: true });
  const labels = turnLabelOps(opsT);
  assert.equal(labels.length, labelled.length, `${labelled.length} turn labels (one per interior waypoint)`);
  for (const wp of walk.waypoints) {
    const want = expectedLabel(wp);
    const lp = turnLabelPoint(wp.position);
    const hit = labels.filter((o) => o.lx === lp.x && o.ly === lp.y);
    if (want === null) {
      assert.equal(hit.length, 0, `terminal/labelless wp${wp.sequenceNumber} draws no turn label`);
      continue;
    }
    assert.equal(hit.length, 1, `wp${wp.sequenceNumber} draws exactly one turn label at its NE position`);
    assert.equal(hit[0].text, want, `wp${wp.sequenceNumber} turn label text`);
    assert.equal(hit[0].fillStyle, TURN_LABEL_COLOUR, `wp${wp.sequenceNumber} turn label colour`);
    assert.equal(hit[0].font, TURN_LABEL_FONT, `wp${wp.sequenceNumber} turn label font`);
    assert.equal(hit[0].textAlign, "center", `wp${wp.sequenceNumber} turn label centred (align)`);
    assert.equal(hit[0].textBaseline, "middle", `wp${wp.sequenceNumber} turn label centred (baseline)`);
    // AC geometry, verified INDEPENDENTLY of turnLabelPoint: the offset from the RECORDED label op to
    // the RAW waypoint centre must be the fixed NE (45°) direction, exactly 46px out. The label is
    // LOCATED via turnLabelPoint (which the renderer and harness share, so the match always succeeds),
    // but this check reads the op's own coordinates — so a regression in turnLabelPoint's geometry
    // (wrong distance, wrong quadrant, off 45°) is caught here even though both sides moved together.
    const dx = hit[0].lx - wp.position.x;
    const dy = hit[0].ly - wp.position.y;
    assert.ok(Math.abs(Math.hypot(dx, dy) - TURN_LABEL_OFFSET) < 1e-9, `wp${wp.sequenceNumber} label is ${TURN_LABEL_OFFSET}px from the centre`);
    assert.ok(dx > 0 && dy < 0, `wp${wp.sequenceNumber} label is to the NE (east + up; y grows downward)`);
    assert.ok(Math.abs(dx + dy) < 1e-9, `wp${wp.sequenceNumber} label is at 45° (dx === -dy)`);
  }
  // Every wildcard's label is specifically "W" (it is governed by Show Turns, not Show Wildcards).
  for (const wp of wildcards) {
    const lp = turnLabelPoint(wp.position);
    const hit = labels.find((o) => o.lx === lp.x && o.ly === lp.y);
    assert.ok(hit && hit.text === "W", `wildcard wp${wp.sequenceNumber} shows a W label under Show Turns`);
  }

  // --- Wildcard rings (showWildcards on): one orange r=30 3px ring per wildcard, at its centre.
  const opsW = renderToOps(walk, { showWildcards: true, showTurns: false });
  const rings = ringArcOps(opsW);
  assert.equal(rings.length, wildcards.length, `${wildcards.length} wildcard rings (one per wildcard)`);
  for (const wp of wildcards) {
    const ring = rings.find((o) => o.lx === wp.position.x && o.ly === wp.position.y);
    assert.ok(ring, `wildcard wp${wp.sequenceNumber} has a ring at its centre`);
    assert.equal(ring.strokeStyle, RING_COLOUR, `wildcard wp${wp.sequenceNumber} ring is orange`);
    assert.equal(ring.lineWidth, RING_WIDTH, `wildcard wp${wp.sequenceNumber} ring is ${RING_WIDTH}px`);
  }
  // No ring sits on a non-wildcard waypoint.
  for (const wp of walk.waypoints) {
    if (wp.wildcard) continue;
    assert.ok(!rings.some((o) => o.lx === wp.position.x && o.ly === wp.position.y), `non-wildcard wp${wp.sequenceNumber} has no ring`);
  }

  // --- Independence across all four toggle combinations.
  for (const showTurns of [false, true]) {
    for (const showWildcards of [false, true]) {
      const ops = renderToOps(walk, { showWildcards, showTurns });
      assert.equal(turnLabelOps(ops).length, showTurns ? labelled.length : 0, `labels present iff showTurns (T=${showTurns} W=${showWildcards})`);
      assert.equal(ringArcOps(ops).length, showWildcards ? wildcards.length : 0, `rings present iff showWildcards (T=${showTurns} W=${showWildcards})`);
      // The base picture (numbered waypoint circles) is unaffected by either toggle.
      assert.equal(ops.filter((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS).length, n, `${n} waypoint circles regardless of toggles`);
      assert.equal(ops.filter((o) => o.op === "fillText" && !TURN_LABELS.has(o.text)).length, n, `${n} waypoint numbers regardless of toggles`);
    }
  }

  console.log(`  ✓ count=${count} seed=${seed}: ${labelled.length} turn labels, ${wildcards.length} wildcard rings, toggles independent`);
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

console.log("US-014 turn labels + wildcard rings (counts with >=1 wildcard):");
// count=2 has no interior/wildcards (covered by verifyDraw above); 10/20/90 all have wildcards.
verifyTurnsAndWildcards(10, 4242);
verifyTurnsAndWildcards(20, 99);
verifyTurnsAndWildcards(90, 4242);
console.log("ALL RENDERER ASSERTIONS PASSED");
