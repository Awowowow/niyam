import type { GeneratedCase } from "@niyam/boundary-generator";
import {
  parsePolicyRule,
  type FactMap,
  type PolicyRule,
} from "@niyam/policy-ir";
import { evaluatePolicy } from "@niyam/rule-engine";

export const DEFAULT_CHALLENGE_POLICY =
  "Applicants with annual household income up to and including INR 300,000 are eligible. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5 year age relaxation.";

export interface PolicyAmbiguity {
  code:
    | "MISSING_INCOME_CAP"
    | "MISSING_AGE_LIMIT"
    | "MISSING_RELAXATION"
    | "CONFLICTING_POLICY"
    | "UNSUPPORTED_POLICY"
    | "AI_AMBIGUITY";
  message: string;
  resolution: string;
  sourceText?: string;
}

export interface PolicyExtractionEvidence {
  mode: "bedrock-chat" | "bedrock-codex" | "deterministic-supported-grammar";
  provider: "amazon-bedrock" | "local-validator";
  model?: string;
  summary: string;
  humanApprovalRequired: true;
}

export interface ExtractedPolicyRule {
  id: string;
  label: string;
  expression: string;
  sourceText: string;
  confidence: "high" | "medium";
  status: "awaiting-human-approval";
}

export interface CompiledScholarshipPolicy {
  status: "compiled";
  policy: PolicyRule;
  extractedRules: ExtractedPolicyRule[];
  ambiguities: [];
  extraction: PolicyExtractionEvidence;
  parameters: {
    incomeCap: number;
    standardAgeLimit: number;
    disabilityRelaxationYears: number;
    disabilityAgeLimit: number;
  };
}

export interface PolicyNeedsClarification {
  status: "needs-clarification";
  extractedRules: ExtractedPolicyRule[];
  ambiguities: PolicyAmbiguity[];
  extraction: PolicyExtractionEvidence;
}

export type PolicyCompilation =
  CompiledScholarshipPolicy | PolicyNeedsClarification;

const deterministicExtraction: PolicyExtractionEvidence = {
  mode: "deterministic-supported-grammar",
  provider: "local-validator",
  summary:
    "Supported scholarship terms were parsed locally; live AI extraction is not active.",
  humanApprovalRequired: true,
};

function sentenceContaining(text: string, pattern: RegExp): string {
  return (
    text
      .split(/(?<=[.!?])\s+/)
      .find((sentence) => pattern.test(sentence))
      ?.trim() ?? text.trim()
  );
}

function parseIndianNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

interface NumericRuleMatch {
  value?: number;
  sourceText?: string;
  conflictingValues: number[];
}

const incomePatterns = [
  /(?:up to and including|at or below|not more than|no more than)\s*(?:INR|₹)\s*([\d,]+)/gi,
  /(?:income|earnings)[^.!?;]{0,60}?(?:must|may|does|do|can)\s+not\s+exceed\s*(?:INR|₹)\s*([\d,]+)/gi,
  /(?:income|earnings)[^.!?;]{0,60}?cannot\s+exceed\s*(?:INR|₹)\s*([\d,]+)/gi,
  /(?:maximum|max)\s+(?:annual\s+)?(?:household\s+|family\s+)?(?:income|earnings)\s*(?:(?:is|of)\s+|:\s*)?(?:INR|₹)\s*([\d,]+)/gi,
  /(?:income|earnings)[^.!?;]{0,60}?(?:INR|₹)\s*([\d,]+)\s*(?:or less|or below|maximum|max)\b/gi,
  /(?:income\s+(?:cap|ceiling))\s*(?:is|of|:|equals)?\s*(?:INR|₹)\s*([\d,]+)/gi,
];

