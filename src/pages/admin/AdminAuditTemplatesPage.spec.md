# Admin — Audit Templates

`/admin/audit-templates` (list, create) and `/admin/audit-templates/:id`
(editor). `manage_audits`.

- Create needs a name and a kind; the kind cannot be changed afterwards.
- For a Status-kind template, the five category checkboxes (Attributes,
  Services, Amenities, Clearly marked?, Placed on the map?) save
  immediately on click, one column at a time — never the whole row, so two
  quick clicks can't race and clobber each other. Hidden for an
  Occupancy-kind template, whose built-ins aren't split into categories.
- The rule tree holds edits locally until *Save rules*; the button reads
  *Saved* when nothing is pending. The name saves on blur.
- Saving the rules replaces the template's whole rule tree.
- Delete asks for confirmation and notes that launched audits keep their copy.
