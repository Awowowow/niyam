import { compileScholarshipPolicyText } from "../demo/policy-compiler";
import type { AmbiguityIssue, SupportedLanguage } from "./policy-ci.types";

const undefinedTerms = [
  "reasonable",
  "appropriate",
  "exceptional hardship",
  "adequate",
  "suitable",
];

function excerpt(text: string, term: string): string {
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return text.slice(0, 180);
  return text.slice(Math.max(0, index - 45), index + term.length + 90).trim();
}

function addUnique(issues: AmbiguityIssue[], issue: AmbiguityIssue): void {
  if (
    !issues.some(
      (candidate) =>
        candidate.code === issue.code && candidate.term === issue.term,
    )
  ) {
    issues.push(issue);
  }
}

export function analyzePolicyAmbiguity(input: {
  text: string;
  language: SupportedLanguage;
  effectiveFrom?: string;
  translatedText?: string;
  canonicalText?: string;
}): AmbiguityIssue[] {
  const text = input.text.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const issues: AmbiguityIssue[] = [];

  for (const term of undefinedTerms) {
    if (!lower.includes(term)) continue;
    addUnique(issues, {
      code: "UNDEFINED_TERM",
      severity: "blocking",
      term,
      message: `“${term}” is not defined as a measurable condition.`,
      resolution: "Define the evidence, threshold, and decision authority.",
      sourceExcerpt: excerpt(text, term),
    });
  }

  if (
    /\b(may|might|can)\s+be\s+(considered|approved)|विचार किया जा सकता/i.test(
      text,
    )
  ) {
    addUnique(issues, {
      code: "DISCRETIONARY_LANGUAGE",
      severity: "blocking",
      message:
        "The clause grants discretion without naming who decides or how.",
      resolution: "Name the decision authority and measurable conditions.",
      sourceExcerpt: excerpt(text, "may"),
    });
  }

  const caps = Array.from(text.matchAll(/(?:INR|₹)\s*([\d,]+)/gi), (match) =>
    Number(match[1]?.replace(/,/g, "")),
  ).filter(Number.isFinite);
  if (new Set(caps).size > 1 && /eligible/i.test(text)) {
    addUnique(issues, {
      code: "CONFLICTING_CLAUSES",
      severity: "blocking",
      message:
        "Multiple eligibility thresholds appear without an explicit priority.",
      resolution:
        "Identify which threshold supersedes the other and on what date.",
      sourceExcerpt: text.slice(0, 220),
    });
  }

  if (/income.{0,35}\d[\d,]*/i.test(text) && !/(?:INR|₹|rupees?)/i.test(text)) {
    addUnique(issues, {
      code: "MISSING_UNIT",
      severity: "blocking",
      message: "The income threshold has no currency unit.",
      resolution: "State the currency, for example INR 300,000.",
      sourceExcerpt: excerpt(text, "income"),
    });
  }

  if (!input.effectiveFrom) {
    addUnique(issues, {
      code: "MISSING_EFFECTIVE_DATE",
      severity: "warning",
      message: "No effective date was supplied for this policy version.",
      resolution: "Choose the first date on which this rule governs decisions.",
      sourceExcerpt: text.slice(0, 180),
    });
  }

  if (
    /as defined (above|below)|see this clause|इस खंड में परिभाषित/i.test(text)
  ) {
    addUnique(issues, {
      code: "CIRCULAR_REFERENCE",
      severity: "blocking",
      message:
        "The clause references another definition without identifying it.",
      resolution: "Link the exact clause identifier or inline the definition.",
      sourceExcerpt: text.slice(0, 220),
    });
  }

  if (
    /except|unless|relaxation|छूट/i.test(text) &&
    /priority|supersed|override/i.test(text) === false &&
    caps.length > 1
  ) {
    addUnique(issues, {
      code: "UNCLEAR_EXCEPTION_PRIORITY",
      severity: "blocking",
      message:
        "An exception exists, but its priority over the base rule is unclear.",
      resolution:
        "State whether the exception overrides or narrows the base rule.",
      sourceExcerpt: text.slice(0, 220),
    });
  }

  if (input.translatedText) {
    const translatedNumbers = Array.from(
      input.translatedText.matchAll(/[\d,]+/g),
      (match) => Number(match[0].replace(/,/g, "")),
    ).filter((value) => value >= 10);
    const sourceNumbers = Array.from(text.matchAll(/[\d,]+/g), (match) =>
      Number(match[0].replace(/,/g, "")),
    ).filter((value) => value >= 10);
    if (JSON.stringify(sourceNumbers) !== JSON.stringify(translatedNumbers)) {
      addUnique(issues, {
        code: "TRANSLATION_MISMATCH",
        severity: "blocking",
        message:
          "The translated clause changes one or more numeric conditions.",
        resolution:
          "A bilingual policy owner must approve the aligned wording.",
        sourceExcerpt: input.translatedText.slice(0, 220),
      });
    }
  }

  const compilation = compileScholarshipPolicyText(
    input.canonicalText ?? text,
    "ambiguity-analysis",
  );
  if (compilation.status === "needs-clarification") {
    for (const ambiguity of compilation.ambiguities) {
      addUnique(issues, {
        code: "UNSUPPORTED_RULE",
        severity: "blocking",
        term: ambiguity.code,
        message: ambiguity.message,
        resolution: ambiguity.resolution,
        sourceExcerpt: text.slice(0, 220),
      });
    }
  }

  return issues;
}
