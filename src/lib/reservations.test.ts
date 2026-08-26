import { describe, expect, it } from "vitest";
import { isBillable, rangesOverlap, reservationTargetOf } from "./reservations";

describe("rangesOverlap", () => {
  it("detects a genuine overlap", () => {
    expect(rangesOverlap(10, 20, 15, 25)).toBe(true);
    expect(rangesOverlap(15, 25, 10, 20)).toBe(true);
  });

  it("treats back-to-back ranges as NOT overlapping", () => {
    // One guest checks out at noon and the next checks in at noon. Treating
    // that as a conflict would block every legitimate same-day turnover —
    // and cabins turn over weekly, camping biweekly.
    expect(rangesOverlap(10, 20, 20, 30)).toBe(false);
    expect(rangesOverlap(20, 30, 10, 20)).toBe(false);
  });

  it("detects full containment", () => {
    expect(rangesOverlap(10, 30, 15, 20)).toBe(true);
  });
});

describe("isBillable", () => {
  const publicTarget = {
    kind: "location" as const,
    id: "l1",
    name: "Slip 14",
    typeLabel: "Slip",
    defaultBillable: true,
  };

  it("lets the reservation's own billingType win over the target default", () => {
    expect(isBillable({ billingType: "non_billable" }, publicTarget)).toBe(false);
    expect(isBillable({ billingType: "billable" }, { ...publicTarget, defaultBillable: false })).toBe(
      true,
    );
  });

  it("falls back to the target default when billingType predates the field", () => {
    expect(isBillable({}, publicTarget)).toBe(true);
    expect(isBillable({ billingType: null }, { ...publicTarget, defaultBillable: false })).toBe(false);
  });

  it("is not billable with no target at all", () => {
    expect(isBillable({}, null)).toBe(false);
  });
});

describe("reservationTargetOf", () => {
  it("derives a location target, defaulting billable from public visibility", () => {
    const target = reservationTargetOf({
      location: {
        id: "l1",
        name: "Slip 14",
        reservationVisibility: "public",
        postReservationStatus: "needs_cleaning",
        type: { name: "Slip" },
      },
    });
    expect(target).toMatchObject({
      kind: "location",
      typeLabel: "Slip",
      defaultBillable: true,
      postStatus: "needs_cleaning",
    });
  });

  it("treats internal visibility as not billable by default", () => {
    const target = reservationTargetOf({
      asset: { id: "a1", name: "Courtesy cart", category: "Vehicle", reservationVisibility: "internal" },
    });
    expect(target).toMatchObject({ kind: "asset", typeLabel: "Vehicle", defaultBillable: false });
  });

  it("is null when neither target is linked", () => {
    expect(reservationTargetOf({})).toBeNull();
  });
});
