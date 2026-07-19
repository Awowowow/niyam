export type PolicyLanguage = "en" | "hi";

export interface AmbiguityIssue {
  code: string;
  severity: "blocking" | "warning";
  term?: string;
  message: string;
  resolution: string;
  sourceExcerpt: string;
}

export interface PolicyVersion {
  id: string;
  sequence: number;
  policyText: string;
  effectiveFrom: string;
  effectiveTo?: string;
  amendmentNote: string;
  codeRevision: string;
  documentHash: string;
  status: "superseded" | "active" | "scheduled" | "rolled-back";
  approvals: Array<{
    id: string;
    name: string;
    role: "policy-owner" | "engineer";
    approvedAt: string;
  }>;
}

export interface PolicyCiWorkspace {
  category: "Policy CI";
  thesis: string;
  versions: PolicyVersion[];
  activeVersion: PolicyVersion;
  population: SyntheticApplicant[];
  repairs: RepairResult[];
  adapters: Array<{ kind: string; status: string; evidence: string }>;
  signing: { algorithm: string; keySource: string };
  claims: {
    syntheticImpactOnly: boolean;
    universalFormalProof: boolean;
    autonomousProductionDeployment: boolean;
  };
}

export interface NiyamCapabilities {
  mode: "judge" | "development";
  status: "live-ai-configured" | "judge-mode-blocked" | "safe-local-fallback";
  provider: "amazon-bedrock";
  backend?: "bedrock-chat" | "codex";
  model: string;
  codexVersion?: string;
  policyExtraction: {
    enabled: boolean;
    required: boolean;
    lastSuccessfulAt?: string;
    lastFailure?: string;
  };
  repositoryRepair: { enabled: boolean; required: boolean; model?: string };
  fallbackAllowed: boolean;
  authority: {
    modelMakesEligibilityDecisions: false;
    humanPolicyApprovalRequired: true;
    deterministicVerificationRequired: true;
    automaticMerge: false;
  };
}

export interface PolicyDocumentResult {
  id: string;
  filename: string;
  mimeType: string;
  language: PolicyLanguage;
  pages: Array<{ page: number; text: string }>;
  sourceHash: string;
  extraction: string;
  ambiguities: AmbiguityIssue[];
}

export interface PolicyDraft {
  id: string;
  documentId?: string;
  policyText: string;
  language: PolicyLanguage;
  effectiveFrom: string;
  status: "needs-clarification" | "awaiting-policy-owner" | "approved";
  ambiguities: AmbiguityIssue[];
  textualDiff: string[];
  compilation?: {
    extractedRules: Array<{ id: string; label: string; expression: string }>;
    extraction?: {
      mode:
        "bedrock-chat" | "bedrock-codex" | "deterministic-supported-grammar";
      provider: "amazon-bedrock" | "local-validator";
      model?: string;
      summary: string;
      humanApprovalRequired: true;
    };
    parameters: {
      incomeCap: number;
      standardAgeLimit: number;
      disabilityRelaxationYears: number;
      disabilityAgeLimit: number;
    };
  };
  approvedVersionId?: string;
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
}

export interface DraftApprovalResult {
  draft: PolicyDraft;
  version: PolicyVersion;
  impact: ImpactReport;
}

export interface RepairResult {
  runId: string;
  target: "node" | "python";
  mode: "bedrock-chat-agent" | "codex-agent" | "offline-supported-repair";
  ai: {
    used: boolean;
    provider: "amazon-bedrock" | "local-validator";
    model?: string;
    summary: string;
  };
  branch: string;
  commitHash: string;
  sourceTrace: { file: string; line: number; snippet: string; symbol: string };
  patch: string;
  originalReplay: { outcomeCode: string; explanation?: string };
  repairedReplay: { outcomeCode: string; explanation?: string };
  verification: Array<{
    label: string;
    command: string;
    passed: boolean;
    output: string;
  }>;
  adversarialReview: {
    status: "passed" | "counterexample-found";
    method: string;
    adapter: "node" | "python";
    casesGenerated: number;
    policyBranches: { covered: number; total: number };
    counterexamplesFound: number;
    claim: string;
  };
  existingTests: { passed: number; total: number };
  policyTests: { passed: number; total: number };
  preview: { status: string; adapter: string };
  approvals: Array<{
    id: string;
    name: string;
    role: "policy-owner" | "engineer";
    approvedAt: string;
  }>;
  pullRequest: { status: string; url?: string; repository?: string };
}

export interface TimeMachineDecision {
  decisionDate: string;
  governingPolicy: {
    id: string;
    effectiveFrom: string;
    effectiveTo?: string;
    documentHash: string;
    contractHash: string;
    codeRevision: string;
  };
  evaluation: {
    status: string;
    decision?: { code: string; label: string; explanation: string };
  };
}

