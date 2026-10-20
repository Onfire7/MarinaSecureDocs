// PROTOTYPE — throwaway. One realistic Shift Report document, hand-written,
// so the variants can be judged at real density without a database. The
// shape is a first sketch of the snapshot the real End Shift will store.

export type Mark = "ok" | "missed" | "exception";

export interface RecordItem {
  id: string;
  kind: "checkin" | "simple" | "door" | "lock" | "verify" | "meter" | "end_shift";
  label: string;
  /** The checklist it came from; check-ins name the checklist that expected them. */
  source: string;
  time?: string;
  expected?: string;
  found?: string;
  left?: string;
  result?: string;
  note?: string;
  mark: Mark;
  /** Why it is an exception, in words — the same line as in Needs attention. */
  why?: string;
}

export interface LocationNode {
  id: string;
  name: string;
  depth: number;
  items: RecordItem[];
}

export interface Update {
  at: string;
  by: string;
  kind: "addendum" | "status" | "assignee" | "priority" | "comment";
  from?: string;
  to?: string;
  text?: string;
}

export interface Incident {
  id: string;
  title: string;
  type: string;
  status: string;
  at: string;
  location: string;
  details: string[];
  photos: string[];
  updates: Update[];
}

export interface Ticket {
  id: string;
  title: string;
  priority: string;
  status: string;
  assignee: string | null;
  at: string;
  location: string;
  from: string;
  description: string;
  photos: string[];
  updates: Update[];
}

export interface Attention {
  text: string;
  where: string;
  at?: string;
  tone: "bad" | "warn";
}

export interface ChecklistLine {
  name: string;
  done: number;
  total: number;
  completedAt?: string;
  due?: string;
}

export interface ShiftReport {
  marina: string;
  guard: string;
  startedAt: string;
  endedAt: string;
  endedBy: string;
  endOfShiftNote: string;
  checkIns: { done: number; expected: number; extra: number };
  checklists: ChecklistLine[];
  attention: Attention[];
  incidents: Incident[];
  tickets: Ticket[];
  notes: { at: string; target: string; text: string }[];
  locations: LocationNode[];
  /** Items whose Section names no Location, grouped by checklist. */
  unlocated: { checklist: string; items: RecordItem[] }[];
}

