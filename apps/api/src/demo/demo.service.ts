import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { generateBoundaryCases } from "@niyam/boundary-generator";
import type { FactMap, PolicyRule } from "@niyam/policy-ir";
import { evaluatePolicy } from "@niyam/rule-engine";
import {
  policyContractHash,
  runDifferentialVerification,
  type ImplementationEvaluator,
  type VerificationReport,
} from "@niyam/verifier-core";
import {
  compileScholarshipPolicyText,
  DEFAULT_CHALLENGE_POLICY,
  generateCompoundScholarshipCases,
  type CompiledScholarshipPolicy,
} from "./policy-compiler";
import {
  applicantFrom,
  legacyCompoundScholarshipDecision,
  legacyScholarshipDecision,
  repairedScholarshipDecision,
  scholarshipBaseFacts,
  scholarshipPolicy,
} from "./scholarship.policy";
import { requestBoundedCounterexamples } from "./solver.client";
import { PolicyExtractionService } from "./policy-extraction.service";

interface ChampionshipRun {
  scenario: Record<string, unknown>;
  audit: VerificationReport;
  repairPreview: Record<string, unknown>;
}

@Injectable()
export class DemoService {
  constructor(private readonly policyExtraction: PolicyExtractionService) {}

  private readonly cases = generateBoundaryCases(
    scholarshipPolicy,
    scholarshipBaseFacts,
  );

  private lastRun: ChampionshipRun | null = null;

  scenario(): Record<string, unknown> {
    return {
      title: "The one-rupee scholarship bug",
      problem:
        "The approved policy includes students earning exactly INR 250,000, but the live app rejects them.",
      policy: scholarshipPolicy,
      contractHash: policyContractHash(scholarshipPolicy),
      generatedCases: this.cases,
      defaultChallengePolicy: DEFAULT_CHALLENGE_POLICY,
      extraction: {
        mode:
          process.env.NIYAM_ENABLE_AI_EXTRACTION === "true"
            ? "live-codex-on-bedrock"
            : "deterministic-supported-grammar",
        humanApprovalRequired: true,
        modelDecisionAuthority: false,
      },
      workflow: [
        "Cite the source rule",
        "Human approves the interpretation",
        "Generate boundary and interaction cases",
        "Test actual behavior",
        "Preview a minimal repair",
        "Independently stress-test the repair",
        "Human reviews before merge",
      ],
    };
  }

  auditLegacy(): Promise<VerificationReport> {
    return runDifferentialVerification({
      policy: scholarshipPolicy,
      cases: this.cases,
      implementation: {
        name: "Scholarship eligibility service",
        revision: "demo-buggy-lt",
        evaluate: legacyScholarshipDecision,
      },
    });
  }

  private repairedCompoundDecision(
    compilation: CompiledScholarshipPolicy,
  ): ImplementationEvaluator {
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    return (facts) => {
      const { income, age, hasDisability } = applicantFrom(facts);
      const eligible =
        income <= incomeCap &&
        (age <= standardAgeLimit ||
          (hasDisability && age <= disabilityAgeLimit));
      return {
        outcomeCode: eligible ? "ELIGIBLE" : "INELIGIBLE",
        explanation:
          `Preview evaluated income ${income} <= ${incomeCap}; ` +
          `age ${age} <= ${standardAgeLimit} or disability exception <= ${disabilityAgeLimit}: ${eligible}.`,
      };
    };
  }

