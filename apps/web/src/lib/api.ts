export interface GeneratedCase {
  id: string;
  label: string;
  predicateId: string;
  factPath: string;
  position: "just-below" | "exact" | "just-above";
  facts: {
    applicant: {
      annualHouseholdIncome: string;
      age?: string;
      hasDisability?: boolean;
    };
  };
  expected: {
    outcomeCode: "ELIGIBLE" | "INELIGIBLE";
    outcomeLabel: string;
  };
}

export interface ExtractedRule {
  id: string;
  label: string;
  expression: string;
  sourceText: string;
  confidence: "high";
  status: "awaiting-human-approval";
}

export interface PolicyAmbiguity {
  code: string;
  message: string;
  resolution: string;
}

export interface SolverEvidence {
  status:
    | "counterexamples-found"
    | "no-counterexample-in-bounds"
    | "solver-not-configured"
    | "solver-unavailable";
  engine: "z3-bounded-symbolic-search" | "deterministic-node-fallback";
  claim: string;
  counterexamples: Array<{
    witness: string;
    annual_household_income: number;
    age: number;
    has_disability: boolean;
    policy_outcome: string;
    implementation_outcome: string;
  }>;
}

export interface Scenario {
  title: string;
  problem: string;
  contractHash: string;
  defaultChallengePolicy?: string;
  policy: {
    id: string;
    version: number;
    citation: {
      documentName: string;
      section: string;
      page?: number;
      quote: string;
    };
    approved: {
      approvedBy: string;
      approvedAt: string;
    };
  };
  generatedCases: GeneratedCase[];
  extractedRules?: ExtractedRule[];
  ambiguities?: PolicyAmbiguity[];
  parameters?: {
    incomeCap: number;
    standardAgeLimit: number;
    disabilityRelaxationYears: number;
    disabilityAgeLimit: number;
  };
  counterexampleSearch?: SolverEvidence;
}

export interface VerificationCaseResult {
  caseId: string;
  label?: string;
  position: GeneratedCase["position"];
  expectedOutcomeCode: string;
  actualOutcomeCode: string;
  matched: boolean;
  evidence: {
    implementationExplanation?: string;
  };
}

export interface AuditReport {
  auditId: string;
  verdict: "conformant" | "policy-drift-detected";
  summary: {
    total: number;
    matched: number;
    mismatched: number;
  };
  cases: VerificationCaseResult[];
}

export interface EvidenceNode {
  id: string;
  label: string;
  detail: string;
  status: string;
}

export interface IndependentReview {
  status: "passed" | "counterexample-found";
  method: string;
  engine: string;
  casesGenerated: number;
  policyBranches?: number;
  counterexamplesFound: number;
  claim: string;
  symbolic?: SolverEvidence;
}

export interface RepairPreview {
  status: "ready-for-human-review";
  finding: string;
  proposedChange: {
    title: string;
    minimalPatch: string;
    changedTokens: string[];
  };
  proof: {
    before: AuditReport;
    after: AuditReport;
  };
  independentReview: IndependentReview;
  evidenceGraph: EvidenceNode[];
  safety: {
    execution: string;
    autoMerge: false;
    requiredNextAction: string;
  };
}

export interface ChallengeReadyResponse {
  status: "ready";
  scenario: Scenario;
  audit: AuditReport;
  repairPreview: RepairPreview;
}

export interface ChallengeClarificationResponse {
  status: "needs-clarification";
  extractedRules: ExtractedRule[];
  ambiguities: PolicyAmbiguity[];
}

export type ChallengeResponse =
  ChallengeReadyResponse | ChallengeClarificationResponse;

export interface EvidencePackage {
  schemaVersion: "1.0";
  kind: "niyam-proof-carrying-repair";
  createdAt: string;
  integrityHash: string;
  filename: string;
  authority: {
    automaticMerge: false;
    requiredAction: string;
  };
  pullRequestDraft: {
    branch: string;
    title: string;
    status: "draft-not-pushed";
  };
  [key: string]: unknown;
}

const API_URL =
  process.env.NEXT_PUBLIC_NIYAM_API_URL?.replace(/\/$/, "") ?? "/api/niyam";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Niyam API returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getScenario(): Promise<Scenario> {
  return apiRequest<Scenario>("/v1/demo");
}

export function runAudit(): Promise<AuditReport> {
  return apiRequest<AuditReport>("/v1/demo/audits", { method: "POST" });
}

export function getRepairPreview(): Promise<RepairPreview> {
  return apiRequest<RepairPreview>("/v1/demo/repair-preview", {
    method: "POST",
  });
}

export function runJudgeChallenge(
  policyText: string,
): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>("/v1/demo/challenges", {
    method: "POST",
    body: JSON.stringify({ policyText, approvedBy: "Hackathon judge" }),
  });
}

export function getEvidencePackage(): Promise<EvidencePackage> {
  return apiRequest<EvidencePackage>("/v1/demo/evidence-package", {
    method: "POST",
  });
}
