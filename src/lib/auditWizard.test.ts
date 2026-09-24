import { describe, expect, it } from "vitest";
import {
  allKeys,
  CONFIRM_KEY,
  answeredCount,
  buildCatalogue,
  buildSteps,
  filterTargets,
  isAnswered,
  sameAnswer,
  itemsForTarget,
  stepOfTarget,
  visiblePageHeight,
  type ItemGroup,
  type WizardTarget,
} from "./auditWizard";

// The wizard's model (docs/audits.md § The wizard). The fixture is a status
// audit over two location types - Slip and Campsite - so the "which items
// apply here" rules have something to bite on.

const SLIP = "type-slip";
const CAMP = "type-camp";

const audit = {
  kind: "status" as const,
  include_attributes: 1,
  include_services: 1,
  include_amenities: 1,
  include_marked: 1,
  include_map: 1,
};
const input = {
  audit,
  services: [
    { id: "s-power", name: "Power", unit: "kWh" },
    { id: "s-water", name: "Water", unit: null },
  ],
  amenities: [{ id: "a-wifi", name: "WiFi" }],
  attributes: [
    { id: "at-len", name: "Max boat length", unit: "ft", kind: "number" },
    { id: "at-acc", name: "Access", unit: null, kind: "choice", choices: '["Back-In","Pull-Through"]' },
  ],
  serviceValidity: [
    { location_type_id: SLIP, service_id: "s-power" },
    { location_type_id: CAMP, service_id: "s-power" },
    { location_type_id: CAMP, service_id: "s-water" },
  ],
  amenityValidity: [{ location_type_id: CAMP, amenity_id: "a-wifi" }],
  attributeValidity: [
    { location_type_id: SLIP, attribute_id: "at-len" },
    { location_type_id: CAMP, attribute_id: "at-acc" },
  ],
  questions: [
    { id: "q-breaker", prompt: "Is the breaker labelled?", kind: "yes_no", choices: null, ticket_on_no: 1 },
    { id: "q-ring", prompt: "Fire ring condition", kind: "choice", choices: '["Good","Rusted"]', ticket_on_no: 0 },
  ],
  questionTargets: [
    { target_id: "t-slip", question_id: "q-breaker" },
    { target_id: "t-camp", question_id: "q-breaker" },
    { target_id: "t-camp", question_id: "q-ring" },
  ],
};

const target = (over: Partial<WizardTarget> & { id: string; location_type_id: string }): WizardTarget => ({
  location_id: `loc-${over.id}`,
  location_name: over.id,
  type_name: over.location_type_id === SLIP ? "Slip" : "Campsite",
  state: "pending",
  gps_lat: null,
  gps_lng: null,
  ...over,
});
const slip = target({ id: "t-slip", location_type_id: SLIP });
const camp = target({ id: "t-camp", location_type_id: CAMP });

describe("buildCatalogue", () => {
  it("1 · groups in order, attributes before services, every item present", () => {
    const groups = buildCatalogue(input);
    expect(groups.map((g) => g.label)).toEqual(["Status", "Attributes", "Services", "Amenities", "Questions", "Checks", "GPS"]);
    expect(groups.find((g) => g.label === "Attributes")!.items.map((i) => i.label)).toEqual(["Max boat length", "Access"]);
    expect(groups.find((g) => g.label === "Status")!.items.map((i) => i.key)).toEqual(["status", CONFIRM_KEY]);
    expect(groups.find((g) => g.label === "Checks")!.items.map((i) => i.key)).toEqual(["marked", "map"]);
    const access = groups.flatMap((g) => g.items).find((i) => i.key === "attribute:at-acc")!;
    expect(access.choices).toEqual(["Back-In", "Pull-Through"]);
    const breaker = groups.flatMap((g) => g.items).find((i) => i.key === "question:q-breaker")!;
    expect(breaker.ticketOnNo).toBe(true);
    expect([...breaker.targetIds!]).toEqual(["t-slip", "t-camp"]);
  });
  it("2 · a category the audit switched off is not offered at all", () => {
    const groups = buildCatalogue({ ...input, audit: { ...audit, include_amenities: 0, include_map: 0 } });
    expect(groups.map((g) => g.label)).not.toContain("Amenities");
    expect(groups.find((g) => g.label === "Checks")!.items.map((i) => i.key)).toEqual(["marked"]);
  });
  it("3 · an occupancy audit offers occupancy, its questions and GPS - nothing else", () => {
    const groups = buildCatalogue({ ...input, audit: { ...audit, kind: "occupancy" } });
    expect(groups.map((g) => g.label)).toEqual(["Occupancy", "Questions", "GPS"]);
    expect(groups[0].items.map((i) => i.key)).toEqual(["occupied", CONFIRM_KEY]);
  });
  it("4 · allKeys is every item, and is what a fresh run selects", () => {
    const groups = buildCatalogue(input);
    expect(allKeys(groups).size).toBe(groups.reduce((n, g) => n + g.items.length, 0));
    expect(allKeys(groups).has("attribute:at-len")).toBe(true);
  });
});