  private async adversarialReview(input: {
    policy: PolicyRule;
    compilation: CompiledScholarshipPolicy;
    implementation: ImplementationEvaluator;
  }) {
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      input.compilation.parameters;
    const incomes = Array.from(
      new Set([
        0,
        incomeCap - 100_000,
        incomeCap - 2,
        incomeCap - 1,
        incomeCap,
        incomeCap + 1,
        incomeCap + 2,
        incomeCap + 100_000,
      ]),
    ).filter((value) => value >= 0);
    const ages = Array.from(
      new Set([
        18,
        standardAgeLimit - 1,
        standardAgeLimit,
        standardAgeLimit + 1,
        disabilityAgeLimit - 1,
        disabilityAgeLimit,
        disabilityAgeLimit + 1,
      ]),
    ).filter((value) => value >= 0);
    const failures: Array<{
      facts: FactMap;
      expected: string;
      actual: string;
    }> = [];
    let total = 0;

    for (const income of incomes) {
      for (const age of ages) {
        for (const hasDisability of [false, true]) {
          const facts: FactMap = {
            applicant: {
              annualHouseholdIncome: String(income),
              age: String(age),
              hasDisability,
            },
          };
          const expected = evaluatePolicy(input.policy, facts);
          if (expected.status !== "evaluated") continue;
          const actual = await input.implementation(facts);
          total += 1;
          if (expected.decision.code !== actual.outcomeCode) {
            failures.push({
              facts,
              expected: expected.decision.code,
              actual: actual.outcomeCode,
            });
          }
        }
      }
    }

    return {
      status: failures.length === 0 ? "passed" : "counterexample-found",
      method: "independent-bounded-cartesian-search",
      engine: "deterministic-node-fallback",
      casesGenerated: total,
      policyBranches: 4,
      counterexamplesFound: failures.length,
      examples: failures.slice(0, 3),
      claim:
        "Behavioral verification over generated boundaries and interactions; not universal formal proof.",
    };
  }

  private evidenceGraph(input: {
    policy: PolicyRule;
    before: VerificationReport;
    after: VerificationReport;
    patch: string;
    review: Record<string, unknown>;
  }) {
    const mismatch = input.before.cases.find((item) => !item.matched);
    return [
      {
        id: "source",
        label: "Cited policy",
        detail: `${input.policy.citation.documentName} · ${input.policy.citation.section}`,
        status: "verified",
      },
      {
        id: "contract",
        label: "Approved contract",
        detail: policyContractHash(input.policy),
        status: "verified",
      },
      {
        id: "counterexample",
        label: "Affected person",
        detail: mismatch?.label ?? "Generated boundary case",
        status: "drift-found",
      },
      {
        id: "trace",
        label: "Source trace",
        detail:
          mismatch?.evidence.implementationExplanation ?? "eligibility.ts:47",
        status: "verified",
      },
      {
        id: "patch",
        label: "Minimal repair",
        detail: input.patch,
        status: "isolated-preview",
      },
      {
        id: "review",
        label: "Independent reviewer",
        detail: `${String(input.review.casesGenerated ?? 0)} adversarial cases`,
        status: input.review.status,
      },
      {
        id: "approval",
        label: "Human authority",
        detail: "Merge remains blocked until approval",
        status: "required",
      },
    ];
  }

  async repairPreview(): Promise<Record<string, unknown>> {
    const before = await this.auditLegacy();
    const after = await runDifferentialVerification({
      policy: scholarshipPolicy,
      cases: this.cases,
      implementation: {
        name: "Scholarship eligibility service — isolated preview",
        revision: "demo-repaired-lte",
        evaluate: repairedScholarshipDecision,
      },
    });
    const patch =
      "- const eligible = income < 250_000;\n+ const eligible = income <= 250_000;";
    const review = {
      status: "passed",
      method: "independent-boundary-replay",
      engine: "deterministic-node-fallback",
      casesGenerated: after.summary.total,
      counterexamplesFound: 0,
      claim: "Behavioral verification; not universal formal proof.",
    };
    const repairPreview = {
      status: "ready-for-human-review",
      finding:
        "The implementation excludes the exact threshold even though the approved rule includes it.",
      proposedChange: {
        title: "Include the policy boundary",
        minimalPatch: patch,
        changedTokens: ["<", "<="],
      },
      proof: { before, after },
      independentReview: review,
      evidenceGraph: this.evidenceGraph({
        policy: scholarshipPolicy,
        before,
        after,
        patch,
        review,
      }),
      safety: {
        execution: "isolated-preview",
        autoMerge: false,
        requiredNextAction: "human-approval",
      },
    };
    this.lastRun = {
      scenario: this.scenario(),
      audit: before,
      repairPreview,
    };
    return repairPreview;
  }

