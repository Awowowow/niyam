import { describe, expect, it } from "vitest";
import { parsePolicyRule } from "../src";

const validPolicy = {
  schemaVersion: "1.0",
  id: "test.income",
  version: 1,
  name: "Income cap",
  description: "Income is at or below the cap.",
  jurisdiction: "Test",
  effectiveFrom: "2026-07-01",
  citation: {
    documentName: "Test policy",
    section: "1",
    quote: "Income must be up to and including INR 250,000.",
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
    onPass: { code: "YES", label: "Yes", explanation: "Pass" },
    onFail: { code: "NO", label: "No", explanation: "Fail" },
  },
  approved: {
    status: "human-approved",
    approvedBy: "Policy owner",
    approvedAt: "2026-07-15T18:30:00.000+00:00",
  },
} as const;

describe("Policy IR", () => {
  it("accepts a cited, human-approved policy contract", () => {
    const policy = parsePolicyRule(validPolicy);
    expect(policy.condition).toMatchObject({ operator: "lte" });
    expect(policy.citation.quote).toContain("including");
  });

  it("refuses an AI draft that a human has not approved", () => {
    const draft = {
      ...validPolicy,
      approved: { ...validPolicy.approved, status: "ai-drafted" },
    };
    expect(() => parsePolicyRule(draft)).toThrow();
  });
});
