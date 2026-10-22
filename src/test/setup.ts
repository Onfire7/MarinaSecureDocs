import { faker } from "@faker-js/faker";
import { beforeEach } from "vitest";
import { applyMarinaLanguage, applyUserLanguage } from "../i18n";

// Faker is seeded before every test so a failure reproduces exactly. Random
// test data that can't be replayed turns a red build into an investigation.
beforeEach(() => {
  faker.seed(20260825);
});

// Copy is asserted in English. Pinned rather than resolved, so a developer
// whose machine speaks another language gets the same results as CI.
applyUserLanguage("en");
applyMarinaLanguage("en");