describe("itemsForTarget", () => {
  const groups: ItemGroup[] = buildCatalogue(input);
  const all = allKeys(groups);
  it("5 · only what is valid for this location's type, in group order", () => {
    expect(itemsForTarget(groups, all, slip).map((i) => i.label)).toEqual([
      "Location status",
      "Max boat length",
      "Power",
      "Is the breaker labelled?",
      "Clearly marked?",
      "Placed correctly on the map?",
      "GPS coordinates",
      "Confirm this location is done",
    ]);
    expect(itemsForTarget(groups, all, camp).map((i) => i.label)).toEqual([
      "Location status",
      "Access",
      "Power",
      "Water",
      "WiFi",
      "Is the breaker labelled?",
      "Fire ring condition",
      "Clearly marked?",
      "Placed correctly on the map?",
      "GPS coordinates",
      "Confirm this location is done",
    ]);
  });
  it("6 · a question is asked only where its Rule put it", () => {
    expect(itemsForTarget(groups, all, slip).some((i) => i.key === "question:q-ring")).toBe(false);
  });
  it("7 · a location that already has a pin is not asked for one", () => {
    const pinned = { ...slip, gps_lat: 33.8, gps_lng: -96.6 };
    expect(itemsForTarget(groups, all, pinned).some((i) => i.kind === "gps")).toBe(false);
  });
  it("8 · deselecting items drops them, and a group can be swept alone", () => {
    const onlyPower = new Set(["service:s-power"]);
    expect(itemsForTarget(groups, onlyPower, camp).map((i) => i.label)).toEqual(["Power"]);
    expect(itemsForTarget(groups, new Set<string>(), camp)).toEqual([]);
  });
});

describe("buildSteps", () => {
  const groups = buildCatalogue(input);
  const all = allKeys(groups);
  it("9 · location-major: every item of one location, then the next", () => {
    const steps = buildSteps([slip, camp], groups, all);
    expect(steps).toHaveLength(8 + 11);
    expect(steps[0]).toMatchObject({ targetIndex: 0, itemIndex: 0 });
    expect(steps[7]).toMatchObject({ targetIndex: 0, itemIndex: 7 });
    expect(steps[8]).toMatchObject({ targetIndex: 1, itemIndex: 0 });
    expect(steps.map((s) => s.target.id)).toEqual([...Array(8).fill("t-slip"), ...Array(11).fill("t-camp")]);
  });
  it("10 · a one-item sweep is one step per location", () => {
    const steps = buildSteps([slip, camp], groups, new Set(["service:s-power"]));
    expect(steps.map((s) => `${s.target.id}:${s.item.key}`)).toEqual(["t-slip:service:s-power", "t-camp:service:s-power"]);
  });
  it("11 · stepOfTarget finds a location's first step, and forgives a stranger", () => {
    const steps = buildSteps([slip, camp], groups, all);
    expect(stepOfTarget(steps, "t-camp")).toBe(8);
    expect(stepOfTarget(steps, "nobody")).toBe(0);
  });
});

describe("filterTargets", () => {
  const audited = { ...camp, state: "audited" as const };
  const list = [slip, audited];
  it("12 · still-to-do drops what is audited or answered this run", () => {
    expect(filterTargets(list, "", "pending", () => false).map((t) => t.id)).toEqual(["t-slip"]);
    expect(filterTargets(list, "", "pending", (id) => id === "t-slip")).toEqual([]);
    expect(filterTargets(list, "", "audited", () => false).map((t) => t.id)).toEqual(["t-camp"]);
    expect(filterTargets(list, "", "all", () => false)).toHaveLength(2);
  });
  it("13 · search matches the name or the type, case-insensitively", () => {
    expect(filterTargets(list, "CAMP", "all", () => false).map((t) => t.id)).toEqual(["t-camp"]);
    expect(filterTargets(list, "slip", "all", () => false).map((t) => t.id)).toEqual(["t-slip"]);
    expect(filterTargets(list, "nothing", "all", () => false)).toEqual([]);
  });
});

