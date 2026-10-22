// Copy for src/layout/ (the shell around every screen), src/routes/nav.ts,
// the More page, and the screens shown before the app opens (AuthedApp).
export const layout = {
  /** Section names, by NavSection key. */
  nav: {
    home: "Home",
    checklists: "Checklists",
    locations: "Locations",
    audits: "Audits",
    comms: "Comms",
    tickets: "Tickets",
    incidents: "Incidents",
    reservations: "Reservations",
    boats: "Boats & Vehicles",
    contacts: "Owners & Contacts",
    assets: "Assets",
    activity: "Activity Log",
    reports: "Reports",
    admin: "Admin",
  },
  /**
   * The same sections on the phone's tab bar, where there is room for one
   * short word. Its own key, not the nav label cut at a space: a translation
   * is not obliged to put the important word first.
   */
  tab: {
    home: "Home",
    checklists: "Checklists",
    locations: "Locations",
    audits: "Audits",
    comms: "Comms",
    tickets: "Tickets",
    incidents: "Incidents",
    reservations: "Reservations",
    boats: "Boats",
    contacts: "Owners",
    assets: "Assets",
    activity: "Activity",
    reports: "Reports",
    admin: "Admin",
    other: "Other",
  },
  more: "More",
  appearance: "Appearance",
  switchUser: "Switch user",
  signOut: "Sign out",
  installApp: "Install app",
  loading: "Loading…",
  theme: {
    label: "Theme",
    light: "Light",
    system: "System",
    dark: "Dark",
  },
  update: {
    button: "Update",
    title: "A new version is ready",
  },
  nfc: {
    button: "NFC",
    buttonActive: "NFC ●",
    scanning: "Scanning for checkpoint NFC tags — tap to stop",
    idle: "Tap to scan checkpoint NFC tags without leaving the app",
  },
  /** The save indicator (src/lib/saveState.ts decides which). */
  save: {
    sent: "✓ All changes sent",
    waiting_one: "{{count}} change saved here",
    waiting_other: "{{count}} changes saved here",
    waitingDetail: "Will send when there's a connection.",
    sending_one: "Sending {{count}} change…",
    sending_other: "Sending {{count}} changes…",
    stuck_one: "{{count}} change not sending",
    stuck_other: "{{count}} changes not sending",
    stuckDetail: "Connected, but nothing is getting through.",
    rejected_one: "{{count}} change rejected by the office",
    rejected_other: "{{count}} changes rejected by the office",
    tapForDetails: "Tap for details",
    explain: {
      sent: "Everything done on this device has reached the office.",
      waiting:
        "Your work is saved on this device and will send by itself when there's a connection. Nothing is lost by waiting.",
      sending: "Saved on this device; sending to the office now.",
      stuck:
        "Your work is saved on this device, but it isn't reaching the office. Keep the app installed and signed in, and show this to whoever maintains it:",
      rejected:
        "The office refused these changes for good, so they were not saved there. Anything listed here may need doing again.",
    },
    dismiss: "Dismiss",
  },
  error: {
    title: "Something went wrong",
    body: "This screen failed to load. Reloading may clear it; if it keeps happening, send this message to whoever maintains the app.",
    reload: "Reload",
  },
  /** Before the app opens: no user row yet, so the device's language. */
  access: {
    cantSignIn: "Unable to sign in",
    cantCheckIn: "Unable to check in",
    cantSignInBody: "This account can’t access this marina. Check with a manager if you believe this is an error.",
    cantCheckInBody:
      "This account can’t access this marina, so the check-in wasn’t recorded. Check with a manager.",
    backToSignIn: "Back to sign in",
    firstSyncTitle: "Setting up this device",
    firstSyncBody:
      "This device hasn’t downloaded the marina’s data yet, and there’s no connection right now. Move somewhere with signal or Wi-Fi and it will finish on its own — after that the app works offline.",
    syncConfigTitle: "Can’t reach the marina database",
    syncConfigBody:
      "You signed in, but the marina’s database turned the connection away, so nothing can load. More signal will not help — this is a setup problem with the app. Send this message to whoever maintains it:",
  },
};