function photo(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="hsl(${hue},18%,38%)"/><rect x="0" y="230" width="480" height="90" fill="hsl(${hue},14%,24%)"/><text x="24" y="292" font-family="sans-serif" font-size="22" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const T = (hhmm: string, day = 20) => `2026-10-${day}T${hhmm}:00-05:00`;

export const report: ShiftReport = {
  marina: "Harbor Point Marina",
  guard: "Dana Ruiz",
  startedAt: T("21:58", 19),
  endedAt: T("06:04"),
  endedBy: "Closing checklist",
  endOfShiftNote:
    "Quiet night apart from the truck in the boatyard. Mark should hear about it before the owner calls. I skipped the end of B Dock on the 3 AM walk: the ramp was slick after the rain and I was alone. Fuel dock prep is half done. Pumps are unlocked and ready, but I didn't get to the spill kit or the ice machine.",
  checkIns: { done: 21, expected: 22, extra: 2 },
  checklists: [
    { name: "Evening Lockup", done: 23, total: 23, completedAt: T("23:44", 19) },
    { name: "Dock Walk · 10:30 PM", done: 14, total: 14, completedAt: T("23:02", 19) },
    { name: "Dock Walk · 3:00 AM", done: 13, total: 14, completedAt: T("03:41") },
    { name: "Morning Fuel Dock Prep", done: 3, total: 6, due: T("06:00") },
    { name: "Closing", done: 6, total: 6, completedAt: T("06:04") },
  ],
  attention: [
    { tone: "bad", where: "Boatyard", at: T("01:52"), text: "Incident logged: unattended pickup inside the boatyard after the gate was locked." },
    { tone: "bad", where: "B Dock › End of B Dock", at: T("03:20"), text: "Missed check-in: End of B Dock (Dock Walk · 3:00 AM)." },
    { tone: "bad", where: "Bathhouse", at: T("23:18", 19), text: "Rear door found Unlocked, expected Locked; left Locked. Ticket raised." },
    { tone: "bad", where: "Fuel Dock", at: T("00:44"), text: "Pump 2 found Unlocked, expected Locked; left Locked." },
    { tone: "bad", where: "B Dock", at: T("00:18"), text: "Verify Task rejected: “Dock lights replaced”. B-14 and B-16 still out. Ticket raised." },
    { tone: "warn", where: "Fuel Dock", at: T("00:40"), text: "Manual check-in: “Tag cracked, won't scan.”" },
    { tone: "warn", where: "Campgrounds › Campground Loop", at: T("02:15"), text: "Check-in 68 m from the checkpoint (allowed 30 m)." },
    { tone: "bad", where: "Fuel Dock", text: "Morning Fuel Dock Prep unfinished at hand-in: 3 of 6, due 6:00 AM. Spill kit and ice machine not done." },
    { tone: "warn", where: "Campgrounds", at: T("23:55", 19), text: "Incident logged: loud music at site 14, resolved on the spot." },
  ],
  incidents: [
    {
      id: "inc-1",
      title: "Unattended pickup inside boatyard after gate lock",
      type: "Security",
      status: "Open",
      at: T("01:52"),
      location: "Boatyard",
      details: [
        "Found a silver Ford F-150 with a boat trailer parked beside the travel lift, inside the boatyard, about 20 minutes after I locked the gate at 1:30. Nobody was in the cab or anywhere in the yard. The gate padlock was still locked when I got there, so they must have been inside before I locked it.",
        "Plate photographed. No damage to any blocked boat that I could see. Left it in place and re-checked at 3:30, still there.",
      ],
      photos: [photo("Pickup by the travel lift", 210), photo("Plate", 30)],
      updates: [
        { at: T("07:31"), by: "Mark Ellis", kind: "addendum", text: "Truck belongs to the son of the B-22 slip holder; he was working on the hull and fell asleep in the shop office. Keys left with the office. Owner reminded of the after-hours policy." },
        { at: T("07:33"), by: "Mark Ellis", kind: "status", from: "Open", to: "Closed" },
      ],
    },
    {
      id: "inc-2",
      title: "Loud music at campground site 14",
      type: "Noise",
      status: "Closed",
      at: T("23:55", 19),
      location: "Campgrounds › Site 14",
      details: ["Music audible from the bathhouse. Spoke to the guests at site 14; they turned it off right away. No further problems on the 2 AM pass."],
      photos: [],
      updates: [],
    },
  ],
  tickets: [
    {
      id: "tkt-1",
      title: "Bathhouse rear door latch doesn't catch",
      priority: "High",
      status: "Open",
      assignee: null,
      at: T("23:20", 19),
      location: "Bathhouse",
      from: "Door Check · Evening Lockup",
      description: "Rear door swings shut but doesn't latch. Has to be pulled hard to lock. Found it unlocked tonight.",
      photos: [photo("Rear door strike plate", 120)],
      updates: [
        { at: T("07:05"), by: "Mark Ellis", kind: "assignee", from: "Unassigned", to: "Luis Ortega" },
        { at: T("09:40"), by: "Luis Ortega", kind: "comment", text: "Strike plate was bent. Replaced it, and the door latches on its own now." },
        { at: T("09:41"), by: "Luis Ortega", kind: "status", from: "Open", to: "Resolved" },
      ],
    },
    {
      id: "tkt-2",
      title: "B Dock lights out at B-14 and B-16",
      priority: "Medium",
      status: "Open",
      assignee: "Luis Ortega",
      at: T("00:18"),
      location: "B Dock",
      from: "Verify Task rejected · Dock Walk · 10:30 PM",
      description: "Marked as replaced on Friday's ticket, but both fixtures are still dark.",
      photos: [],
      updates: [],
    },
  ],
  notes: [
    { at: T("03:10"), target: "Boat · Second Wind (A-12)", text: "Bilge pump cycling about every 10 minutes. Texted the owner at 3:10." },
    { at: T("23:41", 19), target: "Parking Lot", text: "North light pole flickering." },
  ],
  locations: [
    {
      id: "store",
      name: "Ship Store",
      depth: 0,
      items: [
        { id: "s0", kind: "checkin", label: "Ship Store", source: "Evening Lockup", time: T("22:08", 19), result: "Scanned", mark: "ok" },
        { id: "s1", kind: "door", label: "Front door", source: "Evening Lockup", time: T("22:09", 19), expected: "Locked", found: "Locked", left: "Locked", mark: "ok" },
        { id: "s2", kind: "door", label: "Back door", source: "Evening Lockup", time: T("22:10", 19), expected: "Locked", found: "Locked", left: "Locked", mark: "ok" },
        { id: "s3", kind: "simple", label: "Lights off except night lights", source: "Evening Lockup", time: T("22:10", 19), mark: "ok" },
        { id: "s4", kind: "simple", label: "Register area secured", source: "Evening Lockup", time: T("22:11", 19), mark: "ok" },
      ],
    },
    {
      id: "fuel",
      name: "Fuel Dock",
      depth: 0,
      items: [
        { id: "f0", kind: "checkin", label: "Fuel Dock", source: "Evening Lockup", time: T("00:40"), result: "Manual", note: "Tag cracked, won't scan.", mark: "exception", why: "Manual check-in" },
        { id: "f1", kind: "lock", label: "Pump 1", source: "Evening Lockup", time: T("00:42"), expected: "Locked", found: "Locked", left: "Locked", mark: "ok" },
        { id: "f2", kind: "lock", label: "Pump 2", source: "Evening Lockup", time: T("00:44"), expected: "Locked", found: "Unlocked", left: "Locked", mark: "exception", why: "Found Unlocked" },
        { id: "f3", kind: "meter", label: "Pump 1 totalizer", source: "Evening Lockup", time: T("00:45"), result: "48,213.6 gal", mark: "ok" },
        { id: "f4", kind: "meter", label: "Pump 2 totalizer", source: "Evening Lockup", time: T("00:46"), result: "31,907.2 gal", mark: "ok" },
        { id: "f5", kind: "simple", label: "Unlock pumps", source: "Morning Fuel Dock Prep", time: T("05:38"), mark: "ok" },
        { id: "f6", kind: "simple", label: "Hoses coiled, nozzles holstered", source: "Morning Fuel Dock Prep", time: T("05:40"), mark: "ok" },
        { id: "f7", kind: "simple", label: "Price board set", source: "Morning Fuel Dock Prep", time: T("05:42"), mark: "ok" },
        { id: "f8", kind: "simple", label: "Spill kit present and sealed", source: "Morning Fuel Dock Prep", mark: "missed", why: "Not done at hand-in" },
        { id: "f9", kind: "simple", label: "Ice machine filled", source: "Morning Fuel Dock Prep", mark: "missed", why: "Not done at hand-in" },
        { id: "f10", kind: "simple", label: "Fire extinguisher tag current", source: "Morning Fuel Dock Prep", mark: "missed", why: "Not done at hand-in" },
      ],
    },
    {
      id: "a",
      name: "A Dock",
      depth: 0,
      items: [
        { id: "a0", kind: "checkin", label: "A Dock head", source: "Dock Walk · 10:30 PM", time: T("22:31", 19), result: "Scanned", mark: "ok" },
        { id: "a1", kind: "checkin", label: "End of A Dock", source: "Dock Walk · 10:30 PM", time: T("22:38", 19), result: "Scanned", mark: "ok" },
        { id: "a2", kind: "simple", label: "Shore power cords out of the water", source: "Dock Walk · 10:30 PM", time: T("22:39", 19), mark: "ok" },
        { id: "a3", kind: "simple", label: "Dock boxes closed", source: "Dock Walk · 10:30 PM", time: T("22:39", 19), mark: "ok" },
        { id: "a4", kind: "checkin", label: "A Dock head", source: "Dock Walk · 3:00 AM", time: T("03:02"), result: "Scanned", mark: "ok" },
        { id: "a5", kind: "checkin", label: "End of A Dock", source: "Dock Walk · 3:00 AM", time: T("03:08"), result: "Scanned", mark: "ok" },
        { id: "a6", kind: "simple", label: "Shore power cords out of the water", source: "Dock Walk · 3:00 AM", time: T("03:09"), mark: "ok", note: "A-12 bilge pump cycling, see note" },
        { id: "a7", kind: "simple", label: "Dock boxes closed", source: "Dock Walk · 3:00 AM", time: T("03:09"), mark: "ok" },
      ],
    },
    {
      id: "b",
      name: "B Dock",
      depth: 0,
      items: [
        { id: "b0", kind: "checkin", label: "B Dock head", source: "Dock Walk · 10:30 PM", time: T("22:44", 19), result: "Scanned", mark: "ok" },
        { id: "b1", kind: "checkin", label: "End of B Dock", source: "Dock Walk · 10:30 PM", time: T("22:52", 19), result: "Scanned", mark: "ok" },
        { id: "b2", kind: "verify", label: "Dock lights replaced (B-14, B-16)", source: "Dock Walk · 10:30 PM", time: T("00:18"), result: "Rejected, ticket raised", note: "Both still out.", mark: "exception", why: "Verify Task rejected" },
        { id: "b3", kind: "simple", label: "Shore power cords out of the water", source: "Dock Walk · 10:30 PM", time: T("22:53", 19), mark: "ok" },
        { id: "b4", kind: "checkin", label: "B Dock head", source: "Dock Walk · 3:00 AM", time: T("03:15"), result: "Scanned", mark: "ok" },
        { id: "b5", kind: "checkin", label: "End of B Dock", source: "Dock Walk · 3:00 AM", mark: "missed", why: "Missed check-in" },
        { id: "b6", kind: "simple", label: "Shore power cords out of the water", source: "Dock Walk · 3:00 AM", time: T("03:17"), mark: "ok" },
      ],
    },
    {
      id: "bath",
      name: "Bathhouse",
      depth: 0,
      items: [
        { id: "h0", kind: "checkin", label: "Bathhouse", source: "Evening Lockup", time: T("23:15", 19), result: "Scanned", mark: "ok" },
        { id: "h1", kind: "door", label: "Front door", source: "Evening Lockup", time: T("23:16", 19), expected: "Locked", found: "Locked", left: "Locked", mark: "ok" },
        { id: "h2", kind: "door", label: "Rear door", source: "Evening Lockup", time: T("23:18", 19), expected: "Locked", found: "Unlocked", left: "Locked", note: "Latch doesn't catch, ticket raised", mark: "exception", why: "Found Unlocked" },
        { id: "h3", kind: "simple", label: "Paper and soap restocked", source: "Evening Lockup", time: T("23:19", 19), mark: "ok" },
      ],
    },
    {
      id: "yard",
      name: "Boatyard",
      depth: 0,
      items: [
        { id: "y0", kind: "checkin", label: "Boatyard Gate", source: "Evening Lockup", time: T("23:30", 19), result: "Scanned", mark: "ok" },
        { id: "y1", kind: "lock", label: "Gate padlock", source: "Evening Lockup", time: T("01:30"), expected: "Locked", found: "Unlocked", left: "Locked", mark: "ok", note: "Expected open until 1:30 AM for the late haul-out" },
        { id: "y2", kind: "checkin", label: "Boatyard Gate", source: "(not expected)", time: T("01:50"), result: "Scanned", mark: "ok" },
      ],
    },
    {
      id: "lot",
      name: "Parking Lot",
      depth: 0,
      items: [
        { id: "p0", kind: "checkin", label: "Parking Lot north", source: "Evening Lockup", time: T("23:40", 19), result: "Scanned", mark: "ok" },
        { id: "p1", kind: "simple", label: "No unpermitted overnight vehicles", source: "Evening Lockup", time: T("23:41", 19), mark: "ok" },
      ],
    },
    {
      id: "camp",
      name: "Campgrounds",
      depth: 0,
      items: [
        { id: "c0", kind: "simple", label: "Quiet hours observed", source: "Evening Lockup", time: T("23:58", 19), note: "Music at site 14, see incident", mark: "ok" },
      ],
    },
    {
      id: "loop",
      name: "Campground Loop",
      depth: 1,
      items: [
        { id: "l0", kind: "checkin", label: "Campground Loop", source: "Evening Lockup", time: T("02:15"), result: "Scanned · 68 m away (allowed 30 m)", mark: "exception", why: "Outside GPS radius" },
        { id: "l1", kind: "checkin", label: "Campground Loop", source: "(not expected)", time: T("23:52", 19), result: "Scanned", mark: "ok" },
      ],
    },
  ],
  unlocated: [
    {
      checklist: "Closing",
      items: [
        { id: "z1", kind: "simple", label: "Radio returned to charger", source: "Closing", time: T("06:00"), mark: "ok" },
        { id: "z2", kind: "simple", label: "Keys in the key box", source: "Closing", time: T("06:01"), mark: "ok" },
        { id: "z3", kind: "simple", label: "Gate code log signed", source: "Closing", time: T("06:01"), mark: "ok" },
        { id: "z4", kind: "meter", label: "Patrol cart hours", source: "Closing", time: T("06:02"), result: "1,284.3 h", mark: "ok" },
        { id: "z5", kind: "simple", label: "Office lights off", source: "Closing", time: T("06:02"), mark: "ok" },
        { id: "z6", kind: "end_shift", label: "End Shift", source: "Closing", time: T("06:04"), mark: "ok" },
      ],
    },
  ],
};

// ---- formatting and the summary sentences (the email body uses the same)

export const fmtTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : "";
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
export const fmtStamp = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

export function summarySentences(r: ShiftReport): string[] {
  const complete = r.checklists.filter((c) => c.done === c.total).length;
  const first = r.guard.split(" ")[0];
  return [
    `${first} checked in at ${r.checkIns.done} of ${r.checkIns.expected} expected checkpoints and completed ${complete} of ${r.checklists.length} checklists.`,
    `${r.incidents.length} incidents were logged and ${r.tickets.length} tickets raised.`,
    `${r.attention.length} things need attention.`,
  ];
}

export function itemResult(i: RecordItem): string {
  if (i.mark === "missed") return i.kind === "checkin" ? "Not visited" : "Not done";
  if (i.kind === "door" || i.kind === "lock") return i.found === i.left ? `${i.found}` : `Found ${i.found}, left ${i.left}`;
  if (i.result) return i.result;
  return "Done";
}

export function describeUpdate(u: Update): string {
  switch (u.kind) {
    case "status":
      return `Status ${u.from} → ${u.to}`;
    case "assignee":
      return `Assigned to ${u.to}`;
    case "priority":
      return `Priority ${u.from} → ${u.to}`;
    case "addendum":
      return "Addendum";
    case "comment":
      return "Comment";
  }
}
