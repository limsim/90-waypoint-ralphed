# Turn labels keep clear of non-adjacent waypoint circles

A waypoint's outbound turn label (R/L/W) is drawn at a fixed NE (45°) point `TURN_LABEL_OFFSET` (46px)
from the waypoint centre (`turnLabelPoint`). Every interior waypoint's label must keep clear of the
**circle of every non-adjacent waypoint**: the label point must sit at least
`WAYPOINT_RADIUS + TURN_LABEL_RADIUS + TURN_LABEL_CLEARANCE` (25 + 10 + 8 = 43px) from that waypoint's
centre. **Adjacent** (consecutive) waypoints are exempt, as in ADR-0007.

ADR-0007 gave non-adjacent waypoint *circles* a breathing-room gap, but only the circles. The label is a
separate piece of geometry that juts 46px out to the NE, and nothing constrained it against another
waypoint's circle. A non-adjacent waypoint need only keep its *centre* 70px away (ADR-0007); sitting 70px
out along the NE ray puts its circle just `70 − 46 = 24px` from the label — inside the 25px radius. This
was observed on a generated walk where waypoint 27's label sat on waypoint 21's circle. This rule closes
that gap.

**Modelling the label as a disc.** The rendered glyph (`bold 16px Arial`, centred) is approximated as a
disc of radius `TURN_LABEL_RADIUS = 10` — the widest glyph ("W") has a bounding-box half-diagonal of
≈ 9.2px; 10 is a deliberate slight over-approximation. Clearance reuses the existing `TURN_LABEL_CLEARANCE`
(8px), the same gap a label already keeps from non-adjacent segments.

**Why the adjacency exemption is required, not cosmetic.** Segments are axis-aligned, so an adjacent
neighbour reached by the minimum 60px segment sits due N/E/S/W. The closest case (N or E at 60px) is
`hypot(32.527, 60 − 32.527) = 42.577px` from the NE label — below the 43px threshold. Without the
`|i − j| ≤ 1` exemption, legitimate adjacent placements near the 60px floor would be falsely rejected.

**Why generation-space, not a render fix:** identical to ADR-0007. The A4 fit is a uniform downscale
(ADR-0005), so a label tangent to a circle in generation-space stays tangent at every rendered scale;
there is no render-time nudge that respects the single-coordinate-system invariant. The rule is enforced
in both `layout-rules` (the `Walk` invariant) and the `walk-generator` hot loop, using the exact same
`turnLabelPoint` geometry so the two cannot diverge.

**Consequences:**
- A new `checkLayout` constraint (`turn-label-too-close-to-waypoint`); `Walk.create` throws on it. Only
  interior waypoints own a label, but the *protected* circle may be terminal — terminals are not skipped
  on the circle side.
- `newWaypointConflicts` enforces the 43px threshold in both directions (new label vs prior circles; prior
  labels vs new circle), exempting only the one adjacent predecessor. Generation has slightly less room,
  absorbed by the existing growth/re-roll budget (ADR-0002). The no-touch floor is 35px
  (`WAYPOINT_RADIUS + TURN_LABEL_RADIUS`); reduce the clearance toward it before loosening those bounds if
  a count ever fails to generate, and never below it.
- **Extends ADR-0007** from circle-to-circle to label-to-circle; **qualifies ADR-0005** the same way:
  touching a label against a non-adjacent circle is not "intended density".

**Out of scope (known follow-ups):**
- `turnLabelsClearOfNonAdjacentSegments` also treats the label as a bare point and under-accounts for the
  glyph extent against segments — a separate, lower-severity defect with its own boundary tests.
- Two non-adjacent NE labels can still overlap each other (label-vs-label) — a different visual defect,
  not the reported one.
