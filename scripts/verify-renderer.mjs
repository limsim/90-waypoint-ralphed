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
// Exits non-zero on the first failed assertion so it is usable as a gate. US-014 (turn labels,
// wildcard rings) and US-015 (A4 cap / uniform downscale / auto-centre) extend draw() and are
// asserted here too — US-015 checks the recorded SCREEN coords, the complement of US-013/US-014's
// local-coord checks.
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

// US-015 AC golden values (the A4 cap). HARD-CODED from the acceptance criteria, deliberately NOT
// imported from the renderer, so a drift in the source constants fails the gate rather than being
// silently agreed with. The fake canvas above is sized to A4 exactly, so the fit cap == the canvas.
const A4_W = 794;
const A4_H = 1123;

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

// US-017 AC golden values (hover highlight), HARD-CODED from the acceptance criteria — not imported,
// so a drift in the source constants is caught here rather than silently agreed with.
const SEGMENT_COLOUR = "#222222"; // path ink (the hover-thickened segments use the same dark ink)
const HIGHLIGHT_SEGMENT_WIDTH = 4; // AC: hovered waypoint's connecting segments "thicken to 4px"
const HIGHLIGHT_SHADOW_BLUR = 8; // hovered waypoint's circle gains a drop shadow (non-zero blur)

// AC: the wildcard ring is drawn "at radius 30px OUTSIDE the centre" — i.e. it sits clear of the
// waypoint circle (radius 25). A one-time golden invariant so a future tweak that shrank the ring
// inside the circle (or grew the circle past it) is caught immediately.
assert.ok(RING_RADIUS > WAYPOINT_RADIUS, "wildcard ring radius sits outside the waypoint circle");

/**
 * A recording fake `CanvasRenderingContext2D`. Every op is pushed with a snapshot of the styles
 * that are LIVE at call time (fillStyle/strokeStyle/lineWidth/font/...), captured via getter/setter
 * props so e.g. a fill() records the fillStyle as it stood when fill() ran — not some later value.
 *
 * The transform stack tracks the canvas affine matrix as `{ a, d, e, f }` — uniform scale (`a`/`d`)
 * plus translate (`e`/`f`), no rotation/skew (the renderer never uses any). It is composed exactly
 * as canvas does, so the recorded `x`/`y` are SCREEN coordinates: `x = a·lx + e`, `y = d·ly + f`.
 * The untransformed local (generation-space) coordinate is kept alongside as `lx`/`ly`. US-015's
 * A4 fit introduces a real scale, so `a`/`d` are no longer 1 — screen coords (`x`/`y`) now reflect
 * the scale + centre, while `lx`/`ly` stay in generation space (US-013/US-014 assertions use those).
 */