describe("isAnswered", () => {
  it("14 · what counts as answered, per kind", () => {
    expect(isAnswered({ present: null, working: true, note: "" }, "service")).toBe(false);
    expect(isAnswered({ present: false, working: true, note: "" }, "service")).toBe(true);
    expect(isAnswered({ present: null, note: "" }, "amenity")).toBe(false);
    expect(isAnswered({ present: true, note: "" }, "amenity")).toBe(true);
    expect(isAnswered({ value: "", text: "", note: "" }, "attribute")).toBe(false);
    expect(isAnswered({ value: "38", text: "", note: "" }, "attribute")).toBe(true);
    expect(isAnswered({ value: "", text: "Back-In", note: "" }, "attribute")).toBe(true);
    expect(isAnswered(false, "question")).toBe(true);
    expect(isAnswered("", "question")).toBe(false);
    expect(isAnswered(undefined, "marked")).toBe(false);
    expect(isAnswered(true, "marked")).toBe(true);
    expect(isAnswered(undefined, "confirm")).toBe(false);
    expect(isAnswered(true, "confirm")).toBe(true);
  });
  it("15 · answeredCount counts the items of one location that have answers", () => {
    const groups = buildCatalogue(input);
    const items = itemsForTarget(groups, allKeys(groups), camp);
    expect(answeredCount(items, undefined)).toBe(0);
    expect(
      answeredCount(items, {
        "service:s-power": { present: true, working: true, note: "" },
        "attribute:at-acc": { value: "", text: "", note: "" },
        marked: true,
      }),
    ).toBe(2);
  });
});

describe("visiblePageHeight", () => {
  const wrap = { top: 44, height: 700 };
  it("16 · no keyboard: the page is the whole scroller", () => {
    expect(visiblePageHeight(wrap, { offsetTop: 0, height: 800 })).toBe(700);
  });
  it("17 · a keyboard takes the bottom, and the page gives way by that much", () => {
    // 800 tall, 300 of keyboard: visible bottom is 500, the scroller starts
    // at 44, so 456 of it is on screen.
    expect(visiblePageHeight(wrap, { offsetTop: 0, height: 500 })).toBe(456);
  });
  it("18 · iOS scrolls the visual viewport, which moves the visible bottom", () => {
    expect(visiblePageHeight(wrap, { offsetTop: 60, height: 500 })).toBe(516);
  });
  it("19 · never taller than the scroller, never shorter than a control", () => {
    expect(visiblePageHeight(wrap, { offsetTop: 0, height: 5000 })).toBe(700);
    expect(visiblePageHeight(wrap, { offsetTop: 0, height: 20 })).toBe(160);
  });
});

describe("sameAnswer", () => {
  it("20 · a field landed on and left is not a change", () => {
    expect(sameAnswer({ value: "38", text: "", note: "" }, { value: "38", text: "", note: "" })).toBe(true);
    expect(sameAnswer({ present: true, working: true, note: "" }, { present: true, working: true, note: "" })).toBe(true);
    expect(sameAnswer(undefined, undefined)).toBe(true);
    expect(sameAnswer(null, null)).toBe(true);
    expect(sameAnswer("Back-In", "Back-In")).toBe(true);
    expect(sameAnswer(false, false)).toBe(true);
  });
  it("21 · anything actually typed or tapped is", () => {
    expect(sameAnswer({ value: "38", text: "", note: "" }, { value: "36", text: "", note: "" })).toBe(false);
    expect(sameAnswer({ present: true, working: true, note: "" }, { present: true, working: false, note: "" })).toBe(false);
    expect(sameAnswer({ present: true, working: true, note: "" }, { present: true, working: true, note: "dead" })).toBe(false);
    expect(sameAnswer(true, false)).toBe(false);
    expect(sameAnswer(undefined, false)).toBe(false);
    expect(sameAnswer(null, { present: true, note: "" })).toBe(false);
    expect(sameAnswer("Back-In", "Pull-Through")).toBe(false);
  });
});

describe("the confirmation page", () => {
  const groups = buildCatalogue(input);
  const all = allKeys(groups);
  it("22 · ends every location, whatever group it was offered under", () => {
    // It is offered beside Location status, so a run can turn it off under
    // Status - and asked last, because there is nothing to confirm until
    // the questions have been asked.
    const items = itemsForTarget(groups, all, camp);
    expect(items[items.length - 1].key).toBe(CONFIRM_KEY);
    expect(items.filter((i) => i.kind === "confirm")).toHaveLength(1);
    expect(buildSteps([camp], groups, all).at(-1)!.item.key).toBe(CONFIRM_KEY);
  });
  it("23 · turned off, a run records without ever saying a location is done", () => {
    const gathering = new Set([...all].filter((k) => k !== CONFIRM_KEY));
    expect(itemsForTarget(groups, gathering, camp).some((i) => i.kind === "confirm")).toBe(false);
  });
  it("24 · and a confirmation sweep is a run with nothing else selected", () => {
    const steps = buildSteps([slip, camp], groups, new Set([CONFIRM_KEY]));
    expect(steps.map((s) => `${s.target.id}:${s.item.key}`)).toEqual(["t-slip:confirm", "t-camp:confirm"]);
  });
});
