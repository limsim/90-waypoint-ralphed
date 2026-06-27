# Bounded generation with whole-sequence re-roll

Generation must place a fixed random turn sequence under hard spacing constraints (no two
parallel segments closer than 55px, no segment within 35px of a non-adjacent waypoint, turn
labels clear of segments, no overlaps). Because the turn sequence is fixed for an attempt and
segment lengths are capped (≤ 8×140px), some sequences — e.g. long same-direction runs that
spiral inward — are geometrically infeasible at *any* bounded segment length; growing the
canvas does not help, because the binding constraint is segment-to-segment, not the edge.

We bound every loop and add an outer escape: **200** placement attempts per size → grow bounds
**10%** up to **~10** times → re-randomise the *entire* turn sequence (up to **~20** times) →
graceful error if all fail. This guarantees termination.

## Considered options

- *Grow bounds unboundedly (original spec):* rejected — cannot escape the topological-infeasibility
  case, so the UI can hang forever.
- *Per-turn fallback (turn the other way / go straight):* rejected — would make a waypoint's turn
  label lie about its actual turn.
- *Re-roll the whole sequence (chosen):* the user requests a waypoint *count*, not a specific shape,
  so silently selecting a different feasible random sequence is invisible and keeps every label
  truthful.
