// Sentences and names the app *stores*, written through dataT in the
// marina's language, never the reader's (docs/localization.md). Only those
// live here, so `t("records:…")` in a page is wrong on sight. Every {{value}}
// is data; a translation must keep them all (catalogs.test.ts).
//
// Areas converted before this namespace existed still keep theirs in their
// own namespace (tickets:activity.*, home:fleetActivity.*), and move here as
// each area converts.
export const records = {
  /** activity_log_entries.summary for a new note. */
  noteAdded: "Note added on {{target}}",
  /** map_anchors.label for a free point left unnamed. */
  calibrationPoint: "Calibration point",
};
