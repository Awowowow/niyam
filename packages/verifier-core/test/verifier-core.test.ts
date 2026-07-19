import { describe, expect, it } from "vitest";
import { generateBoundaryCases } from "@niyam/boundary-generator";
import { parsePolicyRule, type FactMap } from "@niyam/policy-ir";
import { runDifferentialVerification } from "../src";

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
const cases = generateBoundaryCases(policy, { income: "0" });
const income = (facts: FactMap) => Number(facts.income);
const fixedNow = () => new Date("2026-07-16T00:00:00.000Z");

describe("differential verifier", () => {
  it("isolates the legacy mismatch to the exact boundary", async () => {
    const report = await runDifferentialVerification({
      policy,
      cases,
      implementation: {
        name: "legacy",
        revision: "lt",
        evaluate: (facts) => ({
          outcomeCode: income(facts) < 250000 ? "ELIGIBLE" : "INELIGIBLE",
        }),
      },
      now: fixedNow,
    });
    expect(report.verdict).toBe("policy-drift-detected");
    expect(report.summary).toEqual({ total: 3, matched: 2, mismatched: 1 });
    expect(report.cases.filter((item) => !item.matched)[0]?.position).toBe(
      "exact",
    );
  });

  it("proves the repaired implementation conforms", async () => {
    const report = await runDifferentialVerification({
      policy,
      cases,
      implementation: {
        name: "repair-preview",
        revision: "lte",
        evaluate: (facts) => ({
          outcomeCode: income(facts) <= 250000 ? "ELIGIBLE" : "INELIGIBLE",
        }),
      },
      now: fixedNow,
    });
    expect(report.verdict).toBe("conformant");
    expect(report.summary.mismatched).toBe(0);
  });
});
