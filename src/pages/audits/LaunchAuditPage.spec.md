# Launch audit

`/audits/new?template=<id>`. `manage_audits` only.

- Choosing a template seeds kind, name (template name and today's date) and
  the rule tree. The tree is shown in the same editor as the template page
  and may be edited; edits are copied onto the audit. *Save rules back to
  template* is the only way an edit reaches the template.
- Kind is locked while a template is chosen.
- Assignees are any mix of roles and users, as chips.
- The target count in the section title and on the button is the live
  resolution of the tree; launching writes that fixed list.
- Launch is enabled with a name, at least one target and at least one
  assignee. On success the page replaces itself with the audit's detail.
