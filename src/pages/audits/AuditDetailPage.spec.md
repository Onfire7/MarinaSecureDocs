# Audit detail

`/audits/:id`. Progress while open; the finalize screen once closed.

- **Header** names the audit, its kind and status. While the audit is open
  everyone who can see it gets **Wizard** (`/audits/:id/wizard`);
  `manage_audits` also sees the close button, and *Reopen* and *Finalize*
  once closed.
- **The close button reads *Close early*** while any Location is still to
  visit, and warns that those Locations are marked Not Audited. With
  nothing pending it reads **Close audit**, because there is nothing early
  about it - which is the normal way an audit reopened after it auto-closed
  gets closed again.
- **Reopen** puts a closed audit back to Open and returns the locations the
  close pushed out of the queue — those marked Not Audited *"closed early"*
  and no others; a location skipped for its own reason keeps its reason, and
  locations already signed off stay signed off. A reopened audit **never
  closes itself again**: Close early becomes the only way it closes, or the
  auto-close would shut it the moment the next answer landed. It is refused
  on a finalized audit, whose proposals have already been applied. Confirms
  first — it changes a record other people read.
- **Finalize is enabled** only when every proposal has a decision and, if any
  approved proposal is structural, the user also holds `manage_locations`.
  The disabled button's tooltip says which.
- **Unanswered pills** under the summary counts: one per category the audit
  asks about that has an unanswered item on an audited location — Services,
  Amenities, Attributes, Questions, GPS, Marked, Map — each with the number
  of audited locations it is unanswered on (docs/audits.md § Confirming an
  Audit is complete). Tapping one filters the Locations list to those rows
  and highlights the pill; tapping again clears it. With nothing
  outstanding the row reads "Every category answered on every audited
  location.", or "Nothing audited yet." — an empty row would be
  indistinguishable from a page that hasn't loaded.
- **Proposals table** (closed and finalized audits): one row per proposal with
  a checkbox, kind badge (structural ones amber), the location, a description
  of the change, who recorded it, and either its decision or Approve / Reject
  with a reason field.
- **Grouped by what a decision would mean**, undecided first, in this order:
  *Fills a blank* (nothing is on file - the group is **pre-ticked**, so
  clearing it is one press of *Approve checked*), *Changes a value*,
  *Removes something*, *Structural*. Each heading carries its count. An
  audit of any size produces a pile of the first kind and a handful of the
  rest; undivided, the handful is what gets lost. New audits make few of
  these - a first value now applies at once (docs/audits.md § Filling a
  blank is not a decision) - but audits recorded before that change still
  carry theirs, and this is how they get cleared.
- A row applied automatically reads **applied · nothing was on file**
  rather than naming an approver, because nobody approved it. Rejecting needs a reason. *Approve checked* / *Reject
  checked* act on the checkboxes. Rows the user may not decide are dimmed
  and say "needs manage_locations". Decisions save one at a time and can be
  undone until finalize.
- **Locations** list, filterable by state, each row a link to its Finding
  while the audit is open or once a Finding exists. Not-audited rows show the
  reason. Displaced notes show as badges. An audited row that is missing
  something names the categories: "no answer for services, map".
- *+ propose a new location* while open.
- **Report and sharing**, on every audit. *View report* opens
  `/audits/:id/report`. `manage_audits` also sees **Share**: a label, an
  expiry (90 days, or never) and *What this link shows* make a link, and
  the URL is copied on creation.
  - **What this link shows** is collapsed by default and reads "everything"
    until touched. Open, it lists every category the audit asked about with
    its entries beneath - Services with each Service, Questions with each
    prompt - each a checkbox, all ticked; and a Locations section, by area,
    ticked the same way. Unticking is the filter, and it is applied in the
    database, not on the page (`docs/audits.md` § A link can show less). A
    link's row then says what it leaves out ("hides GPS, Sewer · 24 of 76
    locations"), because a list of links that all look alike is a way to
    send the wrong one.
  Below it, every link the audit has - label, created, expires, views, last
  viewed - each with *Copy link* and *Revoke*; a revoked or expired one is
  shown struck through and stays listed. Spec: `docs/audits.md` § Sharing
  the results.
