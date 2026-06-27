# Pure iterator generator with cooperative yielding (no Web Worker)

`walkGenerator.generate(...)` is a pure synchronous **generator function** (`function*`) that yields a
small progress value every batch of attempts (~50, or once per re-roll) and returns the final `Walk`
(or a failure signal after exhausting the bounded re-rolls of ADR 0002). It touches no timers and no
DOM — only cooperative pause points — so it stays deterministic given the `RandomSource` and is driven
straight to completion in tests.

The `GenerateWalk` use case drives the iterator and `await`s a yield-to-event-loop between batches (via
an injected yield port: a macrotask in production, immediate/no-op in tests) so the browser paints the
"Generating…" overlay and the spinner keeps animating during rare pathological generations. The driving
DOM adapter disables the button and shows/hides the overlay around the use case, and restores controls
in a `finally`.

**Rejected:**
- *Web Worker (true off-main-thread):* needs a separate file or inline blob (fighting the clean
  ES-module setup) and `Walk` serialization across the boundary; unjustified when generation is usually
  milliseconds and the domain is already pure.
- *Plain synchronous generate with a single pre-yield:* the overlay would appear, but the page would
  still freeze and the spinner stall during slow generations.
