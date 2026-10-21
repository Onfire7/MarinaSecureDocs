// Copy for src/pages/incidents/. Incident Detail so far; the list and the
// New Incident form convert in their own commit (docs/TODO.md
// § Localization).
export const incidents = {
  detail: {
    nothingToSee: "Nothing to see here",
    loading: "Loading…",
    byline: "{{author}} · {{when}}",
    bylineTyped: "{{type}} · {{author}} · {{when}}",
    edit: "Edit",
    raiseTicket: "Raise a ticket",
    status: "Status",
    assignedTo: "Assigned to",
    unassigned: "Unassigned",
    assignPlaceholder: "Assign…",
    attachedTo: "Attached to",
    noDetails: "No further details recorded.",
    linkedTickets: "Linked tickets",
    timeline: "Timeline",
    noTimeline: "Nothing yet.",
    addendumPlaceholder: "Add an addendum — permanent, append-only",
    addAddendum: "Add addendum",
    editTitle: "Title",
    editDetails: "Details (markdown)",
    save: "Save",
    cancel: "Cancel",
    editHint: "Editable only by you, and only until your shift ends — addenda stay open afterward.",
  },
  /** What an Incident Update says, from describeUpdate()'s key and values. */
  timeline: {
    created: "Created by {{name}}",
    createdVia: "Created by {{name}} from {{origin}}",
    status: "Status {{from}} → {{to}}",
    priority: "Priority {{from}} → {{to}}",
    assignee: "Assigned to {{to}}",
    comment: "{{body}}",
    unknown: "{{kind}}",
    by: "{{name}} · {{when}}",
    addendum: "Addendum",
  },
  /** Written into the database: through dataT. */
  ticketTitle: "Incident: {{title}}",
  activity: {
    created: "Incident “{{title}}” logged on {{target}}",
    status: "“{{title}}” set to {{status}}",
    assigned: "“{{title}}” assigned to {{name}}",
    commented: "Addendum added to “{{title}}”",
    edited: "“{{title}}” edited by its author",
  },
};
