// Copy for src/pages/admin/.
export const admin = {
  marinaSettings: {
    language: "Language",
    languageHint:
      "The language MarinaSecure writes into this marina's records — Activity Log entries, automatically raised tickets, default names. Each person chooses their own language for the app itself.",
  },
  /** Only what the Fleet Vehicle Item added so far; the page converts later. */
  checklistTemplates: {
    trigger: { asset: "Asset Check Out/In" },
    sectionTrigger: { check_out: "Asset checked out", check_in: "Asset checked in" },
    assetTemplateHint:
      "Triggered when an asset named on one of this template's sections is checked out or in — attach assets there. The checklist goes to whoever holds the asset.",
    assetSectionHint: {
      check_out:
        "Created when one of its assets is checked out, for whoever takes it: added to their open checklist from this template, if they have one.",
      check_in:
        "Created when one of its assets is checked in, for whoever had it: added to their open checklist from this template, if they have one.",
    },
    fleetMode: "Mode",
    /** The End Shift rules (AdminChecklistTemplatesPage.spec.md § End Shift Items). */
    endShiftBlocked: {
      alreadyHas: "This template already ends with an End Shift item.",
      clockOut: "A Clock Out checklist already leads to the end of the shift.",
      notLastSection: "End Shift goes in the template's last section.",
      sectionOff: "This section is switched off, so End Shift would never appear.",
      notAlways:
        "End Shift needs a section made with the checklist (Always). This one is created later, so it might never exist.",
    },
    endShiftUnavailable: "{{type}} (last section, made with the checklist)",
    clockOutBlocked: {
      hasEndShift:
        "This template has an End Shift item. Remove it before making this a Clock Out checklist.",
    },
    /** Copy a section to locations (AdminChecklistTemplatesPage.spec.md § Copy a section to locations). */
    copy: {
      action: "Copy to locations…",
      title: "Copy “{{name}}” to locations",
      under: "Under",
      anywhere: "Anywhere",
      type: "Type",
      anyType: "Any type",
      locations: "Locations",
      selectAll: "Select all",
      clear: "Clear",
      alreadyHere: "already in this template",
      noCandidates: "No locations match.",
      tooMany: "{{count}} locations match. Narrow the list with a parent or a type.",
      checkpoints: "Checkpoints",
      cpAll: "Attach every checkpoint at the location",
      cpCreate: "Create matching checkpoints",
      cpCreateHint:
        "One for each checkpoint on this section, named for its location, with a new tag to write.",
      cpCreateDisabled: "This section has no checkpoints to match.",
      cpNone: "None",
      submit_one: "Add {{count}} section",
      submit_other: "Add {{count}} sections",
      cancel: "Cancel",
    },
  },
};
