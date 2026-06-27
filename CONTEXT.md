# 90 Waypoint Map

The app generates and draws orthogonal "walks" in the style of Marcus John Henry Brown's
90 Waypoint Walk. Each generation is a fresh, randomised reinterpretation — not a
reproduction of the original fixed notebook sequence.

## Language

**Walk**:
A single generated route — an ordered run of waypoints joined by orthogonal segments,
produced by one generation. Randomised each time; there is no canonical walk.
_Avoid_: route

**Map**:
The rendered drawing of a walk on the canvas (grid, segments, waypoints, labels, legend) —
the visual artifact, as distinct from the abstract Walk.
_Avoid_: diagram, drawing

**Waypoint**:
A numbered point on the walk where the walker may turn. Rendered as a circle showing its
sequence number.
_Avoid_: node, point, stop

**Turn Sequence**:
The ordered list of Left/Right values that defines a walk's shape. Randomised per generation.
_Avoid_: pattern, instructions

**Heading**:
The walker's current compass direction of travel (North/East/South/West). Begins North.
_Avoid_: orientation, bearing, facing

**Turn**:
A 90° change of heading at a waypoint. Left = counter-clockwise, Right = clockwise.

**Outbound turn**:
The turn a waypoint records and labels — the turn applied when *leaving* it toward the next
waypoint, not the turn used to arrive. The first and last waypoints have none.
_Avoid_: inbound turn (arrival turns are never labelled)

**Segment**:
The single straight, orthogonal line between two consecutive waypoints. Always purely
horizontal or vertical.
_Avoid_: edge, leg, link

**Wildcard**:
A waypoint whose turn is skipped — the walker continues straight through instead of turning.
Marked with an orange ring.
_Avoid_: skip, joker
