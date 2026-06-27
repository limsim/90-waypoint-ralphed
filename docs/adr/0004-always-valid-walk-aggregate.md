# Walk is an always-valid aggregate; generation uses a separate placement buffer

A `Walk` instance is valid by construction: `Walk.create(...)` runs the full invariant set (the
"Iterate design" criteria — no overlaps, 55px parallel separation, 35px waypoint clearance, no
segment crossing a non-adjacent circle, 8px label clearance, within bounds) and **throws** on any
violation. No invalid `Walk` can exist, and there is no `isValid()` to forget to call.

Because a walk is built incrementally and is invalid until the final waypoint lands, generation does
**not** build a draft `Walk`. It works on a lightweight **mutable placement buffer** and wraps the
finished, valid placement into the aggregate at the end. The constraint checks are pure predicates in
`layout-rules`, shared by both paths:

- **During placement** they return booleans / violation lists — failure is normal and frequent (the
  hot loop), so no exceptions.
- **At the aggregate boundary** the factory composes them into an invariant that **throws** — a
  failure there is a generator bug, not a normal outcome.

**Considered and rejected:** an anemic `Walk` (plain data) + an external `validateLayout()` the caller
must remember to run (lets invalid walks exist); and modelling the in-progress buffer *as* a "draft"
`Walk` (softens the always-valid invariant). Do not refactor the placement buffer into a `Walk` state —
it would reintroduce representable invalid walks.
