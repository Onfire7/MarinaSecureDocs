# Maps: anchors, labels, and where the device is

How a marina map - a drawing, not a projection - knows where a location is,
where its label goes, and where the person holding the phone is. Settled
with the owner on 2026-10-04. Vocabulary is in `CONTEXT.md`; the pure model
is `src/lib/mapFit.ts` and `src/lib/locations.ts` (`PlacementShape`); the
hooks are `src/data/maps.ts`; the editor is `src/pages/shared/MapLabelEditor.tsx`.

## Anchors and labels are two tables

- **`map_anchors`** is the fit. One row per (map, location), or a **free
  calibration point** with no location - a dock corner, a gate - so a map
  can be calibrated where nothing is plotted (owner, 2026-10-05). Each
  carries `cx, cy` in percent of the image and the `lat, lng` it stands
  for. A located anchor's coordinates mirror the location's and are kept
  in step by trigger in both directions.
- **`map_labels`** is decoration. One row per (map, location): the label's
  own centre, rotation and size. Its coordinates are its own: moving the
  anchor leaves the label where it was.
- `PlacementShape` is gone; `MapPoint` is an anchor, `LabelShape` a label,
  `MapPlacement` the pair a Proposal carries. `placementStyle()` draws a
  label; the editor draws the tether between the two.
- The old one-blob `location_map_placements` migrated on 2026-10-05: its
  anchor became a `map_anchors` row with the location's coordinates, its
  label a `map_labels` row at anchor + offset. A `move_placement` Proposal
  made before then still applies: `apply_map_placement()` reads either
  payload shape, as does `placementFromPayload()` on the client.

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
location's label and, where it stands apart from the label, its anchor
dot, asks *Is it placed correctly on the map?*
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

- **Control points** are every anchor on the map that carries coordinates
  (`controlPointsFor`): a located anchor with its location's pin, a free
  calibration point with its own, and - **provisionally** - an anchor an
  open audit has proposed and nobody has decided on yet, paired with the
  fix captured beside it or the location's saved pin
  (`useProvisionalAnchors`). Provisional points count now, so the dot
  improves during the walk rather than after approval (owner, 2026-10-05),
  and the admin fit card names them as provisional. A provisional anchor
  for a location supersedes its saved one. Every audit that captures a fix
  and taps the map adds a point; the admin plotter adds free ones.
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
- **The device's position** comes from one app-wide watch
  (`src/pages/shared/devicePosition.ts`), started when the signed-in app
  mounts and paused while the tab is hidden, so every map, the GPS capture
  and the nearest-first lists read the same fix and none of them waits
  for a first fix of its own (owner, 2026-10-05). A checkpoint check-in
  still takes its own fresh reading, since that one is a record.
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

## Outlines

A location's drawing on a map may be a traced **outline** as well as, or
instead of, its text label (owner, 2026-10-07) - for a map image that is
already labelled, where a second label only clutters. It is two columns on
`map_labels`: `outline`, a jsonb list of three or more `[x, y]` corners in
percent of the image (`valid_map_outline()` checks it), and `show_text`,
off only when there is an outline to draw instead (a check keeps every row
drawing something). Outlines are drawn by one SVG layer per map
(`MapOutlines`) under the labels and dots: a see-through fill in the
location's status colour wherever the map colours by status (the Locations
map), the accent on the plotter, muted for everything but the location in
hand on a preview; the edge stays one width at any zoom, and tapping inside
does what tapping the label does. The Labels switch shows or hides outlines
with the text.

In the editor the **Outline** tool traces one: tap each corner, drag a
corner to move it, *Undo corner*, *Clear*, and *Show name* to keep or drop
the text (only with three corners or more). `lib/outline.ts` cleans what was
traced - clamped, repeated corners dropped, no shape with no area - and
finds a point inside it for the label's position when the text is off; a
location traced but never anchored is anchored there. An outline rides in a
`move_placement` Proposal's label; `apply_map_placement()` sets it when the
payload names it and otherwise leaves the one that is there, so an older
Proposal cannot erase it.

## What a map shows

Every map carries two independent switches, **Anchors** and **Labels**
(owner, 2026-10-07; the day before they were one three-way choice), one
setting for the whole app, remembered on the device (`pages/shared/
mapShow.ts`, parsed by `lib/mapShow.ts`, which still reads the three words
the first version stored). Labels alone is the map as it reads; anchors
alone draws a dot for every located anchor, tappable where the map is; both
draws a located anchor only where it stands apart from its label, so a
label on its anchor is not marked twice; neither shows the bare image and
the device. Free calibration points belong to the anchors switch.

Maps zoom in place wherever they appear (`ZoomableMap`), and the Locations
page opens on the map when the marina has one.

## Limits

Consumer GPS is five to ten metres on a good day and worse among trees and
hulls, so the dot wanders by a slip or two whatever the fit. The fit cannot
repair a map that is topologically wrong (two docks drawn in the wrong
order). Replacing a map image with a different crop invalidates every
placement on it, anchors included, which was already true.
