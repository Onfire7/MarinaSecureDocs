// Copy for src/pages/home/. Only the End of Shift vehicle step and the fleet
// records it writes so far; the rest of the area converts in its own commit
// (docs/TODO.md § Localization).
export const home = {
  endOfShift: {
    beforeYouGo: "Before you go",
    stillHave: "You still have {{name}}.",
    checkItIn: "Check it in",
    keepIt: "Keep it past my shift",
    whyKeep: "Why are you keeping it? — required",
    keepAndContinue: "Keep it and continue",
    cancel: "Cancel",
  },
  /** Activity Log summaries: written into the database, through dataT. */
  fleetActivity: {
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
  },
};
