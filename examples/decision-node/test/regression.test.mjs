import test from "node:test";
import assert from "node:assert/strict";
import { decideScholarship } from "../src/eligibility.mjs";

test("keeps clearly eligible applicants eligible", () => {
  assert.equal(
    decideScholarship({
      annualHouseholdIncome: 200_000,
      age: 24,
      hasDisability: false,
    }).outcomeCode,
    "ELIGIBLE",
  );
});

test("keeps clearly over-income applicants ineligible", () => {
  assert.equal(
    decideScholarship({
      annualHouseholdIncome: 500_000,
      age: 24,
      hasDisability: true,
    }).outcomeCode,
    "INELIGIBLE",
  );
});

test("keeps over-age applicants without an exception ineligible", () => {
  assert.equal(
    decideScholarship({
      annualHouseholdIncome: 200_000,
      age: 40,
      hasDisability: false,
    }).outcomeCode,
    "INELIGIBLE",
  );
});