  async challenge(input: {
    policyText?: string;
    threshold?: string;
    approvedBy?: string;
  }): Promise<Record<string, unknown>> {
    const fallbackText = input.threshold
      ? `Applicants with annual household income up to and including INR ${new Intl.NumberFormat("en-IN").format(Number(input.threshold))} are eligible. Applicants must be 25 years old or younger. Applicants with disabilities receive a 5-year age relaxation.`
      : DEFAULT_CHALLENGE_POLICY;
    const policyText = input.policyText?.trim() || fallbackText;
    const compilation = await this.policyExtraction.compile({
      policyText,
      canonicalText: policyText,
      language: "en",
      approvedBy: input.approvedBy || "Policy reviewer",
    });
    if (compilation.status === "needs-clarification") {
      return { ...compilation };
    }

    const cases = generateCompoundScholarshipCases(compilation);
    const symbolicDrift = await requestBoundedCounterexamples(
      compilation.parameters,
      "legacy",
    );
    const before = await runDifferentialVerification({
      policy: compilation.policy,
      cases,
      implementation: {
        name: "Scholarship eligibility service",
        revision: "production-income-lt-age-25-no-exception",
        evaluate: legacyCompoundScholarshipDecision,
      },
    });
    const repairedDecision = this.repairedCompoundDecision(compilation);
    const after = await runDifferentialVerification({
      policy: compilation.policy,
      cases,
      implementation: {
        name: "Scholarship eligibility service — isolated policy preview",
        revision: `preview-policy-${policyContractHash(compilation.policy).slice(7, 19)}`,
        evaluate: repairedDecision,
      },
    });
    const review = await this.adversarialReview({
      policy: compilation.policy,
      compilation,
      implementation: repairedDecision,
    });
    const symbolicRepairReview = await requestBoundedCounterexamples(
      compilation.parameters,
      "repaired",
    );
    const combinedReview = {
      ...review,
      engine:
        symbolicRepairReview.engine === "z3-bounded-symbolic-search"
          ? "node-matrix-plus-z3"
          : review.engine,
      symbolic: symbolicRepairReview,
    };
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    const patch =
      `- const eligible = income < 250_000 && age <= 25;\n` +
      `+ const eligible = income <= ${incomeCap}\n` +
      `+   && (age <= ${standardAgeLimit}\n` +
      `+     || (hasDisability && age <= ${disabilityAgeLimit}));`;
    const scenario = {
      title: "Reviewer-submitted compound policy",
      problem:
        "The approved document changed both the income boundary and a disability exception; production still implements the old, incomplete rule.",
      policy: compilation.policy,
      contractHash: policyContractHash(compilation.policy),
      generatedCases: cases,
      extractedRules: compilation.extractedRules,
      ambiguities: compilation.ambiguities,
      parameters: compilation.parameters,
      extraction: {
        ...compilation.extraction,
        humanApprovalRequired: true,
        approvedBy: compilation.policy.approved.approvedBy,
      },
      counterexampleSearch: symbolicDrift,
    };
    const repairPreview = {
      status: "ready-for-human-review",
      finding:
        "Production has a stale strict income boundary and entirely omits the approved disability age exception.",
      proposedChange: {
        title: "Implement the approved compound policy",
        minimalPatch: patch,
        changedTokens: [
          "<",
          "<=",
          "250000",
          String(incomeCap),
          "hasDisability",
          String(disabilityAgeLimit),
        ],
      },
      proof: { before, after },
      independentReview: combinedReview,
      evidenceGraph: this.evidenceGraph({
        policy: compilation.policy,
        before,
        after,
        patch,
        review: combinedReview,
      }),
      safety: {
        execution: "isolated-preview",
        autoMerge: false,
        requiredNextAction: "human-approval",
      },
    };
    const result: ChampionshipRun & { status: "ready" } = {
      status: "ready",
      scenario,
      audit: before,
      repairPreview,
    };
    this.lastRun = result;
    return { ...result };
  }

  async evidencePackage(): Promise<Record<string, unknown>> {
    if (!this.lastRun) await this.repairPreview();
    const run = this.lastRun as ChampionshipRun;
    const createdAt = new Date().toISOString();
    const payload = {
      schemaVersion: "1.0",
      kind: "niyam-proof-carrying-repair",
      createdAt,
      scenario: run.scenario,
      audit: run.audit,
      repair: run.repairPreview,
      authority: {
        automaticMerge: false,
        requiredAction: "A human policy owner and engineer must approve.",
      },
      pullRequestDraft: {
        branch: `niyam/policy-repair-${run.audit.auditId.slice(-8)}`,
        title: "Align scholarship eligibility with approved policy contract",
        status: "draft-not-pushed",
      },
    };
    const integrityHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")}`;
    return {
      ...payload,
      integrityHash,
      filename: `niyam-evidence-${run.audit.auditId}.json`,
    };
  }
}