const agePatterns = [
  /(?:must be\s*)?(\d{1,3})\s*(?:years? old|years?)\s*(?:or younger|or below|or less)\b/gi,
  /(?:no older than|not older than|at most)\s*(\d{1,3})\s*(?:years? old|years?)?/gi,
  /(?:age|age limit)[^.!?;]{0,40}(?:must|may|does|can)\s+not\s+exceed\s*(\d{1,3})\s*(?:years? old|years?)?/gi,
  /(?:maximum|max)\s+(?:standard\s+)?age(?:\s+limit)?\s*(?:is|of|:)?\s*(\d{1,3})\s*(?:years? old|years?)?/gi,
  /(?:standard\s+)?age\s+limit\s*(?:is|of|:)?\s*(\d{1,3})\s*(?:years? old|years?)?\s*(?:inclusive)?/gi,
  /eligible\s+(?:up to|through)\s+age\s*(\d{1,3})\b/gi,
];

const relaxationPatterns = [
  /(\d{1,2})\s*(?:-|\s)?years?\s+(?:of\s+)?(?:age\s+)?relaxation/gi,
  /disabilit(?:y|ies)[^.!?;]{0,80}?(?:extends?|increases?|raises?)\s+(?:the\s+)?age\s+(?:limit|ceiling)\s+by\s+(\d{1,2})\s*years?/gi,
  /disabilit(?:y|ies)[^.!?;]{0,80}?(?:adds?|grants?)\s+(\d{1,2})\s*years?\s+to\s+(?:the|that)\s+(?:age\s+)?(?:limit|ceiling)/gi,
  /(?:applicants?|persons?|students?|candidates?)\s+with\s+(?:an?\s+)?disabilit(?:y|ies)[^.!?;]{0,80}?(?:receive|receives|are granted|get)\s+(?:an?\s+)?(?:additional\s+)?(\d{1,2})\s*years?(?:\s+of)?\s+(?:age\s+)?(?:relaxation|allowance)/gi,
];

function policySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|;\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractNumericRule(
  text: string,
  context: RegExp,
  patterns: RegExp[],
  exclude?: RegExp,
): NumericRuleMatch {
  const matches: Array<{ value: number; sourceText: string }> = [];
  for (const sentence of policySentences(text)) {
    if (!context.test(sentence) || exclude?.test(sentence)) continue;
    for (const pattern of patterns) {
      for (const match of sentence.matchAll(pattern)) {
        if (!match[1]) continue;
        const value = parseIndianNumber(match[1]);
        if (Number.isFinite(value))
          matches.push({ value, sourceText: sentence });
      }
    }
  }
  const values = Array.from(new Set(matches.map((match) => match.value)));
  return {
    ...(values.length === 1
      ? {
          value: values[0],
          sourceText: matches.find((match) => match.value === values[0])
            ?.sourceText,
        }
      : {}),
    conflictingValues: values.length > 1 ? values : [],
  };
}

