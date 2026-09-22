# Audit detail

`/audits/:id`. Progress while open; the finalize screen once closed.

- **Header** names the audit, its kind and status. `manage_audits` sees
  *Close early* while open and *Finalize* while closed.
- **Finalize is enabled** only when every proposal has a decision and, if any
  approved proposal is structural, the user also holds `manage_locations`.
  The disabled button's tooltip says which.
- **Proposals table** (closed and finalized audits): one row per proposal with
  a checkbox, kind badge (structural ones amber), the location, a description
  of the change, who recorded it, and either its decision or Approve / Reject
  with a reason field. Rejecting needs a reason. *Approve checked* / *Reject
  checked* act on the checkboxes. Rows the user may not decide are dimmed
  and say "needs manage_locations". Decisions save one at a time and can be
  undone until finalize.
- **Locations** list, filterable by state, each row a link to its Finding
  while the audit is open or once a Finding exists. Not-audited rows show the
  reason. Displaced notes show as badges.
- *+ propose a new location* while open.
