# Maps: anchors, labels, and where the device is

How a marina map - a drawing, not a projection - knows where a location is,
where its label goes, and where the person holding the phone is. Settled
with the owner on 2026-10-04. Vocabulary is in `CONTEXT.md`; the pure model
is `src/lib/mapFit.ts` and `src/lib/locations.ts` (`PlacementShape`); the
hooks are `src/data/maps.ts`; the editor is `src/pages/shared/MapLabelEditor.tsx`.

## A placement is an anchor and a label

`location_map_placements.placement` is `{cx, cy, dx?, dy?, rotation,
fontSize?, paddingX?, paddingY?}`, all in percent of the map image except
the pixel sizes.

- **The anchor** `cx, cy` is where the location *is*. It is the point a GPS
  fix is tied to, and the point every fit below is built from.
- **The label** is drawn at `cx + dx, cy + dy`. The offset lets a label sit
  beside a slip rather than on top of it, and a whole dock's labels share
  one offset. A placement without `dx, dy` draws its label on the anchor -
  which is every placement made before 2026-10-04, so nothing migrated.
- `labelCentre()` and `placementStyle()` in `lib/locations.ts` are the only
  places that do the addition. Every viewer and the editor use them.

## How a location gets anchored

In an audit, **after** a GPS fix is captured (`GpsCapture`), the map opens
fullscreen in *anchor* mode: zoom in, tap where you are standing. The tap
explicitly ties the coordinates just captured to the map. The anchor rides
on the GPS answer (`GpsAnswer.anchor`) and the data layer writes it as a
`move_placement` Proposal beside the `set_gps` one: the location's existing
placement re-anchored with its label offset and style kept, or a new
placement in the remembered label style. Cancelling keeps the fix and ties
nothing. GPS is asked before the map for this reason - the map page then
has a label to ask about.

The *map* page (and the Finding form's map card) shows the map with the
location's anchor dot and label, asks *Is it placed correctly on the map?*
under it only when there is a placement, and opens the editor in *label*
mode on No, on a tap, or on *Place it on the map*.

## The editor

`MapLabelEditor` is the one way to put a location on a map: the wizard's
GPS and map pages, the Finding form and the admin plotter all open it.
Pinch or wheel zooms, one finger pans, the label drags, the anchor dot
drags. In label mode the bar is one icon per setting - *Label* (drag or tap
to put the label somewhere, which sets the offset), *Anchor* (move the
dot), *Size*, *Width*, *Height*, *Angle* - and tapping one shows its slider
alone, with the label brought into the top third of the screen so the
slider's effect is visible while the thumb is on it. Done keeps the draft
and remembers its style **including the offset** on this device
(`lib/mapLabelStyle.ts`, local storage - the owner chose this over a marina
setting); the next label placed starts in that style. A new placement for
a location whose anchor was just tapped starts on that anchor, saved or
not.

## Where the device is: the piecewise fit

The owner's requirement (2026-10-04): it must not work on our map and fail
quietly on another customer's. A marina map may be drawn with a dock too
long or a loop road too tight, so a single affine fit would be right on
average and wrong at the end of the long dock, and nobody would know.

- **Control points** are every placement on the map whose location is
  pinned: anchor `cx, cy` paired with `gps_lat, gps_lng`
  (`controlPointsFor`). Every audit that captures a fix and taps the map
  adds one. There is no separate calibration table; if empty corners ever
  need points of their own, add them as locations.
- **The fit** (`buildMapFit`) projects the points to local metres,
  triangulates them (Bowyer-Watson, no dependency), and maps inside each
  triangle by barycentric weights, both directions. Each region keeps its
  own scale and rotation. Outside the hull the nearest triangle
  extrapolates and the result says `inside: false`. Points closer than
  half a metre or a fifth of a percent are merged.
- **No fit** - fewer than three usable points, or three in a line - is
  null, never a guess.
- **Quality** is leave-one-out (`residuals()`): drop each point, rebuild,
  measure the error at it in metres. A dropped hull point cannot be
  interpolated by the rest, and a straight-line extrapolation through one
  wrong neighbour inherits that neighbour's whole error, so such a point is
  predicted by the reduced set's affine fit instead. A wrong pin is then
  the largest residual and names itself; the admin plotter lists them,
  worst first.
- **The dot** (`DeviceDot`) is drawn through the fit on every map view: the
  wizard's map page and editor, the Finding form's card, the location list
  map, the admin plotter. Blue with its accuracy ellipse inside the
  calibrated area; grey and labelled outside it; absent when there is no
  fit or no fix - a dot that might be anywhere is worse than none. The
  ellipse is a circle of the reported accuracy pushed through the fit and
  boxed, so a map whose axes do not share a scale is shown honestly.

`src/lib/mapFit.test.ts` is the spec: synthetic maps drawn by functions
that stand in for the artist's hand, including one whose left half is at
twice the scale of the right, where the piecewise fit is right and the
single affine is shown to be wrong.

## Limits

Consumer GPS is five to ten metres on a good day and worse among trees and
hulls, so the dot wanders by a slip or two whatever the fit. The fit cannot
repair a map that is topologically wrong (two docks drawn in the wrong
order). Replacing a map image with a different crop invalidates every
placement on it, anchors included, which was already true.
