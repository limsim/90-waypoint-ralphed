# Spacing constraints are generation-space guarantees, not rendered-pixel guarantees

The domain works in a single generation-space coordinate system, and all spacing constraints
(55px parallel separation, 35px waypoint clearance, 8px label clearance) are enforced there.
Rendering then uniformly scales the walk's bounding box down to fit A4 (when it exceeds it) and
CSS-scales the canvas to the viewport.

For high waypoint counts the natural bounding box greatly exceeds A4, so the downscale shrinks
absolute on-screen spacing well below the nominal minimums. **This is accepted:** you cannot both
cap output at a single A4 page and guarantee physical 55px separation for up to 90 waypoints — there
isn't room. The constraints guarantee a well-formed, legible walk *at its natural scale*; downscaling
preserves proportions, not absolute gaps. Dense A4 output for large walks is intended (it's a
generative art print).

**Consequences:**
- The domain holds one coordinate system; A4 cap and viewport-fit are renderer-adapter transforms only.
- The tooltip "cumulative distance" is reported in **generation-space px** (true summed segment
  lengths), stable across window resizes — not rendered pixels. Label it neutrally.
- Hit-testing must invert **both** transforms (viewport → A4 → generation) in the canvas adapter.

> Qualified by ADR-0007: non-adjacent waypoint circles keep a minimum generation-space gap —
> touching is not "intended density".