function makeFakeContext(canvasW = CANVAS_W, canvasH = CANVAS_H) {
  // Shadow props are tracked too (US-017 hover drop shadow); they snapshot like the other styles.
  const state = { fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "", lineJoin: "", lineCap: "", shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 };
  const ops = [];
  let m = { a: 1, d: 1, e: 0, f: 0 };
  const stack = [];
  const snap = () => ({ ...state });
  const sx = (x) => m.a * x + m.e;
  const sy = (y) => m.d * y + m.f;
  const ctx = {
    canvas: { width: canvasW, height: canvasH },
    // save/restore model the FULL drawing state (matrix + styles), exactly as a real 2D context does,
    // so the US-017 hover drop shadow is correctly SCOPED to the highlighted circle (its own
    // save/restore) and does not bleed onto later circles or the number — a matrix-only restore would
    // leak the shadow and silently pass a regression. Object.assign keeps the same `state` reference
    // the getters/setters close over.
    save() { stack.push({ m: { ...m }, state: { ...state } }); ops.push({ op: "save" }); },
    restore() { const top = stack.pop(); m = top.m; Object.assign(state, top.state); ops.push({ op: "restore" }); },
    // setTransform replaces the matrix; the renderer only ever calls it as the identity reset.
    setTransform(a, _b, _c, d, e, f) { m = { a, d, e, f }; ops.push({ op: "setTransform", a, d, e, f }); },
    translate(x, y) { m = { ...m, e: m.a * x + m.e, f: m.d * y + m.f }; ops.push({ op: "translate", x, y }); },
    scale(x, y) { m = { ...m, a: m.a * x, d: m.d * y }; ops.push({ op: "scale", x, y }); },
    beginPath() { ops.push({ op: "beginPath" }); },
    moveTo(x, y) { ops.push({ op: "moveTo", x: sx(x), y: sy(y), lx: x, ly: y }); },
    lineTo(x, y) { ops.push({ op: "lineTo", x: sx(x), y: sy(y), lx: x, ly: y }); },
    arc(x, y, r) { ops.push({ op: "arc", x: sx(x), y: sy(y), lx: x, ly: y, r, ...snap() }); },
    fillRect(x, y, w, h) { ops.push({ op: "fillRect", x: sx(x), y: sy(y), w: w * m.a, h: h * m.d, ...snap() }); },
    clearRect(x, y, w, h) { ops.push({ op: "clearRect", x, y, w, h }); },
    fill() { ops.push({ op: "fill", ...snap() }); },
    stroke() { ops.push({ op: "stroke", ...snap() }); },
    fillText(text, x, y) { ops.push({ op: "fillText", text, x: sx(x), y: sy(y), lx: x, ly: y, ...snap() }); },
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

function renderToOps(walk, options = { showWildcards: true, showTurns: true }, canvasW = CANVAS_W, canvasH = CANVAS_H) {
  const { ctx, ops } = makeFakeContext(canvasW, canvasH);
  const renderer = new CanvasRenderer({ width: canvasW, height: canvasH, getContext: () => ctx });
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

  // US-014 boundary cross-check: with BOTH toggles on (renderToOps default), the number of turn
  // labels equals the interior (labelled) waypoint count and the number of rings equals the wildcard
  // count. For count=2 BOTH are zero — every waypoint is terminal — which is the purest verification
  // of "first and last waypoints show no label". verifyTurnsAndWildcards requires >=1 label AND >=1
  // ring, so it can NEVER cover the all-terminal walk; this is the only place that does.
  const expectedLabels = walk.waypoints.filter((wp) => expectedLabel(wp) !== null).length;
  const expectedRings = walk.waypoints.filter((wp) => wp.wildcard).length;
  assert.equal(turnLabelOps(ops).length, expectedLabels, `${expectedLabels} turn labels with both toggles on`);
  assert.equal(ringArcOps(ops).length, expectedRings, `${expectedRings} wildcard rings with both toggles on`);

  console.log(`  ✓ count=${count} seed=${seed}: ${n} waypoints, ${circles.length} circles, ${verticals.length}×${horizontals.length} grid, ${texts.length} numbers, ${expectedLabels} labels, ${expectedRings} rings`);
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

/**
 * US-015: the padded content box is uniformly scaled to fit A4 (794×1123) when it exceeds those
 * dimensions, never scaled up, and centred so the full walk is visible — a pure adapter transform
 * that leaves the domain's generation-space coordinates untouched.
 *
 * Asserts from the RECORDED SCREEN coordinates (op.x/op.y), the complement of the US-013/US-014
 * checks which read the local op.lx/op.ly. The scale is DERIVED from the output (the screen spread
 * of two waypoints over their generation-space spread), not read from the renderer's scale op, then
 * matched to the AC formula computed with the golden A4 constants — so a wrong cap, wrong clamp, or
 * wrong centre is caught from first principles.
 */
function verifyA4Fit(count, seed) {
  const walk = generateWalk(count, seed);
  const ops = renderToOps(walk);
  const box = walk.boundingBox;
  const minX = box.minX - PAD, minY = box.minY - PAD;
  const contentW = (box.maxX - box.minX) + 2 * PAD;
  const contentH = (box.maxY - box.minY) + 2 * PAD;

  // The AC scale: fit within A4, clamped to ≤ 1 (small walks are never enlarged).
  const fits = contentW <= A4_W && contentH <= A4_H;
  const sW = A4_W / contentW, sH = A4_H / contentH;
  const expectedScale = Math.min(1, sW, sH);
  // Which dimension forces the downscale (the smaller per-axis fit ratio binds). "none" when it fits.
  // The "uniformly scaled down to fit A4" AC must hold whichever axis binds; the call site below
  // asserts the gate exercises BOTH a width-bound and a height-bound downscale (a width-only
  // regression — dropping the A4_H/contentH term — is invisible until a height-bound walk is tested).
  const bind = fits ? "none" : sW < sH ? "WIDTH" : "HEIGHT";

  // Waypoint circles carry both local (lx/ly) and screen (x/y) coordinates — the transform fingerprint.
  const circles = ops.filter((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS);
  assert.equal(circles.length, walk.waypoints.length, "every waypoint drew a circle");

  // AC5: generation-space coordinates are untouched — the local coords still equal the raw waypoints.
  for (let i = 0; i < walk.waypoints.length; i++) {
    const wp = walk.waypoints[i].position;
    const hit = circles.find((o) => o.lx === wp.x && o.ly === wp.y);
    assert.ok(hit, `wp${i + 1} circle keeps its generation-space (lx,ly) — domain coords untouched`);
  }

  // Derive the applied uniform scale from two circles' screen-vs-local spread (independent of the
  // renderer's own scale op). Use whichever axis actually varies (a count=2 walk is vertical-only).
  const a = circles[0], b = circles[circles.length - 1];
  const dlx = b.lx - a.lx, dly = b.ly - a.ly;
  const derivedScale = Math.abs(dlx) > Math.abs(dly) ? (b.x - a.x) / dlx : (b.y - a.y) / dly;
  assert.ok(Math.abs(derivedScale - expectedScale) < 1e-9, `scale ${derivedScale} matches the A4-fit formula ${expectedScale}`);
  assert.ok(derivedScale <= 1 + 1e-9, "scale never exceeds 1 (small walks are not enlarged)");
  if (fits) {
    assert.ok(Math.abs(derivedScale - 1) < 1e-9, `count=${count} fits within A4 → not scaled (scale === 1)`);
  } else {
    assert.ok(derivedScale < 1 - 1e-9, `count=${count} exceeds A4 → uniformly downscaled (scale < 1)`);
  }

  // First-principles position check: every circle's recorded SCREEN position must equal the A4-fit
  // transform of its generation-space centre (scale + centre offset), computed here from the golden
  // A4 constants and the walk's own bounding box — never by re-running the renderer's transform.
  const offsetX = (A4_W - contentW * expectedScale) / 2;
  const offsetY = (A4_H - contentH * expectedScale) / 2;
  for (const o of circles) {
    const ex = offsetX + expectedScale * (o.lx - minX);
    const ey = offsetY + expectedScale * (o.ly - minY);
    assert.ok(Math.abs(o.x - ex) < 1e-6, `circle screen x ${o.x} == fitted ${ex}`);
    assert.ok(Math.abs(o.y - ey) < 1e-6, `circle screen y ${o.y} == fitted ${ey}`);
  }

  // AC1 cap: the whole padded content box lands within the A4 page after the fit.
  const boxLeft = offsetX, boxRight = offsetX + contentW * expectedScale;
  const boxTop = offsetY, boxBottom = offsetY + contentH * expectedScale;
  assert.ok(boxLeft >= -1e-6 && boxRight <= A4_W + 1e-6, `content fits A4 width [${boxLeft}, ${boxRight}] ⊆ [0, ${A4_W}]`);
  assert.ok(boxTop >= -1e-6 && boxBottom <= A4_H + 1e-6, `content fits A4 height [${boxTop}, ${boxBottom}] ⊆ [0, ${A4_H}]`);

  // AC3 centre: equal margins on opposite sides (the centring PROPERTY, not the renderer's formula).
  assert.ok(Math.abs(boxLeft - (A4_W - boxRight)) < 1e-6, "content is centred horizontally (equal L/R margins)");
  assert.ok(Math.abs(boxTop - (A4_H - boxBottom)) < 1e-6, "content is centred vertically (equal T/B margins)");

  // The binding axis is filled EXACTLY to the A4 edge — the sharpest proof that the correct term drove
  // the scale. A width-bound downscale must make the scaled content width === A4 width; a height-bound
  // one must make the scaled height === A4 height. This is what a "width-only" scale regression breaks
  // on a HEIGHT-bound walk: it would leave the scaled height OVER A4_H (overflowing) rather than ON it.
  if (bind === "WIDTH") assert.ok(Math.abs(contentW * expectedScale - A4_W) < 1e-6, `width-bound: scaled width fills A4 width exactly (${(contentW * expectedScale).toFixed(2)} === ${A4_W})`);
  if (bind === "HEIGHT") assert.ok(Math.abs(contentH * expectedScale - A4_H) < 1e-6, `height-bound: scaled height fills A4 height exactly (${(contentH * expectedScale).toFixed(2)} === ${A4_H})`);

  // The background still covers the whole canvas in screen space (drawn under the identity reset).
  const bg = ops.find((o) => o.op === "fillRect");
  assert.ok(bg && bg.x === 0 && bg.y === 0 && bg.w === A4_W && bg.h === A4_H, "background still covers the full A4 canvas");

  console.log(`  ✓ count=${count} seed=${seed}: scale=${derivedScale.toFixed(4)} (${fits ? "within A4, not enlarged" : `downscaled to fit A4, ${bind}-bound`}), centred, domain coords untouched`);
  return { count, seed, scale: derivedScale, bind };
}

/**
 * US-015 AC1 — "the rendered canvas is capped at A4 (794×1123)". The renderer's cap is
 * `Math.min(A4, canvas dim)`, so the content is bounded by A4 even when the canvas ELEMENT is larger.
 * verifyA4Fit above can't prove this: it renders onto an A4-sized canvas, where `min(A4, canvas)` ==
 * A4 == canvas, so a regression that capped at the CANVAS instead of A4 (dropping the `Math.min`)
 * would pass every one of its assertions. This test renders the SAME oversized walk onto a canvas
 * STRICTLY LARGER than A4 and large enough that the walk fits it at natural size — so a canvas-only
 * cap would NOT downscale at all (scale 1), while the A4 cap still shrinks it to ≤ 794×1123. The two
 * hypotheses diverge sharply, so matching the A4-cap scale proves the cap is A4, not the canvas.
 */
function verifyA4CapOnLargerCanvas(count, seed) {
  const walk = generateWalk(count, seed);
  const box = walk.boundingBox;
  const minX = box.minX - PAD, minY = box.minY - PAD;
  const contentW = (box.maxX - box.minX) + 2 * PAD;
  const contentH = (box.maxY - box.minY) + 2 * PAD;

  // A canvas strictly larger than A4 AND big enough to hold the walk at natural size (so the
  // canvas-only cap is exactly 1 — no downscale — making the A4 cap the ONLY reason to shrink).
  const bigW = Math.max(2 * A4_W, Math.ceil(contentW) + 1);
  const bigH = Math.max(2 * A4_H, Math.ceil(contentH) + 1);

  const a4Scale = Math.min(1, A4_W / contentW, A4_H / contentH);
  const canvasScale = Math.min(1, bigW / contentW, bigH / contentH);
  assert.equal(canvasScale, 1, `walk fits the ${bigW}×${bigH} canvas at natural size (canvas-only cap == 1)`);
  assert.ok(a4Scale < 1 - 1e-9, `count=${count} exceeds A4, so the A4 cap must downscale (a4Scale ${a4Scale} < 1)`);

  const ops = renderToOps(walk, { showWildcards: true, showTurns: true }, bigW, bigH);
  const circles = ops.filter((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS);
  assert.equal(circles.length, walk.waypoints.length, "every waypoint drew a circle on the larger canvas");

  // Derive the applied scale from the output (screen vs local spread) and assert it is the A4 cap,
  // NOT the canvas cap of 1. This is the crux: a renderer that capped at the canvas would emit scale 1.
  const a = circles[0], b = circles[circles.length - 1];
  const dlx = b.lx - a.lx, dly = b.ly - a.ly;
  const derivedScale = Math.abs(dlx) > Math.abs(dly) ? (b.x - a.x) / dlx : (b.y - a.y) / dly;
  assert.ok(Math.abs(derivedScale - a4Scale) < 1e-9, `scale ${derivedScale} is the A4 cap ${a4Scale}, NOT the canvas cap ${canvasScale}`);

  // The drawn content box stays within A4 even though the canvas is far larger — that IS "capped at A4".
  const screenW = contentW * a4Scale, screenH = contentH * a4Scale;
  assert.ok(screenW <= A4_W + 1e-6, `content screen width ${screenW} ≤ A4 ${A4_W} (capped at A4, not the ${bigW}px canvas)`);
  assert.ok(screenH <= A4_H + 1e-6, `content screen height ${screenH} ≤ A4 ${A4_H} (capped at A4, not the ${bigH}px canvas)`);

  // Still auto-centred — but over the LARGER canvas, so the margins grow with it (centring uses the
  // canvas dim, while the scale uses the A4 cap). Verify every circle lands at the centred-fit position.
  const offsetX = (bigW - screenW) / 2;
  const offsetY = (bigH - screenH) / 2;
  for (const o of circles) {
    const ex = offsetX + a4Scale * (o.lx - minX);
    const ey = offsetY + a4Scale * (o.ly - minY);
    assert.ok(Math.abs(o.x - ex) < 1e-6, `circle screen x ${o.x} == fitted ${ex} on the larger canvas`);
    assert.ok(Math.abs(o.y - ey) < 1e-6, `circle screen y ${o.y} == fitted ${ey} on the larger canvas`);
  }
  const boxLeft = offsetX, boxRight = offsetX + screenW;
  const boxTop = offsetY, boxBottom = offsetY + screenH;
  assert.ok(Math.abs(boxLeft - (bigW - boxRight)) < 1e-6, "centred horizontally on the larger canvas (equal L/R margins)");
  assert.ok(Math.abs(boxTop - (bigH - boxBottom)) < 1e-6, "centred vertically on the larger canvas (equal T/B margins)");

  // Background still covers the whole (larger) canvas in screen space.
  const bg = ops.find((o) => o.op === "fillRect");
  assert.ok(bg && bg.w === bigW && bg.h === bigH, `background covers the full ${bigW}×${bigH} canvas`);

  console.log(`  ✓ count=${count} seed=${seed}: capped at A4 (scale ${derivedScale.toFixed(4)}) on a ${bigW}×${bigH} canvas — not enlarged to fill it; centred`);
}

/**
 * US-017 hit-testing: a viewport (client) coordinate maps back to the waypoint under it by inverting
 * BOTH transforms — the canvas element's CSS scale (viewport → backing store, from
 * getBoundingClientRect) and the A4 fit (backing store → generation space). Drives the REAL renderer:
 * for every waypoint it takes the recorded SCREEN (backing-store) centre, converts it to a CLIENT
 * coordinate through the given rect (which may be CSS-scaled and offset — that is exactly what hitTest
 * must undo), and asserts hitTest returns that waypoint. A half-size, offset rect exercises the
 * viewport-scale inversion; an A4-downscaled walk (count=90) exercises the A4-fit inversion. Also
 * asserts a click over empty canvas → null.
 */
function verifyHitTest(count, seed, rect) {
  const walk = generateWalk(count, seed);
  const { ctx, ops } = makeFakeContext();
  const canvas = { width: CANVAS_W, height: CANVAS_H, getContext: () => ctx, getBoundingClientRect: () => rect };
  const renderer = new CanvasRenderer(canvas);
  renderer.draw(walk, { showWildcards: true, showTurns: true });

  const scaleX = rect.width / CANVAS_W; // CSS element scale (backing store px → displayed px)
  const scaleY = rect.height / CANVAS_H;
  for (const wp of walk.waypoints) {
    const circle = ops.find((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS && o.lx === wp.position.x && o.ly === wp.position.y);
    assert.ok(circle, `wp${wp.sequenceNumber} drew a circle (recorded screen centre)`);
    // backing-store screen centre → client coordinate (the inverse of what hitTest must undo).
    const clientX = rect.left + circle.x * scaleX;
    const clientY = rect.top + circle.y * scaleY;
    const hit = renderer.hitTest(clientX, clientY);
    assert.ok(hit, `hitTest returns a waypoint at wp${wp.sequenceNumber}'s screen centre`);
    assert.equal(hit.sequenceNumber, wp.sequenceNumber, `hitTest maps the click back to wp${wp.sequenceNumber} (inverts viewport→A4→generation)`);
  }
  // The canvas's top-left corner maps to a generation point at least one padding (100px) outside the
  // waypoints' bounding box, so it is over no waypoint → null.
  assert.equal(renderer.hitTest(rect.left, rect.top), null, "a click over empty canvas returns null");

  console.log(`  ✓ count=${count} seed=${seed} rect ${rect.width}×${rect.height}@(${rect.left},${rect.top}): every waypoint hit-tested back, empty→null`);
}

/**
 * US-017 hover highlight: highlight(wp) re-renders with the waypoint's incident segments thickened to
 * 4px and a drop shadow on its circle, scoped so it bleeds onto neither later circles nor the number;
 * highlight(null) clears the emphasis; highlight before any draw is a no-op. Asserts from recorded ops.
 */
function verifyHighlight(count, seed) {
  const walk = generateWalk(count, seed);
  const { ctx, ops } = makeFakeContext();
  const canvas = { width: CANVAS_W, height: CANVAS_H, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
  const renderer = new CanvasRenderer(canvas);
  renderer.draw(walk, { showWildcards: true, showTurns: true });

  const n = walk.waypoints.length;
  const idx = walk.waypoints.findIndex((w) => w.isInterior); // interior → two incident segments
  const wp = walk.waypoints[idx];
  ops.length = 0; // capture only the highlight re-render
  renderer.highlight(wp);

  // 1. Incident segments thickened to 4px in dark ink, tracing prev→wp and wp→next.
  const thick = ops.find((o) => o.op === "stroke" && o.strokeStyle === SEGMENT_COLOUR && o.lineWidth === HIGHLIGHT_SEGMENT_WIDTH);
  assert.ok(thick, "highlighted waypoint's connecting segments are stroked at 4px");
  const ti = ops.indexOf(thick);
  let tb = ti;
  while (tb >= 0 && ops[tb].op !== "beginPath") tb--;
  const tpts = ops.slice(tb, ti).filter((o) => o.op === "moveTo" || o.op === "lineTo");
  const incident = [];
  if (idx > 0) incident.push([walk.waypoints[idx - 1].position, wp.position]);
  if (idx < n - 1) incident.push([wp.position, walk.waypoints[idx + 1].position]);
  assert.equal(tpts.length, incident.length * 2, `thick path traces ${incident.length} incident segment(s)`);
  incident.forEach(([from, to], k) => {
    const mv = tpts[k * 2], ln = tpts[k * 2 + 1];
    assert.ok(mv.op === "moveTo" && mv.lx === from.x && mv.ly === from.y, `incident segment ${k} starts at its 'from' waypoint`);
    assert.ok(ln.op === "lineTo" && ln.lx === to.x && ln.ly === to.y, `incident segment ${k} ends at its 'to' waypoint`);
  });

  // 2. The drop shadow is on the highlighted circle's fill, and SCOPED — the number drawn right after
  //    carries no shadow, and the NEXT waypoint's circle (drawn later) carries none either.
  const arcIdx = ops.findIndex((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS && o.lx === wp.position.x && o.ly === wp.position.y);
  const hlFill = ops.slice(arcIdx).find((o) => o.op === "fill");
  assert.equal(hlFill.shadowBlur, HIGHLIGHT_SHADOW_BLUR, "highlighted circle fill has the drop-shadow blur");
  assert.ok(hlFill.shadowColor !== "", "highlighted circle fill has a shadow colour");
  const hlText = ops.find((o) => o.op === "fillText" && o.lx === wp.position.x && o.ly === wp.position.y);
  assert.equal(hlText.shadowBlur, 0, "the highlighted waypoint's number carries no shadow (crisp)");
  const next = walk.waypoints[idx + 1]; // drawn AFTER the highlighted one → catches shadow bleed
  const nextArc = ops.findIndex((o) => o.op === "arc" && o.r === WAYPOINT_RADIUS && o.lx === next.position.x && o.ly === next.position.y);
  const nextFill = ops.slice(nextArc).find((o) => o.op === "fill");
  assert.equal(nextFill.shadowBlur, 0, "a later, non-highlighted circle has no drop shadow (shadow scoped)");

  // 3. highlight(null) clears the emphasis.
  ops.length = 0;
  renderer.highlight(null);
  assert.ok(!ops.some((o) => o.op === "stroke" && o.lineWidth === HIGHLIGHT_SEGMENT_WIDTH), "highlight(null) draws no 4px segments");
  assert.ok(!ops.some((o) => o.op === "fill" && o.shadowBlur > 0), "highlight(null) draws no shadowed circle");

  // 4. highlight is a no-op before any draw (no current walk to re-render).
  const { ctx: ctx2, ops: ops2 } = makeFakeContext();
  const fresh = new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => ctx2, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) });
  fresh.highlight(wp);
  assert.equal(ops2.length, 0, "highlight before any draw is a no-op");

  console.log(`  ✓ count=${count} seed=${seed}: wp${wp.sequenceNumber} highlight = 4px incident segments + scoped drop shadow; cleared by highlight(null)`);
}

/** US-017: hitTest before any draw (no walk / no transform yet) returns null rather than throwing. */
function verifyHitTestBeforeDraw() {
  const { ctx } = makeFakeContext();
  const renderer = new CanvasRenderer({ width: CANVAS_W, height: CANVAS_H, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) });
  assert.equal(renderer.hitTest(100, 100), null, "hitTest before any draw returns null");
  console.log("  ✓ hitTest before any draw returns null (no walk / transform yet)");
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

console.log("US-015 A4 cap / uniform downscale / auto-centre:");
// count=2 + small counts fit within A4 (scale === 1, not enlarged); the larger counts exceed A4 and
// downscale. The "uniformly scaled to FIT A4" AC must hold whichever axis is the binding constraint, so
// we deliberately cover BOTH: count=90/4242 is WIDTH-bound, count=30/17 is HEIGHT-bound (its 652px width
// fits A4 at natural size, but its 1278px height overflows, so ONLY the height term forces the scale —
// a regression dropping A4_H/contentH would leave it at scale 1 and overflow A4 vertically here).
const fitResults = [
  verifyA4Fit(2, 7),
  verifyA4Fit(10, 4242),
  verifyA4Fit(20, 99),
  verifyA4Fit(30, 17), // HEIGHT-bound downscale (width fits A4 at natural size)
  verifyA4Fit(90, 4242), // WIDTH-bound downscale
];
// Coverage gate: the downscale cases above must include BOTH a width-bound and a height-bound walk, so
// a future edit that removed (say) the height-bound seed — re-opening the width-only blind spot — fails.
const downscaleBinds = new Set(fitResults.filter((r) => r.scale < 1 - 1e-9).map((r) => r.bind));
assert.ok(downscaleBinds.has("WIDTH"), "a WIDTH-bound downscale case is exercised");
assert.ok(downscaleBinds.has("HEIGHT"), "a HEIGHT-bound downscale case is exercised");
console.log(`  ✓ downscale coverage spans both binding axes: ${[...downscaleBinds].sort().join(" + ")}`);

console.log("US-015 A4 cap holds on a canvas LARGER than A4 (cap is A4, not the canvas):");
// count=90 exceeds A4, so the A4 cap downscales even though the walk would fit the larger canvas at 1:1.
verifyA4CapOnLargerCanvas(90, 4242);

console.log("US-017 hit-testing (invert viewport→A4→generation) + hover highlight:");
// count=10 fits A4 at natural size (scale 1) — proves the viewport inversion alone; count=90 is
// A4-downscaled — proves the A4-fit inversion. A half-size, offset rect proves the CSS element-scale
// inversion (the canvas displayed smaller than its 794×1123 backing store on a narrow viewport).
verifyHitTest(10, 4242, { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H });
verifyHitTest(90, 4242, { left: 0, top: 0, width: CANVAS_W, height: CANVAS_H });
verifyHitTest(90, 4242, { left: 37, top: 21, width: CANVAS_W / 2, height: CANVAS_H / 2 }); // CSS-scaled + offset
verifyHitTestBeforeDraw();
verifyHighlight(20, 99);
verifyHighlight(90, 4242);
console.log("ALL RENDERER ASSERTIONS PASSED");
