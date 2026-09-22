// Marina domain generators.
//
// faker covers people, phones, emails and — usefully — road vehicles, which
// map straight onto the `vehicles` table. It has nothing marine at all, and
// the marine vocabulary is what makes seeded data readable: a slip called
// "Dock C → Slip 14" holding "Knot Working" tells you at a glance that the
// hierarchy and the occupancy links both worked. "Location 412" holding
// "Boat 88" does not.
//
// Everything here is deterministic under a seeded faker: callers seed once and
// get the same marina every run, so a bug reproduces.

import { faker } from "@faker-js/faker";

// ── boats ────────────────────────────────────────────────────────────────

// Real manufacturers with their actual model families, so a seeded boat reads
// like a boat somebody owns rather than a random pair of words.
const BOAT_MAKES = {
  "Sea Ray":        ["Sundancer", "SLX", "SPX", "Sundeck", "Sport"],
  "Boston Whaler":  ["Montauk", "Outrage", "Conquest", "Dauntless", "Vantage"],
  "Grady-White":    ["Freedom", "Canyon", "Fisherman", "Express", "Adventure"],
  "Catalina":       ["22 Sport", "275 Sport", "315", "355", "425"],
  "Beneteau":       ["Oceanis", "First", "Antares", "Swift Trawler", "Flyer"],
  Bayliner:         ["Element", "Trophy", "Ciera", "VR5", "DX2000"],
  Chaparral:        ["SSi", "SSX", "Surf", "Signature", "OSX"],
  Regal:            ["LX", "LS", "OBX", "Commodore", "Express"],
  MasterCraft:      ["NXT", "XT", "XStar", "ProStar", "X24"],
  Malibu:           ["Wakesetter", "Response", "M Series", "Sunscape"],
  Pursuit:          ["DC", "OS", "S Series", "C Series"],
  Jeanneau:         ["Sun Odyssey", "Merry Fisher", "Cap Camarat", "NC"],
  Hunter:           ["33", "36", "40", "45"],
  Tracker:          ["Pro Team", "Targa", "Grizzly", "Bass Tracker"],
  Lund:             ["Alaskan", "Pro-V", "Rebel", "Impact"],
  Carver:           ["Coupe", "Command Bridge", "Motor Yacht"],
  Tiara:            ["Coupe", "Sport", "Open", "LS"],
  Formula:          ["Sun Sport", "Bowrider", "Crossover", "FAS3TECH"],
  Cobalt:           ["R Series", "CS Series", "A Series", "R35"],
};

// Marina boat names are a genre. Roughly half are puns, which is not a joke —
// it is what the fleet list actually looks like, and seeded data that reads
// wrong makes screens hard to review.
const BOAT_NAMES_PUN = [
  "Knot Working", "Aqua Holic", "Reel Therapy", "Sea Ya Later", "Nauti Buoy",
  "Vitamin Sea", "Fish Tales", "Miss Behavin'", "Liquid Asset", "Dock Holiday",
  "Ship Faced", "Buoys N Gulls", "Marlin Monroe", "Codfather", "Fin-Tastic",
  "Reel Escape", "Salty Paws", "Pier Pressure", "Wet Dream", "Seas the Day",
  "Usain Boat", "Aboat Time", "For Shore", "Knot on Call", "Odds Are Good",
];
const BOAT_NAMES_CLASSIC = [
  "Serenity", "Second Wind", "Osprey", "Blue Horizon", "Southern Cross",
  "Island Time", "Wanderlust", "Perseverance", "Andiamo", "Bella Vita",
  "Carpe Diem", "Freedom", "Legacy", "Tranquility", "Sea Breeze",
  "Escape Plan", "No Worries", "Time Out", "Grace", "Endeavour",
  "Halcyon", "Kismet", "Meridian", "Solstice", "Zephyr",
];

export function boatName() {
  const roll = faker.number.int({ min: 1, max: 100 });
  if (roll <= 45) return faker.helpers.arrayElement(BOAT_NAMES_PUN);
  if (roll <= 85) return faker.helpers.arrayElement(BOAT_NAMES_CLASSIC);
  // The rest are named after somebody — usually a spouse.
  return `Miss ${faker.person.firstName()}`;
}

