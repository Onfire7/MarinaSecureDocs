import { faker } from "@faker-js/faker";
import { beforeEach } from "vitest";

// Faker is seeded before every test so a failure reproduces exactly. Random
// test data that can't be replayed turns a red build into an investigation.
beforeEach(() => {
  faker.seed(20260825);
});
