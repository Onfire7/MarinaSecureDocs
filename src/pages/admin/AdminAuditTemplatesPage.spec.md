# Admin — Audit Templates

`/admin/audit-templates` (list, create) and `/admin/audit-templates/:id`
(editor). `manage_audits`.

- Create needs a name and a kind; the kind cannot be changed afterwards.
- The editor holds edits locally until *Save rules*; the button reads *Saved*
  when nothing is pending. The name saves on blur.
- Saving replaces the template's whole rule tree.
- Delete asks for confirmation and notes that launched audits keep their copy.
