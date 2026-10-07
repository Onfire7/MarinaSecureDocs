# Locations

`/locations`. The landing point of the Locations nav item: find a location
and go to it. Defining the hierarchy, uploading and plotting maps is
`/admin/locations` (`manage_locations`); this page only reads, apart from
the status quick-edit below. Folded in from `docs/pages/location-list.html`
on 2026-10-07.

## Views

Three presentations of one filtered set (type and status filters, client
side, applied to all three):

- **Map** - the marina's map, **the landing view whenever the marina has
  one** (owner, 2026-10-07; before, the list was). Interactive and
  read-only: pinch or wheel to zoom, one finger pans once zoomed in
  (`ZoomableMap`), the *Anchors* / *Labels* switches show either, both or
  neither (`docs/maps.md`; the setting is shared with every other map and
  remembered on the device). Each location is its label and/or its anchor,
  coloured by status. **Tapping one selects it** - a card under the map
  gives its name, type and status with *Open* - and tapping the selected
  one again opens it. A ▸ on a label drills into that location's own map;
  with several properties the map opens on a chooser. The device appears as
  a blue dot where the map's fit can place it, grey outside the calibrated
  area. A location not on the map is not on it; it is in the list.
- **List** - the hierarchy. A phone drills level by level; a desktop shows
  the indented tree. Filtering flattens it. A user with `manage_locations`
  changes a status inline.
- **Pin Map** - each location with GPS coordinates plotted relative to the
  others, no image. A location without coordinates is omitted.

With no map uploaded the Map view is not offered and the list is the
landing view.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Open a location | none | Navigates to the location's page, from a list row, a pin, or the map's card. |
| Change a status | `manage_locations` | Inline from the list. |
| Add a location | `manage_locations` | Shortcut into Admin, where creation happens. |

## States

- **No locations defined** - an empty state that prompts into Admin for a
  user with `manage_locations`, otherwise says nothing is here yet.
- **No map** - see above.
- **Retired locations** are not listed and not on the map.
