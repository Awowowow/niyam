import type { FactMap, PolicyRule } from "@niyam/policy-ir";
import type { CompiledScholarshipPolicy } from "../demo/policy-compiler";

export type SupportedLanguage = "en" | "hi";

export interface AmbiguityIssue {
  code:
    | "UNDEFINED_TERM"
    | "DISCRETIONARY_LANGUAGE"
    | "CONFLICTING_CLAUSES"
    | "MISSING_UNIT"
    | "MISSING_EFFECTIVE_DATE"
    | "CIRCULAR_REFERENCE"
    | "UNCLEAR_EXCEPTION_PRIORITY"
    | "TRANSLATION_MISMATCH"
    | "UNSUPPORTED_RULE";
  severity: "blocking" | "warning";
  term?: string;
  message: string;
  resolution: string;
  sourceExcerpt: string;
}

export interface PolicyDocumentRecord {
  id: string;
  filename: string;
  mimeType: "application/pdf" | "text/plain";
  language: SupportedLanguage;
  text: string;
  pages: Array<{ page: number; text: string }>;
  sourceHash: string;
  extraction: "pypdf" | "utf8" | "inline-text";
  createdAt: string;
}

export interface PolicyDraftRecord {
  id: string;
  documentId?: string;
  policyText: string;
  language: SupportedLanguage;
  effectiveFrom: string;
  createdAt: string;
  status: "needs-clarification" | "awaiting-policy-owner" | "approved";
  ambiguities: AmbiguityIssue[];
  textualDiff: string[];
  compilation?: CompiledScholarshipPolicy;
  approvedVersionId?: string;
}

export interface ApprovalIdentity {
  id: string;
  name: string;
  role: "policy-owner" | "engineer";
}

export interface ApprovalRecord extends ApprovalIdentity {
  approvedAt: string;
  statement: string;
}

export interface PolicyVersionRecord {
  id: string;
  sequence: number;
  policy: PolicyRule;
  policyText: string;
  effectiveFrom: string;
  effectiveTo?: string;
  amendmentOf?: string;
  supersededBy?: string;
  amendmentNote: string;
  codeRevision: string;
  documentHash: string;
  createdAt: string;
  status: "superseded" | "active" | "scheduled" | "rolled-back";
  approvals: ApprovalRecord[];
}

export interface SyntheticApplicant {
  id: string;
  name: string;
  annualHouseholdIncome: number;
  age: number;
  hasDisability: boolean;
  synthetic: true;
}

export interface ImpactReport {
  label: "synthetic-sample-not-real-population";
  populationSize: number;
  gainedEligibility: SyntheticApplicant[];
  lostEligibility: SyntheticApplicant[];
  unchanged: number;
  fromContractHash: string;
  toContractHash: string;
}

export interface CitizenComplaintCase {
  id: string;
  language: SupportedLanguage;
  originalComplaint: string;
  transcript: string;
  decisionDate: string;
  extractedFacts: FactMap;
  governingVersion: Pick<
    PolicyVersionRecord,
    "id" | "effectiveFrom" | "effectiveTo" | "codeRevision"
  >;
  expectedOutcome: string;
  productionOutcome: string;
  disagreement: boolean;
  explanation: string;
  appealDocument: {
    filename: string;
    mimeType: "text/html";
    html: string;
  };
}

export interface SourceTrace {
  file: string;
  line: number;
  snippet: string;
  symbol: string;
}

export interface RepairVerification {
  label: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface AdversarialRepairReview {
  status: "passed" | "counterexample-found";
  method: "independent-bounded-cartesian-search";
  adapter: "node" | "python";
  casesGenerated: number;
  policyBranches: { covered: number; total: number };
  counterexamplesFound: number;
  examples: Array<{
    facts: FactMap;
    expectedOutcome: string;
    actualOutcome: string;
  }>;
  claim: string;
}

export interface RepositoryRepairResult {
  runId: string;
  target: "node" | "python";
  mode: "bedrock-chat-agent" | "codex-agent" | "offline-supported-repair";
  ai: {
    used: boolean;
    provider: "amazon-bedrock" | "local-validator";
    model?: string;
    summary: string;
  };
  workspacePath: string;
  branch: string;
  commitHash: string;
  sourceTrace: SourceTrace;
  patch: string;
  formatPatch: string;
  originalReplay: { outcomeCode: string; explanation?: string };
  repairedReplay: { outcomeCode: string; explanation?: string };
  verification: RepairVerification[];
  adversarialReview: AdversarialRepairReview;
  existingTests: { passed: number; total: number };
  policyTests: { passed: number; total: number };
  preview: {
    status: "verified-isolated-process-preview";
    adapter: "node" | "python";
    replayedCounterexample: true;
  };
  approvals: ApprovalRecord[];
  pullRequest: {
    status: "local-branch" | "published";
    url?: string;
    repository?: string;
  };
  createdAt: string;
}
