import { describe, expect, it } from "vitest";
import {
  compileScholarshipPolicyParameters,
  compileScholarshipPolicyText,
  generateCompoundScholarshipCases,
} from "../src/demo/policy-compiler";

describe("judge-controlled policy compiler", () => {
  it("extracts a cited compound policy and generates interaction evidence", () => {
    const result = compileScholarshipPolicyText(
      "Applicants with annual household income up to and including INR 437,500 are eligible. Applicants must be 27 years old or younger. Applicants with disabilities receive a 4 year age relaxation.",
    );
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.parameters).toEqual({
      incomeCap: 437500,
      standardAgeLimit: 27,
      disabilityRelaxationYears: 4,
      disabilityAgeLimit: 31,
    });
    expect(result.extractedRules.map((rule) => rule.expression)).toEqual([
      "income ≤ INR 4,37,500",
      "age ≤ 27",
      "disability = true → age ≤ 31",
    ]);
    const cases = generateCompoundScholarshipCases(result);
    expect(cases).toHaveLength(8);
    expect(
      cases.find((item) => item.id.endsWith("double-boundary")),
    ).toMatchObject({
      expected: { outcomeCode: "ELIGIBLE" },
    });
  });

  it("returns explicit ambiguity evidence when required terms are absent", () => {
    const result = compileScholarshipPolicyText(
      "Applicants with reasonable income may qualify in exceptional cases.",
    );
    expect(result.status).toBe("needs-clarification");
    if (result.status !== "needs-clarification") return;
    expect(result.ambiguities.map((issue) => issue.code)).toEqual([
      "MISSING_INCOME_CAP",
      "MISSING_AGE_LIMIT",
      "MISSING_RELAXATION",
    ]);
  });

  it.each([
    [
      "Applicants with annual household income at or below INR 425,000 qualify. Applicants are no older than 26 years. A documented disability extends the age limit by 5 years.",
      425000,
      26,
      5,
    ],
    [
      "Annual household income must be not more than INR 480,000. Applicants may be at most 28 years old. A documented disability increases the age ceiling by 3 years.",
      480000,
      28,
      3,
    ],
    [
      "Annual family income can be no more than INR 390,000. Applicants must be 24 years old or below. A documented disability raises the age limit by 4 years.",
      390000,
      24,
      4,
    ],
    [
      "Household income must not exceed INR 512,000. Candidates are eligible through age 29. A documented disability adds 6 years to that limit.",
      512000,
      29,
      6,
    ],
    [
      "Family income may not exceed INR 600,000. Applicants are not older than 30 years. A documented disability grants 5 years to the age limit.",
      600000,
      30,
      5,
    ],
    [
      "Household earnings do not exceed INR 475,000. The maximum age is 27 years. Applicants with disabilities receive an additional 4 years of age relaxation.",
      475000,
      27,
      4,
    ],
    [
      "Annual income can not exceed INR 365,000. The max age is 23. Persons with a disability are granted 3 years of age allowance.",
      365000,
      23,
      3,
    ],
    [
      "Annual earnings cannot exceed INR 720,000. The standard age limit is 31 years inclusive. Students with disabilities get 2 years of age relaxation.",
      720000,
      31,
      2,
    ],
    [
      "The maximum annual household income is INR 550,000. Applicants must be 32 years or less. Candidates with a disability receive 7 years of age relaxation.",
      550000,
      32,
      7,
    ],
    [
      "Max family income: INR 410,000. Eligible up to age 22. Applicants with disabilities receive a 5 year age relaxation.",
      410000,
      22,
      5,
    ],
    [
      "Annual household income is INR 530,000 or less. Age must not exceed 28 years. A documented disability extends the age limit by 3 years.",
      530000,
      28,
      3,
    ],
    [
      "Annual earnings are INR 460,000 or below. No older than 25 years. A documented disability increases the age limit by 5 years.",
      460000,
      25,
      5,
    ],
    [
      "The income cap is INR 340,000. Applicants must be 21 years old or younger. A documented disability raises the age ceiling by 4 years.",
      340000,
      21,
      4,
    ],
    [
      "Income ceiling: INR 675,000. Applicants are no older than 33. A documented disability adds 8 years to that limit.",
      675000,
      33,
      8,
    ],
    [
      "Income may not exceed ₹512,000. Candidates are eligible through age 29. Applicants with disabilities receive 6 years of relaxation.",
      512000,
      29,
      6,
    ],
    [
      "Income does not exceed ₹700,000. Maximum standard age: 35 years. Applicants with disabilities are granted 5 years of age relaxation.",
      700000,
      35,
      5,
    ],
    [
      "Earnings must not exceed ₹455,000. At most 24 years old. Persons with disabilities get an additional 4 years of age allowance.",
      455000,
      24,
      4,
    ],
    [
      "No more than ₹800,000 in annual income. Applicants must be 36 years or below. Students with a disability receive 3 years of age relaxation.",
      800000,
      36,
      3,
    ],
    [
      "Not more than INR 620,000 in household earnings. The age limit is 34 inclusive. A documented disability extends the age limit by 6 years.",
      620000,
      34,
      6,
    ],
    [
      "Applicants qualify with income at or below ₹333,333. Applicants must be 20 years old or younger. Applicants with a disability receive a 2 year age relaxation.",
      333333,
      20,
      2,
    ],
  ])(
    "accepts safe inclusive paraphrase %#",
    (policyText, incomeCap, standardAgeLimit, relaxation) => {
      const result = compileScholarshipPolicyText(policyText as string);
      expect(result.status, JSON.stringify(result)).toBe("compiled");
      if (result.status !== "compiled") return;
      expect(result.parameters).toMatchObject({
        incomeCap,
        standardAgeLimit,
        disabilityRelaxationYears: relaxation,
      });
    },
  );

  it.each([
    "Applicants with income under INR 400,000 qualify. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Applicants with income less than INR 400,000 qualify. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Applicants with income below INR 400,000 qualify. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed 400,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Applicants with approximately INR 400,000 income qualify. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be younger than 25. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be under 25 years old. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be below 25 years old. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. The maximum age applies. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000 and income must not exceed INR 500,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be 25 years old or younger and 26 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 4 year age relaxation or a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be 25 years old or younger.",
    "Income must not exceed INR 400,000. Applicants must be 25 years old or younger. Disability exceptions may be considered.",
    "Income must not exceed INR 400,000. Applicants must be 150 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 400,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 60 year age relaxation.",
    "Income must not exceed INR 50,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Income must not exceed INR 20,000,000. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.",
    "Employees may qualify after a reasonable review by the committee.",
  ])("stops on ambiguous or unsafe wording %#", (policyText) => {
    expect(compileScholarshipPolicyText(policyText).status).toBe(
      "needs-clarification",
    );
  });

  it("turns cited live-AI parameters into a deterministic contract", () => {
    const policyText =
      "Income may not exceed ₹512,000. Candidates are eligible through age 29. A documented disability adds 6 years to that limit.";
    const result = compileScholarshipPolicyParameters({
      policyText,
      approvedBy: "Awaiting policy-owner approval",
      incomeCap: 512000,
      standardAgeLimit: 29,
      disabilityRelaxationYears: 6,
      sourceRules: [
        {
          parameter: "income-cap",
          sourceText: "Income may not exceed ₹512,000.",
          confidence: 0.98,
        },
        {
          parameter: "standard-age-limit",
          sourceText: "Candidates are eligible through age 29.",
          confidence: 0.96,
        },
        {
          parameter: "disability-age-relaxation",
          sourceText: "A documented disability adds 6 years to that limit.",
          confidence: 0.93,
        },
      ],
      extraction: {
        mode: "bedrock-codex",
        provider: "amazon-bedrock",
        model: "openai.gpt-5.5",
        summary: "Three cited rules extracted.",
      },
    });
    expect(result.status).toBe("compiled");
    if (result.status !== "compiled") return;
    expect(result.extraction.mode).toBe("bedrock-codex");
    expect(result.policy.citation.quote).toBe(policyText);
    expect(result.parameters).toMatchObject({
      incomeCap: 512000,
      standardAgeLimit: 29,
      disabilityRelaxationYears: 6,
      disabilityAgeLimit: 35,
    });
    expect(result.extractedRules[0]?.sourceText).toContain("₹512,000");
  });

  it("rejects a live-AI citation that is not in the submitted policy", () => {
    const policyText =
      "Income may not exceed ₹512,000. Candidates are eligible through age 29. A documented disability adds 6 years to that limit.";
    const result = compileScholarshipPolicyParameters({
      policyText,
      approvedBy: "Awaiting policy-owner approval",
      incomeCap: 512000,
      standardAgeLimit: 29,
      disabilityRelaxationYears: 6,
      sourceRules: [
        {
          parameter: "income-cap",
          sourceText: "Income may not exceed ₹999,000.",
          confidence: 0.98,
        },
        {
          parameter: "standard-age-limit",
          sourceText: "Candidates are eligible through age 29.",
          confidence: 0.96,
        },
        {
          parameter: "disability-age-relaxation",
          sourceText: "A documented disability adds 6 years to that limit.",
          confidence: 0.93,
        },
      ],
      extraction: {
        mode: "bedrock-chat",
        provider: "amazon-bedrock",
        model: "test-model",
        summary: "Test extraction.",
      },
    });
    expect(result.status).toBe("needs-clarification");
    if (result.status !== "needs-clarification") return;
    expect(result.ambiguities[0]?.message).toContain("not found");
  });

  it("rejects duplicate or low-confidence live-AI rules", () => {
    const policyText =
      "Income may not exceed ₹512,000. Candidates are eligible through age 29. A documented disability adds 6 years to that limit.";
    const result = compileScholarshipPolicyParameters({
      policyText,
      approvedBy: "Awaiting policy-owner approval",
      incomeCap: 512000,
      standardAgeLimit: 29,
      disabilityRelaxationYears: 6,
      sourceRules: [
        {
          parameter: "income-cap",
          sourceText: "Income may not exceed ₹512,000.",
          confidence: 0.98,
        },
        {
          parameter: "income-cap",
          sourceText: "Income may not exceed ₹512,000.",
          confidence: 0.98,
        },
        {
          parameter: "standard-age-limit",
          sourceText: "Candidates are eligible through age 29.",
          confidence: 0.96,
        },
        {
          parameter: "disability-age-relaxation",
          sourceText: "A documented disability adds 6 years to that limit.",
          confidence: 0.4,
        },
      ],
      extraction: {
        mode: "bedrock-chat",
        provider: "amazon-bedrock",
        model: "test-model",
        summary: "Test extraction.",
      },
    });
    expect(result.status).toBe("needs-clarification");
    if (result.status !== "needs-clarification") return;
    expect(result.ambiguities.map((issue) => issue.message).join(" ")).toMatch(
      /more than one.*low confidence/i,
    );
  });
});
