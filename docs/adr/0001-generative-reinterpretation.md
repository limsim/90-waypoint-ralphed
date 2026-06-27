# Generative reinterpretation, not faithful reproduction

The 90 Waypoint Walk, in its source form, is a single fixed sequence of 90 turns that
produces the same map anywhere in the world. This app deliberately does the opposite: it
randomises the turn sequence (and the waypoint count, 10–90) on every generation, so the
map changes each time. We chose this because the original notebook turn data isn't
available to us (only descriptive links in `requirements/source-info.md`), and because a
generative, interactive toy is more valuable here than a static reproduction.

**Consequence:** "the map stays the same" — the defining property of the original piece —
does not hold in this app. We are building walks *in the style of* the work, not *the* walk.
