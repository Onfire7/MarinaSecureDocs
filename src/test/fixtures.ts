import { faker } from "@faker-js/faker";
import type {
  AssetLike,
  MeterReadingLike,
  TicketLike,
} from "../lib/maintenanceRules";

/**
 * Fixture factories for the unit suite.
 *
 * Faker supplies *incidental* data — the filler contacts in a list, a
 * plausible slip name, a phone number — so fixtures read like marina data
 * instead of "foo" and "bar". The seed is pinned in setup.ts.
 *
 * The rule that keeps this honest: **faker never generates the value under
 * test.** "Slip 9 sorts before Slip 14" *is* the assertion, so those are
 * literals; the other twelve slips in the list can be faker's problem. A
 * random value in an assertion position makes a failure unreadable.
 *
 * The factories return the *structural* shapes the functions under test
 * declare, not database row types. That is deliberate: those functions name
 * only the fields they read, so a fixture that satisfies them is a complete
 * fixture, and no cast is needed to pretend otherwise. Before the migration
 * these had to be cast through `unknown` to InstaQL entities — every one of
 * those casts was a place a schema change could break a test silently.
 */

export interface RoleFixture {
  name: string;
  allow?: string[];
  deny?: string[];
}

export function aRole(over: Partial<RoleFixture> = {}): RoleFixture {
  return { name: faker.person.jobTitle(), allow: [], deny: [], ...over };
}

export interface ContactFixture {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  merged_into_id?: string | null;
}

export function aContact(over: Partial<ContactFixture> = {}): ContactFixture {
  return {
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    phone: faker.phone.number({ style: "national" }),
    email: faker.internet.email(),
    merged_into_id: null,
    ...over,
  };
}

export function anAsset(over: Partial<AssetLike> = {}): AssetLike {
  return { name: faker.commerce.productName(), ...over };
}

export function aMeterReading(
  over: Partial<MeterReadingLike> = {},
): MeterReadingLike {
  return {
    value: 0,
    timestamp: new Date("2026-01-01T00:00:00Z").getTime(),
    ...over,
  };
}

export function aTicket(over: Partial<TicketLike> = {}): TicketLike {
  return {
    title: faker.lorem.sentence(),
    auto_generated: 1,
    created_at: new Date("2026-01-01T00:00:00Z").getTime(),
    ...over,
  };
}

export interface LocationFixture {
  id: string;
  name: string;
  parent_id?: string | null;
}

export function aLocation(over: Partial<LocationFixture> = {}): LocationFixture {
  return {
    id: faker.string.uuid(),
    name: faker.location.street(),
    parent_id: null,
    ...over,
  };
}

export function aCheckpoint(
  over: Partial<{
    id: string;
    name: string;
    location_id: string | null;
    location_name: string | null;
  }> = {},
) {
  return {
    id: faker.string.uuid(),
    name: faker.lorem.word(),
    location_id: null,
    location_name: null,
    ...over,
  };
}
