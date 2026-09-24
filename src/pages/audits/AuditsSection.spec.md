# Audits section

The card that lists the current user's pending audit targets. Mounted above
the active checklist (`ChecklistRoute`), at the top of the Checklists page,
on a checkpoint scan filtered to that checkpoint's location subtree, and in
full on the Audits page.

- Shows targets of **open** audits assigned to this user or one of their
  roles; a holder of `manage_audits` sees every open audit's targets.
- **Never gates.** It reports a count; the checklist beneath completes
  regardless.
- **Collapsed** to its header when more than five targets remain (never on the
  Audits page). Tapping the header toggles.
- **Ordered** by distance from the device when both have coordinates, then
  unlocated targets in tree order.
- When a target leaves the list, the card scrolls itself to the top so the next
  target is at the top of the screen.
- A target carrying a **displaced note** ("Expected X, found at Y") shows it as
  a warning badge.
- **Start the wizard** appears when every pending target belongs to one
  audit - the common case in the field, and the only one where a single
  button is unambiguous (docs/audits.md § The wizard).
- Renders nothing when there is nothing to audit, except on the Audits page,
  where it says so.