export function compileScholarshipPolicyText(
  policyTextInput: string,
  approvedBy = "Policy reviewer",
): PolicyCompilation {
  const policyText = policyTextInput.replace(/\s+/g, " ").trim();
  const income = extractNumericRule(
    policyText,
    /income|earnings/i,
    incomePatterns,
  );
  const age = extractNumericRule(
    policyText,
    /\bage\b|\bold\b|\bolder\b|\byounger\b|\byears?\s+(?:or younger|or below|or less)\b/i,
    agePatterns,
    /disabilit/i,
  );
  const relaxation = extractNumericRule(
    policyText,
    /disabilit/i,
    relaxationPatterns,
  );

  const ambiguities: PolicyAmbiguity[] = [];
  const extractedRules: ExtractedPolicyRule[] = [];

  if (income.conflictingValues.length > 0) {
    ambiguities.push({
      code: "CONFLICTING_POLICY",
      message: "The policy contains conflicting inclusive income caps.",
      resolution:
        "Keep one governing income cap or state which threshold supersedes the other.",
      sourceText: policyText,
    });
  } else if (income.value === undefined) {
    ambiguities.push({
      code: "MISSING_INCOME_CAP",
      message: "Niyam cannot identify an inclusive annual income cap.",
      resolution:
        "State an inclusive maximum, such as ‘up to and including INR 300,000’ or ‘income must not exceed INR 300,000’.",
    });
  } else {
    extractedRules.push({
      id: "income-at-or-below-cap",
      label: "Annual household income",
      expression: `income ≤ INR ${new Intl.NumberFormat("en-IN").format(income.value)}`,
      sourceText:
        income.sourceText ?? sentenceContaining(policyText, /income/i),
      confidence: "high",
      status: "awaiting-human-approval",
    });
  }

  if (age.conflictingValues.length > 0) {
    ambiguities.push({
      code: "CONFLICTING_POLICY",
      message: "The policy contains conflicting standard age limits.",
      resolution:
        "Keep one standard age limit or state which limit supersedes the other.",
      sourceText: policyText,
    });
  } else if (age.value === undefined) {
    ambiguities.push({
      code: "MISSING_AGE_LIMIT",
      message: "Niyam cannot identify the standard applicant age limit.",
      resolution:
        "State an inclusive maximum, such as ‘25 years old or younger’ or ‘no older than 25 years’.",
    });
  } else {
    extractedRules.push({
      id: "standard-age-limit",
      label: "Standard age limit",
      expression: `age ≤ ${age.value}`,
      sourceText:
        age.sourceText ?? sentenceContaining(policyText, /younger|age limit/i),
      confidence: "high",
      status: "awaiting-human-approval",
    });
  }

  if (relaxation.conflictingValues.length > 0) {
    ambiguities.push({
      code: "CONFLICTING_POLICY",
      message: "The policy contains conflicting disability age relaxations.",
      resolution:
        "Keep one disability relaxation or state which exception supersedes the other.",
      sourceText: policyText,
    });
  } else if (relaxation.value === undefined) {
    ambiguities.push({
      code: "MISSING_RELAXATION",
      message:
        "The disability exception is missing or does not define a numeric relaxation.",
      resolution:
        "State the exception explicitly, for example ‘Applicants with disabilities receive a 5 year age relaxation’.",
    });
  } else if (age.value !== undefined) {
    const relaxedAge = age.value + relaxation.value;
    extractedRules.push({
      id: "disability-age-relaxation",
      label: "Disability age exception",
      expression: `disability = true → age ≤ ${relaxedAge}`,
      sourceText:
        relaxation.sourceText ?? sentenceContaining(policyText, /disabilit/i),
      confidence: "high",
      status: "awaiting-human-approval",
    });
  }

  if (
    ambiguities.length > 0 ||
    income.value === undefined ||
    age.value === undefined ||
    relaxation.value === undefined
  ) {
    return {
      status: "needs-clarification",
      extractedRules,
      ambiguities,
      extraction: deterministicExtraction,
    };
  }

  const incomeCap = income.value;
  const standardAgeLimit = age.value;
  const disabilityRelaxationYears = relaxation.value;
  const disabilityAgeLimit = standardAgeLimit + disabilityRelaxationYears;

  if (incomeCap < 100_000 || incomeCap > 10_000_000) {
    return {
      status: "needs-clarification",
      extractedRules,
      ambiguities: [
        {
          code: "MISSING_INCOME_CAP",
          message:
            "The extracted income cap is outside the supported example range.",
          resolution: "Use a cap between INR 100,000 and INR 10,000,000.",
        },
      ],
      extraction: deterministicExtraction,
    };
  }

  if (standardAgeLimit < 1 || standardAgeLimit > 120) {
    return {
      status: "needs-clarification",
      extractedRules,
      ambiguities: [
        {
          code: "MISSING_AGE_LIMIT",
          message: "The extracted age limit is outside the supported range.",
          resolution: "Use an age limit between 1 and 120 years.",
        },
      ],
      extraction: deterministicExtraction,
    };
  }

  if (disabilityRelaxationYears < 1 || disabilityRelaxationYears > 50) {
    return {
      status: "needs-clarification",
      extractedRules,
      ambiguities: [
        {
          code: "MISSING_RELAXATION",
          message:
            "The extracted disability relaxation is outside the supported range.",
          resolution: "Use a relaxation between 1 and 50 years.",
        },
      ],
      extraction: deterministicExtraction,
    };
  }

  const policy = parsePolicyRule({
    schemaVersion: "1.0",
    id: "demo.scholarship.compound-eligibility",
    version: 2,
    name: "Scholarship income and age eligibility",
    description:
      "A reviewer-submitted policy with an inclusive income boundary and a disability age exception.",
    jurisdiction: "Example scholarship program",
    effectiveFrom: "2026-07-01",
    citation: {
      documentName: "Reviewed Niyam Scholarship Policy",
      section: "2.1–2.3 — Eligibility conditions",
      page: 3,
      quote: policyText,
    },
    condition: {
      type: "all",
      conditions: [
        {
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
            amount: String(incomeCap),
            currency: "INR",
          },
        },
        {
          type: "any",
          conditions: [
            {
              type: "predicate",
              id: "standard-age-limit",
              fact: {
                path: "applicant.age",
                label: "Applicant age",
                dataType: "number",
              },
              operator: "lte",
              value: { type: "number", value: String(standardAgeLimit) },
            },
            {
              type: "all",
              conditions: [
                {
                  type: "predicate",
                  id: "has-disability",
                  fact: {
                    path: "applicant.hasDisability",
                    label: "Disability status",
                    dataType: "boolean",
                  },
                  operator: "eq",
                  value: { type: "boolean", value: true },
                },
                {
                  type: "predicate",
                  id: "disability-age-limit",
                  fact: {
                    path: "applicant.age",
                    label: "Applicant age with disability relaxation",
                    dataType: "number",
                  },
                  operator: "lte",
                  value: {
                    type: "number",
                    value: String(disabilityAgeLimit),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    outcomes: {
      onPass: {
        code: "ELIGIBLE",
        label: "Eligible",
        explanation: "The approved income and age conditions are satisfied.",
      },
      onFail: {
        code: "INELIGIBLE",
        label: "Not eligible",
        explanation:
          "At least one approved income or age condition is not satisfied.",
      },
    },
    approved: {
      status: "human-approved",
      approvedBy,
      approvedAt: new Date().toISOString(),
    },
  });

  return {
    status: "compiled",
    policy,
    extractedRules,
    ambiguities: [],
    extraction: deterministicExtraction,
    parameters: {
      incomeCap,
      standardAgeLimit,
      disabilityRelaxationYears,
      disabilityAgeLimit,
    },
  };
}

export function compileScholarshipPolicyParameters(input: {
  policyText: string;
  approvedBy: string;
  incomeCap: number;
  standardAgeLimit: number;
  disabilityRelaxationYears: number;
  sourceRules: Array<{
    parameter:
      "income-cap" | "standard-age-limit" | "disability-age-relaxation";
    sourceText: string;
    confidence: number;
  }>;
  extraction: Omit<PolicyExtractionEvidence, "humanApprovalRequired">;
}): PolicyCompilation {
  const canonical =
    `Applicants with annual household income up to and including INR ${input.incomeCap} are eligible. ` +
    `Applicants must be ${input.standardAgeLimit} years old or younger. ` +
    `Applicants with disabilities receive a ${input.disabilityRelaxationYears} year age relaxation.`;
  const compiled = compileScholarshipPolicyText(canonical, input.approvedBy);
  const extraction: PolicyExtractionEvidence = {
    ...input.extraction,
    humanApprovalRequired: true,
  };
  if (compiled.status !== "compiled") {
    return { ...compiled, extraction };
  }

  const required = [
    "income-cap",
    "standard-age-limit",
    "disability-age-relaxation",
  ] as const;
  const normalizedPolicyText = input.policyText
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-IN");
  const citationIssues: PolicyAmbiguity[] = [];

  for (const parameter of required) {
    const matchingRules = input.sourceRules.filter(
      (rule) => rule.parameter === parameter,
    );
    if (matchingRules.length === 0) {
      citationIssues.push({
        code: "AI_AMBIGUITY",
        message: `Live extraction did not return ${parameter.replaceAll("-", " ")}.`,
        resolution: "Clarify the missing value in the written policy.",
      });
      continue;
    }
    if (matchingRules.length > 1) {
      citationIssues.push({
        code: "AI_AMBIGUITY",
        message: `Live extraction returned more than one ${parameter.replaceAll("-", " ")} rule.`,
        resolution:
          "Remove the conflict or identify which written clause governs.",
      });
      continue;
    }

    const rule = matchingRules[0]!;
    const normalizedSource = rule.sourceText
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("en-IN");
    if (!normalizedSource || !normalizedPolicyText.includes(normalizedSource)) {
      citationIssues.push({
        code: "AI_AMBIGUITY",
        message: `The cited source for ${parameter.replaceAll("-", " ")} was not found in the submitted policy.`,
        resolution:
          "Retry extraction or quote the governing sentence exactly before approval.",
        sourceText: rule.sourceText,
      });
    } else if (rule.confidence < 0.7) {
      citationIssues.push({
        code: "AI_AMBIGUITY",
        message: `Live extraction has low confidence in the ${parameter.replaceAll("-", " ")} rule.`,
        resolution:
          "Rewrite the clause as an explicit inclusive threshold before approval.",
        sourceText: rule.sourceText,
      });
    }
  }

  if (citationIssues.length > 0) {
    return {
      status: "needs-clarification",
      extractedRules: [],
      ambiguities: citationIssues,
      extraction,
    };
  }

  const rulesByParameter = new Map(
    input.sourceRules.map((rule) => [rule.parameter, rule]),
  );

  const sourceFor = (
    parameter:
      "income-cap" | "standard-age-limit" | "disability-age-relaxation",
  ) =>
    rulesByParameter.get(parameter) as NonNullable<
      ReturnType<typeof rulesByParameter.get>
    >;
  const disabilityAgeLimit =
    input.standardAgeLimit + input.disabilityRelaxationYears;
  const extractedRules: ExtractedPolicyRule[] = [
    {
      id: "income-at-or-below-cap",
      label: "Annual household income",
      expression: `income ≤ INR ${new Intl.NumberFormat("en-IN").format(input.incomeCap)}`,
      sourceText: sourceFor("income-cap").sourceText,
      confidence: sourceFor("income-cap").confidence >= 0.9 ? "high" : "medium",
      status: "awaiting-human-approval",
    },
    {
      id: "standard-age-limit",
      label: "Standard age limit",
      expression: `age ≤ ${input.standardAgeLimit}`,
      sourceText: sourceFor("standard-age-limit").sourceText,
      confidence:
        sourceFor("standard-age-limit").confidence >= 0.9 ? "high" : "medium",
      status: "awaiting-human-approval",
    },
    {
      id: "disability-age-relaxation",
      label: "Disability age exception",
      expression: `disability = true → age ≤ ${disabilityAgeLimit}`,
      sourceText: sourceFor("disability-age-relaxation").sourceText,
      confidence:
        sourceFor("disability-age-relaxation").confidence >= 0.9
          ? "high"
          : "medium",
      status: "awaiting-human-approval",
    },
  ];
  const policy = parsePolicyRule({
    ...compiled.policy,
    citation: {
      ...compiled.policy.citation,
      quote: input.policyText.replace(/\s+/g, " ").trim(),
    },
  });

  return {
    ...compiled,
    policy,
    extractedRules,
    extraction,
    parameters: {
      incomeCap: input.incomeCap,
      standardAgeLimit: input.standardAgeLimit,
      disabilityRelaxationYears: input.disabilityRelaxationYears,
      disabilityAgeLimit,
    },
  };
}

function generatedCase(input: {
  policy: PolicyRule;
  id: string;
  label: string;
  predicateId: string;
  factPath: string;
  position: GeneratedCase["position"];
  facts: FactMap;
}): GeneratedCase {
  const evaluation = evaluatePolicy(input.policy, input.facts);
  if (evaluation.status !== "evaluated") {
    throw new Error(`Cannot generate ${input.id}: invalid facts`);
  }
  return {
    id: `${input.policy.id}:${input.id}`,
    label: input.label,
    predicateId: input.predicateId,
    factPath: input.factPath,
    position: input.position,
    facts: input.facts,
    expected: {
      passed: evaluation.passed,
      outcomeCode: evaluation.decision.code,
      outcomeLabel: evaluation.decision.label,
      trace: evaluation.trace,
    },
  };
}

export function generateCompoundScholarshipCases(
  compilation: CompiledScholarshipPolicy,
): GeneratedCase[] {
  const { policy, parameters } = compilation;
  const { incomeCap, standardAgeLimit, disabilityAgeLimit } = parameters;
  const facts = (
    income: number,
    age: number,
    hasDisability: boolean,
  ): FactMap => ({
    applicant: {
      annualHouseholdIncome: String(income),
      age: String(age),
      hasDisability,
    },
  });

  return [
    generatedCase({
      policy,
      id: "income-below",
      label: "Income — one rupee below",
      predicateId: "income-at-or-below-cap",
      factPath: "applicant.annualHouseholdIncome",
      position: "just-below",
      facts: facts(incomeCap - 1, standardAgeLimit - 1, false),
    }),
    generatedCase({
      policy,
      id: "income-exact",
      label: "Income — exact inclusive boundary",
      predicateId: "income-at-or-below-cap",
      factPath: "applicant.annualHouseholdIncome",
      position: "exact",
      facts: facts(incomeCap, standardAgeLimit - 1, false),
    }),
    generatedCase({
      policy,
      id: "income-above",
      label: "Income — one rupee above",
      predicateId: "income-at-or-below-cap",
      factPath: "applicant.annualHouseholdIncome",
      position: "just-above",
      facts: facts(incomeCap + 1, standardAgeLimit - 1, false),
    }),
    generatedCase({
      policy,
      id: "age-exact",
      label: "Standard age — exact boundary",
      predicateId: "standard-age-limit",
      factPath: "applicant.age",
      position: "exact",
      facts: facts(incomeCap - 1, standardAgeLimit, false),
    }),
    generatedCase({
      policy,
      id: "age-above",
      label: "Standard age — one year above",
      predicateId: "standard-age-limit",
      factPath: "applicant.age",
      position: "just-above",
      facts: facts(incomeCap - 1, standardAgeLimit + 1, false),
    }),
    generatedCase({
      policy,
      id: "disability-exception-exact",
      label: "Disability exception — exact relaxed boundary",
      predicateId: "disability-age-limit",
      factPath: "applicant.age",
      position: "exact",
      facts: facts(incomeCap - 1, disabilityAgeLimit, true),
    }),
    generatedCase({
      policy,
      id: "disability-exception-above",
      label: "Disability exception — one year above",
      predicateId: "disability-age-limit",
      factPath: "applicant.age",
      position: "just-above",
      facts: facts(incomeCap - 1, disabilityAgeLimit + 1, true),
    }),
    generatedCase({
      policy,
      id: "double-boundary",
      label: "Interaction — income and disability limits exact",
      predicateId: "compound-boundary-interaction",
      factPath: "applicant",
      position: "exact",
      facts: facts(incomeCap, disabilityAgeLimit, true),
    }),
  ];
}
