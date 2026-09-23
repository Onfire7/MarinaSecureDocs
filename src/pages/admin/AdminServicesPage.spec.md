# Admin — Attributes, Services & Amenities

`/admin/services`. `manage_locations`.

- Three catalogues, Attributes first. A Service has a name and an optional unit; an Amenity a
  name; an Attribute a name and a **kind** — `number`, which has the optional
  unit, or `choice`, which has an option list edited by the same
  `ChoiceOptionsEditor` an Audit Question's Choice kind uses. Names and units
  edit in place on blur; changing the kind hides the field the other kind
  owns without erasing it.
- Under each entry, one chip per Location Type; a highlighted chip means the
  entry is valid for that type. Tapping toggles it.
- Delete asks for confirmation. Deleting an entry removes it from every
  location (cascade).
- Presence (Services, Amenities) and value (Attributes) per location are
  edited on the location's page (`LocationServicesPanel`) or by an approved
  audit, never here. An Attribute is never present or absent — it applies
  to every location of a valid type — only its value is optional, and once
  an audit exists for the location, every value change (including
  clearing one) is a Proposal, with no "apply directly" path.
