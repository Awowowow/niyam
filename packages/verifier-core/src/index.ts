import { createHash } from "node:crypto";
import type { GeneratedCase } from "@niyam/boundary-generator";
import type { FactMap, JsonValue, PolicyRule } from "@niyam/policy-ir";

export interface ImplementationDecision {
  outcomeCode: string;
  explanation?: string;
  raw?: JsonValue;
}

export type ImplementationEvaluator = (
  facts: FactMap,
) => ImplementationDecision | Promise<ImplementationDecision>;

export interface VerificationCaseResult {
  caseId: string;
  label: string;
  position: GeneratedCase["position"];
  facts: FactMap;
  expectedOutcomeCode: string;
  actualOutcomeCode: string;
  matched: boolean;
  evidence: {
    predicateId: string;
    factPath: string;
    policyTrace: GeneratedCase["expected"]["trace"];
    implementationExplanation?: string;
  };
}

export interface VerificationReport {
  reportVersion: "1.0";
  auditId: string;
  createdAt: string;
  policy: {
    id: string;
    version: number;
    contractHash: string;
    citation: PolicyRule["citation"];
  };
  implementation: {
    name: string;
    revision: string;
  };
  verdict: "conformant" | "policy-drift-detected";
  summary: {
    total: number;
    matched: number;
    mismatched: number;
  };
  cases: VerificationCaseResult[];
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

export function policyContractHash(policy: PolicyRule): string {
  return `sha256:${createHash("sha256").update(canonicalize(policy)).digest("hex")}`;
}

export async function runDifferentialVerification(input: {
  policy: PolicyRule;
  cases: GeneratedCase[];
  implementation: {
    name: string;
    revision: string;
    evaluate: ImplementationEvaluator;
  };
  now?: () => Date;
}): Promise<VerificationReport> {
  const contractHash = policyContractHash(input.policy);
  const results: VerificationCaseResult[] = [];

  for (const generatedCase of input.cases) {
    const actual = await input.implementation.evaluate(generatedCase.facts);
    results.push({
      caseId: generatedCase.id,
      label: generatedCase.label,
      position: generatedCase.position,
      facts: generatedCase.facts,
      expectedOutcomeCode: generatedCase.expected.outcomeCode,
      actualOutcomeCode: actual.outcomeCode,
      matched: generatedCase.expected.outcomeCode === actual.outcomeCode,
      evidence: {
        predicateId: generatedCase.predicateId,
        factPath: generatedCase.factPath,
        policyTrace: generatedCase.expected.trace,
        ...(actual.explanation
          ? { implementationExplanation: actual.explanation }
          : {}),
      },
    });
  }

  const mismatched = results.filter((result) => !result.matched).length;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const auditSeed = `${contractHash}:${input.implementation.revision}:${createdAt}`;
  const auditId = `audit_${createHash("sha256").update(auditSeed).digest("hex").slice(0, 16)}`;

  return {
    reportVersion: "1.0",
    auditId,
    createdAt,
    policy: {
      id: input.policy.id,
      version: input.policy.version,
      contractHash,
      citation: input.policy.citation,
    },
    implementation: {
      name: input.implementation.name,
      revision: input.implementation.revision,
    },
    verdict: mismatched === 0 ? "conformant" : "policy-drift-detected",
    summary: {
      total: results.length,
      matched: results.length - mismatched,
      mismatched,
    },
    cases: results,
  };
}