export function boatMakeModel() {
  const make = faker.helpers.arrayElement(Object.keys(BOAT_MAKES));
  return { make, model: faker.helpers.arrayElement(BOAT_MAKES[make]) };
}

export function boatLengthFt() {
  // Skewed small: a marina is mostly 20-30ft runabouts with a few big ones.
  const roll = faker.number.int({ min: 1, max: 100 });
  if (roll <= 60) return faker.number.int({ min: 18, max: 28 });
  if (roll <= 90) return faker.number.int({ min: 29, max: 40 });
  return faker.number.int({ min: 41, max: 65 });
}

export function registrationNumber() {
  // US state registration format: two letters, four digits, two letters.
  const st = faker.helpers.arrayElement(["WI", "MN", "IL", "MI", "IA"]);
  return `${st} ${faker.string.numeric(4)} ${faker.string.alpha({ length: 2, casing: "upper" })}`;
}

// ── the property ─────────────────────────────────────────────────────────

export const DOCK_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function dockName(i)     { return `Dock ${DOCK_LETTERS[i % DOCK_LETTERS.length]}`; }
export function slipName(n)     { return `Slip ${n}`; }
export function cabinName(n)    { return `Cabin ${n}`; }
export function campLoopName(i) { return `Loop ${DOCK_LETTERS[i % DOCK_LETTERS.length]}`; }
export function campsiteName(n) { return `Site ${n}`; }

// Checkpoints are deliberately generic — the whole point of grouping them
// under a location is that a checkpoint can just be called "Gate" instead of
// "The Point - Back Door".
const CHECKPOINT_NAMES = [
  "Gate", "Fuel Dock", "Pump House", "Boathouse Door", "Ice Machine",
  "Restroom", "Shower House", "Boat Ramp", "Office Door", "Shop Door",
  "Dumpster Enclosure", "Electrical Panel", "Water Storage Door",
  "Propane Cage", "Fire Extinguisher Station", "Ladder Rack",
];
export function checkpointName() { return faker.helpers.arrayElement(CHECKPOINT_NAMES); }
export const ALL_CHECKPOINT_NAMES = CHECKPOINT_NAMES;

// ── work ─────────────────────────────────────────────────────────────────

const INCIDENT_TITLES = [
  "Unsecured vessel", "Damaged cleat", "Fuel spill", "Trespasser reported",
  "Vandalism to dock box", "Medical assist", "Unauthorized dock access",
  "Loose shore power cord", "Storm damage to canopy", "Wildlife on dock",
  "Noise complaint", "Abandoned vehicle", "Unattended campfire",
  "Boat taking on water", "Gate left open overnight",
];
export function incidentTitle() { return faker.helpers.arrayElement(INCIDENT_TITLES); }

const TICKET_TITLES = [
  "Replace dock light", "Repair loose decking board", "Pump-out required",
  "Fix water spigot", "Replace fire extinguisher", "Repair gate latch",
  "Clear blocked drain", "Re-stripe parking stall", "Replace burnt-out bulb",
  "Tighten dock cleat", "Service courtesy cart", "Patch shower house tile",
];
export function ticketTitle() { return faker.helpers.arrayElement(TICKET_TITLES); }

const INCIDENT_TYPES = [
  "Security", "Safety", "Property Damage", "Environmental",
  "Medical", "Guest Conduct", "Weather",
];
export const ALL_INCIDENT_TYPES = INCIDENT_TYPES;

export function noteBody() {
  return faker.helpers.arrayElement([
    "Owner notified by phone; no further action needed.",
    "Left a tag on the helm. Will follow up next round.",
    "Spoke with the guest — they were unaware of the quiet hours.",
    "Photographed and logged. Maintenance ticket raised separately.",
    "Resolved on site. No damage found.",
    "Could not make contact. Retry in the morning.",
  ]);
}

// ── people ───────────────────────────────────────────────────────────────

// A US-shaped number faker's national style does not reliably produce, and
// which normalizePhone() in src/lib/contacts.ts can round-trip.
export function usPhone() {
  return `(${faker.string.numeric({ length: 3, allowLeadingZeros: false })}) ` +
         `${faker.string.numeric({ length: 3, allowLeadingZeros: false })}-${faker.string.numeric(4)}`;
}
