import { describe, expect, it } from "vitest";
import { parsePolicyRule } from "@niyam/policy-ir";
import { generateBoundaryCases } from "../src";

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
      path: "applicant.income",
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

describe("boundary case generator", () => {
  it("generates below, exact, and above cases with computed outcomes", () => {
    const cases = generateBoundaryCases(policy, { applicant: { income: "0" } });
    expect(cases.map((item) => item.position)).toEqual([
      "just-below",
      "exact",
      "just-above",
    ]);
    expect(cases.map((item) => item.expected.outcomeCode)).toEqual([
      "ELIGIBLE",
      "ELIGIBLE",
      "INELIGIBLE",
    ]);
    expect(cases[1]?.facts).toEqual({ applicant: { income: "250000" } });
  });
});
