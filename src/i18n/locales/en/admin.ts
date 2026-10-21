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
  },
};
