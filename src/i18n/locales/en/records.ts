// Sentences and names the app *stores*, written through dataT in the
// marina's language, never the reader's (docs/localization.md). Only those
// live here, so `t("records:…")` in a page is wrong on sight. Every {{value}}
// is data; a translation must keep them all (catalogs.test.ts).
//
// Areas converted before this namespace existed still keep theirs in their
// own namespace (tickets:activity.*, incidents), and move here as each area
// converts.
export const records = {
  /** activity_log_entries.summary for a new note. */
  noteAdded: "Note added on {{target}}",
  /** map_anchors.label for a free point left unnamed. */
  calibrationPoint: "Calibration point",
  /** src/data/shifts.ts. */
  shiftStarted: "Shift started by {{name}}",
  shiftEnded: "Shift ended by {{name}}",
  /** A checklist's creation, by InstanceReason kind (src/data/checklistReason.ts). */
  checklistCreated: {
    clockIn: "{{template}} created by clock-in",
    clockOut: "{{template}} created by clock-out",
    schedule: "{{template}} created by its recurring schedule",
    manual: "{{template}} created by {{name}} starting it manually",
    manualUnknown: "{{template}} created by a user starting it manually",
    locationCheck: "{{template}} created by a location check on {{label}}",
  },
  /** The Fleet card's Activity Log lines (src/data/fleet.ts, assetTriggers.ts). */
  fleet: {
    checkedOut: "{{vehicle}} checked out to {{person}}",
    returned: "{{vehicle}} returned",
    returnedWithNote: "{{vehicle}} returned: {{note}}",
    kept: "{{vehicle}} kept past End of Shift: {{reason}}",
    status: "{{vehicle}} status check: fuel {{fuel}}",
    statusWithOdometer: "{{vehicle}} status check: {{odometer}}, fuel {{fuel}}",
    statusWithdrawn: "{{vehicle}} status check withdrawn",
    checkoutUndone: "{{vehicle}} checkout undone",
    checkinUndone: "{{vehicle}} check-in undone",
    createdByCheckOut: "{{template}} created by {{vehicle}} being checked out",
    createdByCheckIn: "{{template}} created by {{vehicle}} being checked in",
    filled: "{{vehicle}} filled with {{gallons}} gal",
    added: "{{vehicle}} added to the fleet",
    removed: "{{vehicle}} removed from the fleet",
    /** asset_status_logs.note when a returned vehicle takes its post-return status. */
    returnedNote: "Returned from checkout",
  },
};
