# Admin — Services, Amenities & Attributes

`/admin/services`. `manage_locations`.

- Three catalogues. A Service or Attribute has a name and an optional unit;
  an Amenity a name. Names and units edit in place on blur.
- Under each entry, one chip per Location Type; a highlighted chip means the
  entry is valid for that type. Tapping toggles it.
- Delete asks for confirmation. Deleting an entry removes it from every
  location (cascade).
- Presence and value per location are edited on the location's page
  (`LocationServicesPanel`) or by an approved audit, never here. An
  Attribute's value has no "apply directly" path once an audit exists for
  the location — every audit-driven change to it, presence or value, is a
  Proposal.
