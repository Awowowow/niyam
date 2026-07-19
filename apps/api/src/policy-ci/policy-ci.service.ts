import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Scope,
} from "@nestjs/common";
import { REQUEST } from "@nestjs/core";
import type { Request } from "express";
import {
  parsePolicyRule,
  type FactMap,
  type PolicyRule,
} from "@niyam/policy-ir";
import { evaluatePolicy } from "@niyam/rule-engine";
import { policyContractHash } from "@niyam/verifier-core";
import { DemoService } from "../demo/demo.service";
import { PolicyExtractionService } from "../demo/policy-extraction.service";
import {
  compileScholarshipPolicyText,
  type CompiledScholarshipPolicy,
} from "../demo/policy-compiler";
import { legacyCompoundScholarshipDecision } from "../demo/scholarship.policy";
import { analyzePolicyAmbiguity } from "./ambiguity.service";
import { extractPolicyDocument } from "./document.client";
import { EvidenceSigner } from "./evidence-signer";
import type {
  ApprovalIdentity,
  ApprovalRecord,
  CitizenComplaintCase,
  ImpactReport,
  PolicyDocumentRecord,
  PolicyDraftRecord,
  PolicyVersionRecord,
  RepositoryRepairResult,
  SupportedLanguage,
  SyntheticApplicant,
} from "./policy-ci.types";
import { RepositoryRepairService } from "./repository-repair.service";

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function dayBefore(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Date(parsed.getTime() - 86_400_000).toISOString().slice(0, 10);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isApprovalIdentity(value: unknown): value is ApprovalIdentity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ApprovalIdentity>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    (candidate.role === "policy-owner" || candidate.role === "engineer")
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function devanagariToLatin(value: string): string {
  const digits = "०१२३४५६७८९";
  return Array.from(value, (character) => {
    const index = digits.indexOf(character);
    return index < 0 ? character : String(index);
  }).join("");
}

function singleValue(values: number[]): number | undefined {
  const unique = Array.from(new Set(values.filter(Number.isFinite)));
  return unique.length === 1 ? unique[0] : undefined;
}

function canonicalPolicyText(
  policyText: string,
  language: SupportedLanguage,
): string {
  if (language === "en") return policyText;
  const normalized = devanagariToLatin(policyText);
  const clauses = normalized
    .split(/(?<=[.!?।])\s+|;\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const incomeValues: number[] = [];
  const ageValues: number[] = [];
  const relaxationValues: number[] = [];

  for (const clause of clauses) {
    if (
      /आय/.test(clause) &&
      /(?:तक|या कम|से अधिक नहीं|अधिकतम|आय सीमा)/.test(clause)
    ) {
      const currency = clause.match(/(?:INR|₹)\s*([\d,]+)/i)?.[1];
      const lakh = clause.match(/([\d.]+)\s*लाख/)?.[1];
      if (currency) incomeValues.push(Number(currency.replaceAll(",", "")));
      else if (lakh) incomeValues.push(Number(lakh) * 100_000);
    }

    if (/(?:आयु|उम्र)/.test(clause) && !/(?:दिव्यांग|विकलांग)/.test(clause)) {
      const age =
        clause.match(/(\d{1,3})\s*(?:वर्ष|साल)\s*(?:या कम|तक)/)?.[1] ??
        clause.match(
          /(?:आयु|उम्र)[^।;]{0,50}?(\d{1,3})\s*(?:वर्ष|साल)?[^।;]{0,30}?से अधिक नहीं/,
        )?.[1] ??
        clause.match(
          /अधिकतम\s*(?:आयु|उम्र)[^\d]{0,20}(\d{1,3})\s*(?:वर्ष|साल)?/,
        )?.[1] ??
        clause.match(
          /(?:आयु|उम्र)\s*सीमा[^\d]{0,20}(\d{1,3})\s*(?:वर्ष|साल)?/,
        )?.[1];
      if (age) ageValues.push(Number(age));
    }

    if (/(?:दिव्यांग|विकलांग)/.test(clause)) {
      const relaxation =
        clause.match(
          /(\d{1,2})\s*(?:वर्ष|साल)(?:\s+की)?[^।;]{0,35}?(?:छूट|रियायत|बढ़ेगी|बढ़ाया|विस्तार)/,
        )?.[1] ??
        clause.match(/(\d{1,2})\s*अतिरिक्त\s*(?:वर्ष|साल)/)?.[1] ??
        clause.match(/अतिरिक्त\s*(\d{1,2})\s*(?:वर्ष|साल)/)?.[1];
      if (relaxation) relaxationValues.push(Number(relaxation));
    }
  }

  const income = singleValue(incomeValues);
  const age = singleValue(ageValues);
  const relaxation = singleValue(relaxationValues);
  if (!income || age === undefined || relaxation === undefined) {
    return policyText;
  }
  return `Applicants with annual household income up to and including INR ${income} are eligible. Applicants must be ${age} years old or younger. Applicants with disabilities receive a ${relaxation}-year age relaxation.`;
}

interface PolicySessionState {
  documents: Map<string, PolicyDocumentRecord>;
  drafts: Map<string, PolicyDraftRecord>;
  versions: PolicyVersionRecord[];
  repairDraft: Map<string, string>;
  rollbackHistory: Array<Record<string, unknown>>;
  signer: EvidenceSigner;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable({ scope: Scope.REQUEST })
export class PolicyCiService {
  private static readonly sessions = new Map<string, PolicySessionState>();
  private static readonly rateLimits = new Map<string, RateLimitBucket>();
  private readonly session: PolicySessionState;
  private readonly sessionId: string;
  private readonly clientId: string;

  private get documents() {
    return this.session.documents;
  }

  private get drafts() {
    return this.session.drafts;
  }

  private get versions() {
    return this.session.versions;
  }

  private get repairDraft() {
    return this.session.repairDraft;
  }

  private get rollbackHistory() {
    return this.session.rollbackHistory;
  }

  private get signer() {
    return this.session.signer;
  }

  private readonly population: SyntheticApplicant[] = [
    {
      id: "SYN-001",
      name: "Applicant A",
      annualHouseholdIncome: 300_000,
      age: 25,
      hasDisability: false,
      synthetic: true,
    },
    {
      id: "SYN-002",
      name: "Applicant B",
      annualHouseholdIncome: 300_001,
      age: 24,
      hasDisability: false,
      synthetic: true,
    },
    {
      id: "SYN-003",
      name: "Applicant C",
      annualHouseholdIncome: 280_000,
      age: 28,
      hasDisability: true,
      synthetic: true,
    },
    {
      id: "SYN-004",
      name: "Applicant D",
      annualHouseholdIncome: 249_999,
      age: 26,
      hasDisability: false,
      synthetic: true,
    },
    {
      id: "SYN-005",
      name: "Applicant E",
      annualHouseholdIncome: 437_500,
      age: 27,
      hasDisability: true,
      synthetic: true,
    },
    {
      id: "SYN-006",
      name: "Applicant F",
      annualHouseholdIncome: 310_000,
      age: 23,
      hasDisability: false,
      synthetic: true,
    },
    {
      id: "SYN-007",
      name: "Applicant G",
      annualHouseholdIncome: 295_000,
      age: 31,
      hasDisability: true,
      synthetic: true,
    },
    {
      id: "SYN-008",
      name: "Applicant H",
      annualHouseholdIncome: 180_000,
      age: 22,
      hasDisability: false,
      synthetic: true,
    },
  ];

  constructor(
    private readonly demoService: DemoService,
    private readonly policyExtraction: PolicyExtractionService,
    private readonly repositoryRepairs: RepositoryRepairService,
    @Inject(REQUEST) request: Request,
  ) {
    const sessionHeader = request.headers["x-niyam-session"];
    const requestedSession = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    this.sessionId =
      requestedSession && /^[A-Za-z0-9_-]{8,100}$/.test(requestedSession)
        ? requestedSession
        : "public-default";
    const clientHeader = request.headers["x-niyam-client-ip"];
    const requestedClient = Array.isArray(clientHeader)
      ? clientHeader[0]
      : clientHeader;
    this.clientId =
      requestedClient && /^[0-9A-Fa-f:.,\s]{3,100}$/.test(requestedClient)
        ? requestedClient.split(",")[0]!.trim()
        : request.ip || "local";
    const existing = PolicyCiService.sessions.get(this.sessionId);
    this.session = existing ?? {
      documents: new Map<string, PolicyDocumentRecord>(),
      drafts: new Map<string, PolicyDraftRecord>(),
      versions: [],
      repairDraft: new Map<string, string>(),
      rollbackHistory: [],
      signer: new EvidenceSigner(),
    };
    if (!existing) {
      PolicyCiService.sessions.set(this.sessionId, this.session);
      this.seedTimeMachine();
    }
  }

  private enforceRateLimit(
    action: "document" | "extraction" | "repair",
    sessionLimit: number,
    clientLimit: number,
    windowMs: number,
  ): void {
    const now = Date.now();
    const consume = (key: string, limit: number) => {
      const existing = PolicyCiService.rateLimits.get(key);
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : { count: 0, resetAt: now + windowMs };
      if (bucket.count >= limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((bucket.resetAt - now) / 1000),
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many ${action} requests. Try again in ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      bucket.count += 1;
      PolicyCiService.rateLimits.set(key, bucket);
    };
    consume(`${action}:session:${this.sessionId}`, sessionLimit);
    consume(`${action}:client:${this.clientId}`, clientLimit);
    if (PolicyCiService.rateLimits.size > 5_000) {
      for (const [key, bucket] of PolicyCiService.rateLimits) {
        if (bucket.resetAt <= now) PolicyCiService.rateLimits.delete(key);
      }
    }
  }

  private compileOrThrow(
    text: string,
    approvedBy: string,
  ): CompiledScholarshipPolicy {
    const compilation = compileScholarshipPolicyText(text, approvedBy);
    if (compilation.status !== "compiled") {
      throw new Error(
        compilation.ambiguities.map((item) => item.message).join(" "),
      );
    }
    return compilation;
  }

  private seedTimeMachine(): void {
    const seeds = [
      {
        text: "Applicants with annual household income up to and including INR 250,000 are eligible. Applicants must be 25 years old or younger. Applicants with disabilities receive a 3-year age relaxation.",
        from: "2026-01-01",
        to: "2026-03-31",
        note: "Original scholarship rules",
        code: "decision-node@8c2f19a",
      },
      {
        text: "Applicants with annual household income up to and including INR 300,000 are eligible. Applicants must be 25 years old or younger. Applicants with disabilities receive a 3-year age relaxation.",
        from: "2026-04-01",
        to: "2026-06-30",
        note: "April income amendment",
        code: "decision-node@c041b7e",
      },
      {
        text: "Applicants with annual household income up to and including INR 300,000 are eligible. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5-year age relaxation.",
        from: "2026-07-01",
        note: "July disability-relaxation amendment",
        code: "production-income-lt-age-25-no-exception",
      },
    ];
    seeds.forEach((seed, index) => {
      const compilation = this.compileOrThrow(seed.text, "Seeded policy board");
      const documentHash = hash(seed.text);
      const policy = parsePolicyRule({
        ...compilation.policy,
        version: index + 1,
        effectiveFrom: seed.from,
        citation: { ...compilation.policy.citation, contentHash: documentHash },
        approved: {
          status: "human-approved",
          approvedBy: "Seeded policy board",
          approvedAt: `${seed.from}T00:00:00.000+00:00`,
        },
      });
      this.versions.push({
        id: `policy-v${index + 1}`,
        sequence: index + 1,
        policy,
        policyText: seed.text,
        effectiveFrom: seed.from,
        ...(seed.to ? { effectiveTo: seed.to } : {}),
        ...(index ? { amendmentOf: `policy-v${index}` } : {}),
        ...(index < seeds.length - 1
          ? { supersededBy: `policy-v${index + 2}` }
          : {}),
        amendmentNote: seed.note,
        codeRevision: seed.code,
        documentHash,
        createdAt: `${seed.from}T00:00:00.000Z`,
        status: index === seeds.length - 1 ? "active" : "superseded",
        approvals: [
          {
            id: "seed-policy-board",
            name: "Seeded policy board",
            role: "policy-owner",
            approvedAt: `${seed.from}T00:00:00.000Z`,
            statement: "Approved as the governing scholarship policy.",
          },
        ],
      });
    });
  }

  workspace() {
    return {
      category: "Policy CI",
      thesis:
        "Find the person the code got wrong. Repair the system. Prove it.",
      versions: this.versions,
      activeVersion: this.versions.find((item) => item.status === "active"),
      population: this.population,
      repairs: this.repositoryRepairs.list(this.repairDraft.keys()),
      documents: Array.from(this.documents.values()),
      drafts: Array.from(this.drafts.values()).map((draft) => ({
        ...draft,
        compilation: draft.compilation
          ? {
              status: draft.compilation.status,
              extractedRules: draft.compilation.extractedRules,
              parameters: draft.compilation.parameters,
              contractHash: policyContractHash(draft.compilation.policy),
            }
          : undefined,
      })),
      rollbackHistory: this.rollbackHistory,
      adapters: [
        {
          kind: "node",
          status: "implemented",
          evidence: "command execution and source repair",
        },
        {
          kind: "python",
          status: "implemented",
          evidence: "command execution and source repair",
        },
        {
          kind: "openapi",
          status: "implemented",
          evidence: "document-driven operation resolution and HTTP execution",
        },
        {
          kind: "browser",
          status: "implemented",
          evidence: "Playwright form adapter",
        },
      ],
      signing: {
        algorithm: "Ed25519",
        keySource: this.signer.keySource,
      },
      claims: {
        syntheticImpactOnly: true,
        universalFormalProof: false,
        autonomousProductionDeployment: false,
      },
    };
  }

  capabilities() {
    return this.policyExtraction.capabilities();
  }

  async reset() {
    await this.repositoryRepairs.reset(this.repairDraft.keys());
    this.documents.clear();
    this.drafts.clear();
    this.versions.length = 0;
    this.repairDraft.clear();
    this.rollbackHistory.length = 0;
    this.seedTimeMachine();
    return {
      status: "reset",
      message: "The example scholarship case has been restored.",
    };
  }

  async ingestDocument(input: {
    filename: string;
    mimeType: "application/pdf" | "text/plain";
    language: SupportedLanguage;
    contentBase64?: string;
    text?: string;
  }): Promise<
    PolicyDocumentRecord & {
      ambiguities: ReturnType<typeof analyzePolicyAmbiguity>;
    }
  > {
    this.enforceRateLimit("document", 20, 100, 15 * 60_000);
    if (input.language !== "en" && input.language !== "hi") {
      throw new BadRequestException("Document language must be en or hi");
    }
    const extracted = await extractPolicyDocument(input);
    const record: PolicyDocumentRecord = {
      id: id("document"),
      filename: extracted.filename,
      mimeType: extracted.mimeType,
      language: input.language,
      text: extracted.text,
      pages: extracted.pages,
      sourceHash: hash(extracted.text),
      extraction: extracted.extraction,
      createdAt: new Date().toISOString(),
    };
    this.documents.set(record.id, record);
    const canonical = canonicalPolicyText(record.text, record.language);
    return {
      ...record,
      ambiguities: analyzePolicyAmbiguity({
        text: record.text,
        canonicalText: canonical,
        language: record.language,
      }),
    };
  }

  async createDraft(input: {
    documentId?: string;
    policyText?: string;
    language?: SupportedLanguage;
    effectiveFrom?: string;
    translatedText?: string;
  }): Promise<PolicyDraftRecord> {
    this.enforceRateLimit("extraction", 15, 60, 15 * 60_000);
    const document = input.documentId
      ? this.documents.get(input.documentId)
      : undefined;
    if (input.documentId && !document) {
      throw new NotFoundException(
        `Unknown policy document ${input.documentId}`,
      );
    }
    const policyText = input.policyText?.trim() || document?.text;
    if (!policyText) throw new BadRequestException("Policy text is required");
    const language = input.language ?? document?.language ?? "en";
    if (language !== "en" && language !== "hi") {
      throw new BadRequestException("Policy language must be en or hi");
    }
    const canonical = canonicalPolicyText(policyText, language);
    const effectiveFrom = input.effectiveFrom ?? "";
    const ambiguities = analyzePolicyAmbiguity({
      text: policyText,
      canonicalText: canonical,
      language,
      effectiveFrom: effectiveFrom || undefined,
      translatedText: input.translatedText,
    });
    const compilation = await this.policyExtraction.compile({
      policyText,
      canonicalText: canonical,
      language,
      approvedBy: "Awaiting policy-owner approval",
    });
    const active = this.versions.find((item) => item.status === "active");
    const textualDiff = [
      ...(active
        ? active.policyText.split(/(?<=[.!?])\s+/).map((line) => `- ${line}`)
        : []),
      ...policyText.split(/(?<=[.!?])\s+/).map((line) => `+ ${line}`),
    ];
    const blocking = ambiguities.some((item) => item.severity === "blocking");
    const draft: PolicyDraftRecord = {
      id: id("draft"),
      ...(document ? { documentId: document.id } : {}),
      policyText,
      language,
      effectiveFrom,
      createdAt: new Date().toISOString(),
      status:
        blocking || compilation.status !== "compiled"
          ? "needs-clarification"
          : "awaiting-policy-owner",
      ambiguities,
      textualDiff,
      ...(compilation.status === "compiled" ? { compilation } : {}),
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  approveDraft(
    draftId: string,
    approver: ApprovalIdentity,
  ): {
    draft: PolicyDraftRecord;
    version: PolicyVersionRecord;
    impact: ImpactReport;
  } {
    const draft = this.drafts.get(draftId);
    if (!draft) throw new NotFoundException(`Unknown policy draft ${draftId}`);
    if (!isApprovalIdentity(approver)) {
      throw new BadRequestException(
        "A named policy-owner approval identity is required",
      );
    }
    if (draft.status === "approved") {
      throw new BadRequestException("This policy draft is already approved");
    }
    if (approver.role !== "policy-owner") {
      throw new BadRequestException(
        "Only a policy owner can approve an interpretation",
      );
    }
    if (!isIsoDate(draft.effectiveFrom)) {
      throw new BadRequestException(
        "A valid effective date is required before approval",
      );
    }
    if (draft.ambiguities.some((item) => item.severity === "blocking")) {
      throw new BadRequestException(
        "Blocking policy ambiguities remain unresolved",
      );
    }
    if (!draft.compilation)
      throw new BadRequestException("Draft has no executable contract");
    const previous = this.versions.find((item) => item.status === "active");
    const sequence =
      Math.max(...this.versions.map((item) => item.sequence)) + 1;
    const approvedAt = new Date().toISOString();
    const documentHash = draft.documentId
      ? (this.documents.get(draft.documentId)?.sourceHash ??
        hash(draft.policyText))
      : hash(draft.policyText);
    const policy = parsePolicyRule({
      ...draft.compilation.policy,
      version: sequence,
      effectiveFrom: draft.effectiveFrom,
      citation: {
        ...draft.compilation.policy.citation,
        quote: draft.policyText,
        contentHash: documentHash,
      },
      approved: {
        status: "human-approved",
        approvedBy: `${approver.name} (${approver.id})`,
        approvedAt,
      },
    });
    draft.compilation = { ...draft.compilation, policy };
    const today = new Date().toISOString().slice(0, 10);
    const activeNow = draft.effectiveFrom <= today;
    if (previous && activeNow) {
      previous.status = "superseded";
      previous.effectiveTo = dayBefore(draft.effectiveFrom);
      previous.supersededBy = `policy-v${sequence}`;
    }
    const approval: ApprovalRecord = {
      ...approver,
      approvedAt,
      statement:
        "Approved the cited executable interpretation and effective date.",
    };
    const version: PolicyVersionRecord = {
      id: `policy-v${sequence}`,
      sequence,
      policy,
      policyText: draft.policyText,
      effectiveFrom: draft.effectiveFrom,
      ...(previous ? { amendmentOf: previous.id } : {}),
      amendmentNote: "Reviewer-approved policy change",
      codeRevision: "awaiting-verified-repair",
      documentHash,
      createdAt: approvedAt,
      status: activeNow ? "active" : "scheduled",
      approvals: [approval],
    };
    this.versions.push(version);
    draft.status = "approved";
    draft.approvedVersionId = version.id;
    return {
      draft,
      version,
      impact: this.impactBetween(previous?.policy ?? policy, policy),
    };
  }

  private decision(policy: PolicyRule, person: SyntheticApplicant): string {
    const evaluation = evaluatePolicy(policy, {
      applicant: {
        annualHouseholdIncome: String(person.annualHouseholdIncome),
        age: String(person.age),
        hasDisability: person.hasDisability,
      },
    });
    if (evaluation.status !== "evaluated") return "INVALID_FACTS";
    return evaluation.decision.code;
  }

  private impactBetween(from: PolicyRule, to: PolicyRule): ImpactReport {
    const gainedEligibility: SyntheticApplicant[] = [];
    const lostEligibility: SyntheticApplicant[] = [];
    let unchanged = 0;
    for (const person of this.population) {
      const before = this.decision(from, person);
      const after = this.decision(to, person);
      if (before === after) unchanged += 1;
      else if (after === "ELIGIBLE") gainedEligibility.push(person);
      else lostEligibility.push(person);
    }
    return {
      label: "synthetic-sample-not-real-population",
      populationSize: this.population.length,
      gainedEligibility,
      lostEligibility,
      unchanged,
      fromContractHash: policyContractHash(from),
      toContractHash: policyContractHash(to),
    };
  }

  impact(input: {
    fromVersionId: string;
    toVersionId?: string;
    draftId?: string;
  }): ImpactReport {
    const from = this.versions.find((item) => item.id === input.fromVersionId);
    if (!from)
      throw new NotFoundException(
        `Unknown policy version ${input.fromVersionId}`,
      );
    const toVersion = input.toVersionId
      ? this.versions.find((item) => item.id === input.toVersionId)
      : undefined;
    const draft = input.draftId ? this.drafts.get(input.draftId) : undefined;
    const toPolicy = toVersion?.policy ?? draft?.compilation?.policy;
    if (!toPolicy)
      throw new NotFoundException("Target policy was not found or compiled");
    return this.impactBetween(from.policy, toPolicy);
  }

  decisionAt(input: {
    decisionDate: string;
    applicant: {
      annualHouseholdIncome: number;
      age: number;
      hasDisability: boolean;
    };
  }) {
    if (!isIsoDate(input.decisionDate)) {
      throw new BadRequestException(
        "decisionDate must be a valid date in YYYY-MM-DD format",
      );
    }
    if (
      !input.applicant ||
      !Number.isFinite(input.applicant.annualHouseholdIncome) ||
      input.applicant.annualHouseholdIncome < 0 ||
      !Number.isInteger(input.applicant.age) ||
      input.applicant.age < 0 ||
      input.applicant.age > 130 ||
      typeof input.applicant.hasDisability !== "boolean"
    ) {
      throw new BadRequestException(
        "Applicant income, age, and disability status must be valid",
      );
    }
    const version = this.versions
      .filter(
        (item) =>
          item.effectiveFrom <= input.decisionDate &&
          (!item.effectiveTo || item.effectiveTo >= input.decisionDate) &&
          item.status !== "rolled-back",
      )
      .sort((left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom),
      )[0];
    if (!version)
      throw new NotFoundException(
        "No policy governed the supplied decision date",
      );
    const facts: FactMap = {
      applicant: {
        annualHouseholdIncome: String(input.applicant.annualHouseholdIncome),
        age: String(input.applicant.age),
        hasDisability: input.applicant.hasDisability,
      },
    };
    const evaluation = evaluatePolicy(version.policy, facts);
    return {
      decisionDate: input.decisionDate,
      governingPolicy: {
        id: version.id,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        documentHash: version.documentHash,
        contractHash: policyContractHash(version.policy),
        codeRevision: version.codeRevision,
      },
      evaluation,
    };
  }

  createComplaint(input: {
    complaint: string;
    language: SupportedLanguage;
    decisionDate: string;
    transcript?: string;
  }): CitizenComplaintCase {
    if (
      typeof input.complaint !== "string" ||
      !input.complaint.trim() ||
      input.complaint.length > 10_000
    ) {
      throw new BadRequestException(
        "Complaint text must contain 1 to 10,000 characters",
      );
    }
    if (input.language !== "en" && input.language !== "hi") {
      throw new BadRequestException("Complaint language must be en or hi");
    }
    const normalized = devanagariToLatin(input.complaint);
    const lakh = normalized.match(/([\d.]+)\s*(?:lakh|लाख)/i);
    const currency = normalized.match(/(?:INR|₹)\s*([\d,]+)/i);
    const bareIncome = normalized.match(/(?:income|आय).*?([\d,]{4,})/i);
    const incomeText = lakh?.[1] ?? currency?.[1] ?? bareIncome?.[1];
    const ageText = normalized.match(/(\d{1,3})\s*(?:years?|वर्ष|साल)/i)?.[1];
    const missingFacts = [
      ...(!incomeText
        ? [input.language === "hi" ? "वार्षिक आय" : "annual income"]
        : []),
      ...(!ageText ? [input.language === "hi" ? "आयु" : "age"] : []),
    ];
    if (missingFacts.length) {
      throw new BadRequestException(
        `${input.language === "hi" ? "आगे बढ़ने से पहले बताएं" : "Before continuing, provide"}: ${missingFacts.join(", ")}. Niyam never invents missing decision facts.`,
      );
    }
    const income = lakh?.[1]
      ? Number(lakh[1]) * 100_000
      : Number(incomeText!.replaceAll(",", ""));
    const age = Number(ageText);
    if (!Number.isFinite(income) || income < 0 || !Number.isInteger(age)) {
      throw new BadRequestException(
        "Income and age must be valid numbers before Niyam can check the decision",
      );
    }
    const hasDisability =
      /(disab|दिव्यांग|विकलांग)/i.test(normalized) &&
      !/(no disability|not disabled|दिव्यांग नहीं|विकलांग नहीं)/i.test(
        normalized,
      );
    const historical = this.decisionAt({
      decisionDate: input.decisionDate,
      applicant: { annualHouseholdIncome: income, age, hasDisability },
    });
    const facts: FactMap = {
      applicant: {
        annualHouseholdIncome: String(income),
        age: String(age),
        hasDisability,
      },
    };
    const expectedOutcome =
      historical.evaluation.status === "evaluated"
        ? historical.evaluation.decision.code
        : "UNRESOLVED";
    const production = legacyCompoundScholarshipDecision(facts);
    const disagreement = expectedOutcome !== production.outcomeCode;
    const explanation =
      input.language === "hi"
        ? disagreement
          ? `आपके निर्णय की तारीख पर लागू नीति के अनुसार परिणाम ${expectedOutcome} होना चाहिए था, लेकिन सॉफ्टवेयर ने ${production.outcomeCode} लौटाया।`
          : `लागू नीति और सॉफ्टवेयर दोनों ने ${expectedOutcome} परिणाम दिया।`
        : disagreement
          ? `The policy governing ${input.decisionDate} requires ${expectedOutcome}, but production returned ${production.outcomeCode}.`
          : `The governing policy and production both returned ${expectedOutcome}.`;
    const complaintId = id("complaint");
    const appealHtml = `<!doctype html><html lang="${input.language}"><meta charset="utf-8"><title>Niyam evidence-backed appeal</title><body><main><h1>${input.language === "hi" ? "निर्णय पुनर्विचार अनुरोध" : "Decision review request"}</h1><p>${escapeHtml(explanation)}</p><h2>${input.language === "hi" ? "साक्ष्य" : "Evidence"}</h2><ul><li>Policy version: ${escapeHtml(historical.governingPolicy.id)}</li><li>Policy hash: ${escapeHtml(historical.governingPolicy.contractHash)}</li><li>Code revision: ${escapeHtml(historical.governingPolicy.codeRevision)}</li><li>Income: INR ${income}</li><li>Age: ${age}</li><li>Disability exception: ${hasDisability}</li></ul><p>This document reports deterministic policy evidence. It is not a legal ruling.</p></main></body></html>`;
    return {
      id: complaintId,
      language: input.language,
      originalComplaint: input.complaint,
      transcript: input.transcript ?? input.complaint,
      decisionDate: input.decisionDate,
      extractedFacts: facts,
      governingVersion: {
        id: historical.governingPolicy.id,
        effectiveFrom: historical.governingPolicy.effectiveFrom,
        effectiveTo: historical.governingPolicy.effectiveTo,
        codeRevision: historical.governingPolicy.codeRevision,
      },
      expectedOutcome,
      productionOutcome: production.outcomeCode,
      disagreement,
      explanation,
      appealDocument: {
        filename: `${complaintId}-appeal-${input.language}.html`,
        mimeType: "text/html",
        html: appealHtml,
      },
    };
  }

  async runRepair(input: {
    draftId: string;
    target: "node" | "python";
  }): Promise<RepositoryRepairResult> {
    this.enforceRateLimit("repair", 5, 20, 60 * 60_000);
    if (input.target !== "node" && input.target !== "python") {
      throw new BadRequestException("Repair target must be node or python");
    }
    const draft = this.drafts.get(input.draftId);
    if (!draft)
      throw new NotFoundException(`Unknown policy draft ${input.draftId}`);
    if (draft.status !== "approved" || !draft.compilation) {
      throw new BadRequestException(
        "The policy owner must approve the contract before repair",
      );
    }
    const result = await this.repositoryRepairs.run({
      target: input.target,
      compilation: draft.compilation,
    });
    this.repairDraft.set(result.runId, draft.id);
    return result;
  }

  approveRepair(
    runId: string,
    identity: ApprovalIdentity,
  ): RepositoryRepairResult {
    if (!this.repairDraft.has(runId)) {
      throw new NotFoundException(`Unknown repair run ${runId}`);
    }
    if (!isApprovalIdentity(identity)) {
      throw new BadRequestException(
        "A named policy-owner or engineer approval identity is required",
      );
    }
    return this.repositoryRepairs.addApproval(runId, {
      ...identity,
      approvedAt: new Date().toISOString(),
      statement:
        identity.role === "policy-owner"
          ? "Confirmed that the repair preserves the approved interpretation."
          : "Confirmed that the patch and verification evidence are safe to review.",
    });
  }

  evidence(runId: string, input: { publicExport?: boolean }) {
    const repair = structuredClone(
      this.repositoryRepairs.get(runId),
    ) as RepositoryRepairResult;
    const draftId = this.repairDraft.get(runId);
    const draft = draftId ? this.drafts.get(draftId) : undefined;
    if (!draft?.compilation)
      throw new NotFoundException("Repair policy evidence is missing");
    const approvalRoles = new Set(repair.approvals.map((item) => item.role));
    if (!approvalRoles.has("policy-owner") || !approvalRoles.has("engineer")) {
      throw new BadRequestException(
        "Policy-owner and engineer approvals are both required before signing evidence",
      );
    }
    if (
      !repair.verification.every((item) => item.passed) ||
      repair.adversarialReview.status !== "passed" ||
      repair.adversarialReview.counterexamplesFound !== 0
    ) {
      throw new BadRequestException(
        "Evidence cannot be signed until every verification check passes",
      );
    }
    const repairPayload = repair as unknown as Record<string, unknown>;
    if (input.publicExport) {
      repairPayload.workspacePath = "[REDACTED_LOCAL_PATH]";
      repair.approvals = repair.approvals.map((approval) => ({
        ...approval,
        id: `redacted:${hash(approval.id).slice(-12)}`,
        name: `${approval.role} approver`,
      }));
    }
    const payload = {
      schemaVersion: "2.0",
      kind: "niyam-proof-carrying-repair",
      createdAt: new Date().toISOString(),
      policy: {
        contract: draft.compilation.policy,
        contractHash: policyContractHash(draft.compilation.policy),
        documentHash: draft.documentId
          ? (this.documents.get(draft.documentId)?.sourceHash ??
            hash(draft.policyText))
          : hash(draft.policyText),
        textualDiff: draft.textualDiff,
      },
      sourceTrace: repair.sourceTrace,
      generatedCounterexample: repair.originalReplay,
      productionRequest: {
        annualHouseholdIncome: draft.compilation.parameters.incomeCap,
        age: draft.compilation.parameters.disabilityAgeLimit,
        hasDisability: true,
      },
      productionResponse: repair.originalReplay,
      patch: repair.patch,
      commitHash: repair.commitHash,
      testsExecuted: repair.verification,
      beforeAfter: {
        before: repair.originalReplay,
        after: repair.repairedReplay,
      },
      independentVerification: {
        existingTests: repair.existingTests,
        generatedPolicyTests: repair.policyTests,
        adversarialReview: repair.adversarialReview,
        allPassed: repair.verification.every((item) => item.passed),
      },
      approvals: repair.approvals,
      pullRequest: repair.pullRequest,
      authority: {
        automaticMerge: false,
        requiredRoles: ["policy-owner", "engineer"],
      },
    };
    const integrityHash = hash(JSON.stringify(payload));
    const signature = this.signer.sign(payload);
    return {
      ...payload,
      signedPayload: payload,
      integrityHash,
      signature,
      filename: `niyam-evidence-${runId}.json`,
    };
  }

  verifyEvidence(input: {
    payload: unknown;
    signature: string;
    publicKey?: string;
    publicKeyFingerprint?: string;
    integrityHash?: string;
  }) {
    const integrityHash = hash(JSON.stringify(input.payload));
    const calculatedFingerprint = input.publicKey
      ? hash(input.publicKey)
      : this.signer.sign({ fingerprintProbe: true }).publicKeyFingerprint;
    const signatureValid = this.signer.verify(
      input.payload,
      input.signature,
      input.publicKey,
    );
    const integrityValid =
      !input.integrityHash || input.integrityHash === integrityHash;
    const fingerprintValid =
      !input.publicKeyFingerprint ||
      input.publicKeyFingerprint === calculatedFingerprint;
    return {
      valid: signatureValid && integrityValid && fingerprintValid,
      signatureValid,
      integrityValid,
      fingerprintValid,
      integrityHash,
      algorithm: "Ed25519",
    };
  }

  async publishPullRequest(
    runId: string,
    input: { repository: string; baseBranch?: string; confirmPublish: boolean },
  ) {
    if (!this.repairDraft.has(runId)) {
      throw new NotFoundException(`Unknown repair run ${runId}`);
    }
    return this.repositoryRepairs.publishPullRequest(runId, input);
  }

  async runJudgeMutation(input: {
    policyText: string;
    approvedBy: string;
  }): Promise<Record<string, unknown>> {
    return this.demoService.challenge(input);
  }

  rollback(versionId: string, approver: ApprovalIdentity) {
    if (!isApprovalIdentity(approver)) {
      throw new BadRequestException(
        "A named policy-owner approval identity is required",
      );
    }
    if (approver.role !== "policy-owner") {
      throw new BadRequestException(
        "Only a policy owner can authorize rollback",
      );
    }
    const target = this.versions.find((item) => item.id === versionId);
    if (!target)
      throw new NotFoundException(`Unknown policy version ${versionId}`);
    const active = this.versions.find((item) => item.status === "active");
    if (active) active.status = "rolled-back";
    target.status = "active";
    target.effectiveTo = undefined;
    const event = {
      id: id("rollback"),
      fromVersion: active?.id,
      toVersion: target.id,
      approvedBy: approver,
      createdAt: new Date().toISOString(),
      automaticCodeRollback: false,
      requiredAction:
        "Engineer must select the matching verified code revision.",
    };
    this.rollbackHistory.push(event);
    return event;
  }
}
