import { describe, expect, it } from "vitest";
import { parsePolicyRule } from "@niyam/policy-ir";
import { evaluatePolicy } from "../src";

const policy = parsePolicyRule({
  schemaVersion: "1.0",
  id: "test.income",
  version: 1,
  name: "Income cap",
  description: "Income is at or below the cap.",
  jurisdiction: "Test",
  effectiveFrom: "2026-07-01",
  citation: {
    documentName: "Test",
    section: "1",
    quote: "Up to and including 250000",
  },
  condition: {
    type: "predicate",
    id: "income-cap",
    fact: {
      path: "income",
      label: "Income",
      dataType: "money",
      currency: "INR",
    },
    operator: "lte",
    value: { type: "money", amount: "250000", currency: "INR" },
  },
  outcomes: {
    onPass: { code: "ELIGIBLE", label: "Eligible", explanation: "Pass" },
    onFail: { code: "INELIGIBLE", label: "Not eligible", explanation: "Fail" },
  },
  approved: {
    status: "human-approved",
    approvedBy: "Owner",
    approvedAt: "2026-07-15T18:30:00.000+00:00",
  },
});

describe("deterministic rule engine", () => {
  it("includes the exact policy threshold", () => {
    const result = evaluatePolicy(policy, { income: "250000" });
    expect(result).toMatchObject({
      status: "evaluated",
      passed: true,
      decision: { code: "ELIGIBLE" },
    });
  });

  it("rejects one rupee above the threshold", () => {
    const result = evaluatePolicy(policy, { income: "250001" });
    expect(result).toMatchObject({
      status: "evaluated",
      passed: false,
      decision: { code: "INELIGIBLE" },
    });
  });

  it("fails closed with evidence when a required fact is absent", () => {
    const result = evaluatePolicy(policy, {});
    expect(result).toMatchObject({
      status: "invalid-input",
      decision: null,
      issues: [{ code: "MISSING_FACT", factPath: "income" }],
    });
  });
});
