# Non-adjacent waypoints keep a minimum gap

Non-adjacent waypoints (sequence numbers more than one apart) must keep a `MIN_WAYPOINT_GAP` (20px)
gap between their circle edges in generation-space — i.e. their centres are at least
`2 * WAYPOINT_RADIUS + MIN_WAYPOINT_GAP` (70px) apart. **Adjacent** (consecutive) waypoints are
exempt: they are joined by a visible path segment (length 60–140px), and that connection is the
relationship — they are *meant* to sit near each other.

The earlier `noWaypointCirclesOverlap` rule only rejected centres closer than `2 * WAYPOINT_RADIUS`
(50px), which permits two radius-25 circles to be **tangent (zero gap)**. For non-adjacent
waypoints — unrelated parts of the walk that happen to fold back near each other — touching circles
read as a collision/error (observed on a generated walk where waypoints #49 and #54 sat tangent).
That hard overlap floor stays in place; this adds a separate breathing-room floor for non-adjacent
pairs only.

**Why generation-space, not a render fix:** per ADR-0005 the A4 fit is a *uniform* downscale, so two
circles tangent in generation-space stay tangent at every rendered scale — there is no render-time
nudge that can separate them without breaking the single-coordinate-system invariant. The gap must
therefore be a generation-space guarantee, enforced in both `layout-rules` (the `Walk` invariant) and
the `walk-generator` hot loop. Because the circle radius and the gap both scale together under the
downscale, the rule fixes a **scale-independent** gap-to-radius ratio (20/25 ≈ 0.8×), so the
separation reads the same at any waypoint count.

**Consequences:**
- A new `checkLayout` constraint (`non-adjacent-waypoints-too-close`); `Walk.create` throws on it.
- The generator's `newWaypointConflicts` enforces the larger threshold for non-adjacent prior
  waypoints (keeping the 50px overlap floor for the one adjacent predecessor), so generated walks
  remain always-valid. Generation has slightly less room, absorbed by the existing growth/re-roll
  budget (ADR-0002); reduce the gap before loosening those bounds if a count ever fails to generate.
- **Qualifies ADR-0005:** "dense, sub-nominal on-screen spacing is intended" still holds for the path
  as a whole, but *touching non-adjacent waypoint circles* are explicitly excluded from that stance.
