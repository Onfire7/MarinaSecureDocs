// Copy for src/pages/home/. Only the end of a shift and the fleet records it
// writes so far; the rest of the area converts in its own commit
// (docs/TODO.md § Localization).
export const home = {
  endOfShift: {
    /** The Shift card's button, by next step (DashboardPage.spec.md § The Shift card). */
    finish: "Finish {{name}}",
    checklistStep: "End of Shift Checklist",
    reportStep: "End of Shift Report",
    /** The review at /shift/end. */
    title: "End of Shift",
    notOnShift: "You're not on shift",
    backToDashboard: "Back to the dashboard",
    startedHours: "Started {{time}} · {{hours}}h {{minutes}}m so far",
    startedMinutes: "Started {{time}} · {{minutes}}m so far",
    openChecklists_one: "{{count}} checklist is still open",
    openChecklists_other: "{{count}} checklists are still open",
    openWarning_one: "Anything recorded on it won't be saved unless it's submitted.",
    openWarning_other: "Anything recorded on them won't be saved unless they're submitted.",
    endShiftAndSubmit: "End Shift and Submit",
    ending: "Ending…",
    couldntEnd: "Couldn't end the shift.",
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
