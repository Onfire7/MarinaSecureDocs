# Rule tree editor

Shared by the template page and the launch page. The decisions it embodies
are recorded in `docs/audits.md` § The template editor; this file lists the
commitments in code terms.

- One model (`DraftRule[]`), two layouts by `useIsMobile()`: Outline (nested
  cards, sticky preview column) and Drill-down (one rule per screen behind a
  breadcrumb that collapses its middle past three levels).
- A condition row is Subject · Verb · Value; the verb list depends on the
  subject; negation is a verb. Rows after the first begin with the and/or
  toggle. An incomplete condition is inert: it changes no count and does not
  appear in the rule's description, with no label saying so.
- Location values use `LocationPicker` over the marina's containers.
- Every rule has a palette colour in tree order: a dot beside its description,
  a coloured left edge, and a dot on each preview row it selected (root rules
  only when there is more than one root).
- Desktop only: hovering a card dims preview rows it did not select, with a
  caption; hovering a preview dot rings that rule's card and dims other
  branches, keeping the card's ancestors lit.
- Counts always read "n of parent".
- A rule's Questions are Yes/No (with an optional *raise a Ticket on No*),
  Choice, Text, or Meter reading. A Choice question's options are an
  add/remove list (`ChoiceOptionsEditor`) — one row per option, an input to
  add another — not a single comma-separated field, so an option that
  itself contains a comma still has somewhere to go.
