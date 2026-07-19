import { parsePolicyRule, type FactMap } from "@niyam/policy-ir";

export const scholarshipPolicy = parsePolicyRule({
  schemaVersion: "1.0",
  id: "demo.scholarship.income-eligibility",
  version: 1,
  name: "Household income eligibility",
  description:
    "A student passes the income criterion when annual household income is at or below the stated cap.",
  jurisdiction: "Example scholarship program",
  effectiveFrom: "2026-07-01",
  citation: {
    documentName: "Niyam Scholarship Policy Example",
    section: "2.1 — Income criterion",
    page: 3,
    quote: "Annual household income must be up to and including INR 250,000.",
  },
  condition: {
    type: "predicate",
    id: "income-at-or-below-cap",
    fact: {
      path: "applicant.annualHouseholdIncome",
      label: "Annual household income",
      dataType: "money",
      currency: "INR",
    },
    operator: "lte",
    value: {
      type: "money",
      amount: "250000",
      currency: "INR",
    },
  },
  outcomes: {
    onPass: {
      code: "ELIGIBLE",
      label: "Eligible",
      explanation: "The income criterion is satisfied.",
    },
    onFail: {
      code: "INELIGIBLE",
      label: "Not eligible",
      explanation: "Annual household income exceeds the policy cap.",
    },
  },
  approved: {
    status: "human-approved",
    approvedBy: "Example policy owner",
    approvedAt: "2026-07-15T18:30:00.000+00:00",
  },
});

export const scholarshipBaseFacts: FactMap = {
  applicant: {
    annualHouseholdIncome: "250000",
    age: "24",
    hasDisability: false,
  },
};

export interface ScholarshipApplicant {
  income: number;
  age: number;
  hasDisability: boolean;
}

export function applicantFrom(facts: FactMap): ScholarshipApplicant {
  const applicant = facts.applicant;
  if (
    applicant === null ||
    Array.isArray(applicant) ||
    typeof applicant !== "object"
  ) {
    throw new Error("Applicant facts are missing");
  }
  const income = applicant.annualHouseholdIncome;
  const age = applicant.age;
  const hasDisability = applicant.hasDisability;
  if (typeof income !== "number" && typeof income !== "string") {
    throw new Error("Annual household income is missing");
  }
  if (typeof age !== "number" && typeof age !== "string") {
    throw new Error("Applicant age is missing");
  }
  if (typeof hasDisability !== "boolean") {
    throw new Error("Disability status is missing");
  }
  return { income: Number(income), age: Number(age), hasDisability };
}

export function incomeFrom(facts: FactMap): number {
  const applicant = facts.applicant;
  if (
    applicant === null ||
    Array.isArray(applicant) ||
    typeof applicant !== "object"
  ) {
    throw new Error("Applicant facts are missing");
  }
  const income = applicant.annualHouseholdIncome;
  if (typeof income !== "number" && typeof income !== "string") {
    throw new Error("Annual household income is missing");
  }
  return Number(income);
}

export function legacyScholarshipDecision(facts: FactMap): {
  outcomeCode: string;
  explanation: string;
} {
  const income = incomeFrom(facts);
  const eligible = income < 250_000;
  return {
    outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE",
    explanation: `Legacy app evaluated ${income} < 250000 as ${eligible}.`,
  };
}

export function repairedScholarshipDecision(facts: FactMap): {
  outcomeCode: string;
  explanation: string;
} {
  const income = incomeFrom(facts);
  const eligible = income <= 250_000;
  return {
    outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE",
    explanation: `Repair preview evaluated ${income} <= 250000 as ${eligible}.`,
  };
}

export function legacyCompoundScholarshipDecision(facts: FactMap): {
  outcomeCode: string;
  explanation: string;
} {
  const { income, age } = applicantFrom(facts);
  const eligible = income < 250_000 && age <= 25;
  return {
    outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE",
    explanation:
      `Production evaluated income ${income} < 250000 and age ${age} <= 25. ` +
      "The deployed branch has no disability exception.",
  };
}
