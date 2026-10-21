// Copy for src/pages/reports/. Only the Shift Report's Vehicles section so
// far; the rest of the area converts in its own commit (docs/TODO.md
// § Localization).
export const reports = {
  vehicles: {
    title: "Vehicles ({{count}})",
    none: "No vehicle used this shift.",
    span: "{{out}} – {{end}}",
    stillOut: "still out",
    keptPast: "kept past End of Shift",
    keptFromPrevious: "kept from the previous shift",
    odometer: "{{out}} → {{end}} (+{{distance}} {{unit}})",
    fuelBack: "fuel back {{fuel}}",
    fuelKept: "fuel {{fuel}} at End of Shift",
    fill: "⛽ {{gallons}} gal at {{time}}",
    fillCost: "⛽ {{gallons}} gal at {{time}} · {{cost}}",
    statusCheck: "{{time}}: {{odometer}} {{unit}}, fuel {{fuel}}",
    statusCheckNoMeter: "{{time}}: fuel {{fuel}}",
    reading: "Mileage: {{value}} {{unit}} · {{time}}",
    status: "Status → {{status}} · {{time}}",
    statusNote: "Status → {{status}} · {{time}} · “{{note}}”",
    incident: "Incident: {{title}}",
    ticket: "Ticket: {{title}}",
    note: "“{{note}}”",
    kept: "Kept: {{reason}}",
    unit: { mileage: "mi", hours: "hrs", gallons: "gal" },
  },
};