export interface ComplaintResult {
  id: string;
  language: PolicyLanguage;
  originalComplaint: string;
  transcript: string;
  decisionDate: string;
  extractedFacts: {
    applicant: {
      annualHouseholdIncome: string;
      age: string;
      hasDisability: boolean;
    };
  };
  governingVersion: {
    id: string;
    effectiveFrom: string;
    effectiveTo?: string;
    codeRevision: string;
  };
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

export interface SignedEvidence {
  schemaVersion: "2.0";
  kind: "niyam-proof-carrying-repair";
  integrityHash: string;
  signature: {
    algorithm: "Ed25519";
    signature: string;
    publicKey: string;
    publicKeyFingerprint: string;
    keySource: string;
  };
  signedPayload: Record<string, unknown>;
  filename: string;
  authority: { automaticMerge: false; requiredRoles: string[] };
  approvals: RepairResult["approvals"];
  [key: string]: unknown;
}

export interface EvidenceVerification {
  valid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  fingerprintValid: boolean;
  integrityHash: string;
  algorithm: "Ed25519";
}

const API_URL =
  process.env.NEXT_PUBLIC_NIYAM_API_URL?.replace(/\/$/, "") ?? "/api/niyam";

interface NiyamRequestInit extends RequestInit {
  timeoutMs?: number;
  timeoutMessage?: string;
}

async function request<T>(path: string, init?: NiyamRequestInit): Promise<T> {
  let sessionId = window.sessionStorage.getItem("niyam-runtime-session");
  if (!sessionId) {
    sessionId = `judge_${window.crypto.randomUUID().replaceAll("-", "")}`;
    window.sessionStorage.setItem("niyam-runtime-session", sessionId);
  }
  const {
    timeoutMs = 30_000,
    timeoutMessage = "Niyam did not respond in time. Please retry.",
    ...fetchInit
  } = init ?? {};
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchInit,
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Niyam-Session": sessionId,
        ...fetchInit.headers,
      },
    });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(" ")
      : body?.message;
    throw new Error(message ?? `Niyam returned error ${response.status}`);
  }
  return (await response.json()) as T;
}

export const getPolicyCiWorkspace = () =>
  request<PolicyCiWorkspace>("/v1/policy-ci/workspace", {
    timeoutMs: 2_500,
    timeoutMessage:
      "Policy history and evidence settings could not be confirmed within 2.5 seconds.",
  });

export const getNiyamCapabilities = () =>
  request<NiyamCapabilities>("/v1/policy-ci/capabilities", {
    timeoutMs: 2_500,
    timeoutMessage:
      "The live AI connection could not be confirmed within 2.5 seconds.",
  });

export const resetJudgeWorkspace = () =>
  request<{ status: "reset"; message: string }>("/v1/policy-ci/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });

export const ingestPolicyDocument = (input: {
  filename: string;
  mimeType: "application/pdf" | "text/plain";
  language: PolicyLanguage;
  contentBase64?: string;
  text?: string;
}) =>
  request<PolicyDocumentResult>("/v1/policy-ci/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createPolicyDraft = (input: {
  documentId?: string;
  policyText?: string;
  language: PolicyLanguage;
  effectiveFrom: string;
}) =>
  request<PolicyDraft>("/v1/policy-ci/drafts", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const approvePolicyDraft = (draftId: string) =>
  request<DraftApprovalResult>(`/v1/policy-ci/drafts/${draftId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      approver: {
        id: "live-judge",
        name: "Live policy owner",
        role: "policy-owner",
      },
    }),
  });

export const queryTimeMachine = (input: {
  decisionDate: string;
  applicant: {
    annualHouseholdIncome: number;
    age: number;
    hasDisability: boolean;
  };
}) =>
  request<TimeMachineDecision>("/v1/policy-ci/time-machine/decisions", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const reconstructComplaint = (input: {
  complaint: string;
  language: PolicyLanguage;
  decisionDate: string;
  transcript?: string;
}) =>
  request<ComplaintResult>("/v1/policy-ci/complaints", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const runRepositoryRepair = (
  draftId: string,
  target: "node" | "python",
) =>
  request<RepairResult>("/v1/policy-ci/repairs", {
    method: "POST",
    body: JSON.stringify({ draftId, target }),
    timeoutMs: 45_000,
    timeoutMessage:
      "The live AI repair did not respond within 45 seconds. No code was merged.",
  });

export const approveRepositoryRepair = (
  runId: string,
  role: "policy-owner" | "engineer",
) =>
  request<RepairResult>(`/v1/policy-ci/repairs/${runId}/approvals`, {
    method: "POST",
    body: JSON.stringify({
      approver: {
        id: role === "engineer" ? "live-engineer" : "live-policy-owner",
        name: role === "engineer" ? "Reviewing engineer" : "Policy owner",
        role,
      },
    }),
  });

export const getSignedRepairEvidence = (runId: string) =>
  request<SignedEvidence>(`/v1/policy-ci/repairs/${runId}/evidence`, {
    method: "POST",
    body: JSON.stringify({ publicExport: true }),
  });

export const verifySignedRepairEvidence = (evidence: SignedEvidence) =>
  request<EvidenceVerification>("/v1/policy-ci/evidence/verify", {
    method: "POST",
    body: JSON.stringify({
      payload: evidence.signedPayload,
      signature: evidence.signature.signature,
      publicKey: evidence.signature.publicKey,
      publicKeyFingerprint: evidence.signature.publicKeyFingerprint,
      integrityHash: evidence.integrityHash,
    }),
  });

export const publishRepairPullRequest = (runId: string, repository: string) =>
  request<RepairResult>(`/v1/policy-ci/repairs/${runId}/publish`, {
    method: "POST",
    body: JSON.stringify({
      repository,
      baseBranch: "main",
      confirmPublish: true,
    }),
  });

export const rollbackPolicyVersion = (versionId: string) =>
  request<Record<string, unknown>>(
    `/v1/policy-ci/versions/${versionId}/rollback`,
    {
      method: "POST",
      body: JSON.stringify({
        approver: {
          id: "rollback-policy-owner",
          name: "Policy owner",
          role: "policy-owner",
        },
      }),
    },
  );
