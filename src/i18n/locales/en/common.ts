// Copy shared across areas (docs/localization.md § Catalogs).
export const common = {
  /** This language's name for itself, as the language picker lists it. */
  languageName: "English",
  language: "Language",
  deviceDefault: "Device default",

  // Actions and fallbacks every area uses.
  cancel: "Cancel",
  close: "Close",
  done: "Done",
  ok: "OK",
  clear: "Clear",
  retry: "Retry",
  remove: "Remove",
  save: "Save",
  add: "Add",
  none: "None",
  all: "All",
  back: "← Back",
  noMatches: "No matches",
  search: "Search…",
  select: "Select…",

  /** An elapsed time (src/i18n/format.ts duration). */
  duration: {
    hm: "{{h}}h {{m}}m",
    m: "{{m}}m",
  },

  /** ticket_priority, by stored value. */
  priority: {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
  },
};
