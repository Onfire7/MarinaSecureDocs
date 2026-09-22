# Admin — Services & Amenities

`/admin/services`. `manage_locations`.

- Two catalogues. A Service has a name and an optional unit; an Amenity a
  name. Names edit in place on blur.
- Under each entry, one chip per Location Type; a highlighted chip means the
  entry is valid for that type. Tapping toggles it.
- Delete asks for confirmation. Deleting an entry removes it from every
  location (cascade).
- Presence per location is edited on the location's page
  (`LocationServicesPanel`) or by an approved audit, never here.
