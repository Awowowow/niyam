import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  runBedrockChatPolicyExtraction,
  runCodexPolicyExtraction,
  type CodexBedrockOptions,
} from "@niyam/repair-agent";
import {
  compileScholarshipPolicyParameters,
  compileScholarshipPolicyText,
  type ExtractedPolicyRule,
  type PolicyCompilation,
  type PolicyNeedsClarification,
} from "./policy-compiler";

const execFileAsync = promisify(execFile);

type AiBackend = "bedrock-chat" | "codex";

function configuredBackend(): AiBackend {
  return process.env.NIYAM_AI_BACKEND === "bedrock-chat"
    ? "bedrock-chat"
    : "codex";
}

function configuredCodexModel(): NonNullable<CodexBedrockOptions["model"]> {
  const value = process.env.NIYAM_CODEX_MODEL;
  return value === "openai.gpt-5.6-sol" || value === "openai.gpt-5.4"
    ? value
    : "openai.gpt-5.5";
}

function configuredPolicyModel(): string {
  return configuredBackend() === "bedrock-chat"
    ? (process.env.NIYAM_POLICY_MODEL ?? "openai.gpt-oss-120b")
    : configuredCodexModel();
}

function configuredRepairModel(): string {
  return configuredBackend() === "bedrock-chat"
    ? (process.env.NIYAM_REPAIR_MODEL ?? "qwen.qwen3-coder-480b-a35b-instruct")
    : configuredCodexModel();
}

@Injectable()
export class PolicyExtractionService {
  private lastSuccessfulExtractionAt?: string;
  private lastFailure?: string;

  private get judgeMode(): boolean {
    return process.env.NIYAM_JUDGE_MODE === "true";
  }

  private get enabled(): boolean {
    return process.env.NIYAM_ENABLE_AI_EXTRACTION === "true";
  }

  async capabilities() {
    const backend = configuredBackend();
    let codexVersion: string | undefined;
    if (backend === "codex") {
      try {
        const result = await execFileAsync("codex", ["--version"], {
          timeout: 5_000,
        });
        codexVersion = result.stdout.trim();
      } catch {
        codexVersion = undefined;
      }
    }
    const repairEnabled = process.env.NIYAM_ENABLE_CODEX_REPAIRS === "true";
    const configured =
      this.enabled &&
      repairEnabled &&
      (backend === "bedrock-chat" || Boolean(codexVersion));
    return {
      mode: this.judgeMode ? "judge" : "development",
      status: configured
        ? "live-ai-configured"
        : this.judgeMode
          ? "judge-mode-blocked"
          : "safe-local-fallback",
      provider: "amazon-bedrock",
      backend,
      model: configuredPolicyModel(),
      codexVersion,
      policyExtraction: {
        enabled: this.enabled,
        required: this.judgeMode,
        lastSuccessfulAt: this.lastSuccessfulExtractionAt,
        lastFailure: this.lastFailure,
      },
      repositoryRepair: {
        enabled: repairEnabled,
        required: this.judgeMode,
        model: configuredRepairModel(),
      },
      fallbackAllowed: !this.judgeMode,
      authority: {
        modelMakesEligibilityDecisions: false,
        humanPolicyApprovalRequired: true,
        deterministicVerificationRequired: true,
        automaticMerge: false,
      },
    };
  }

  async compile(input: {
    policyText: string;
    canonicalText: string;
    language: "en" | "hi";
    approvedBy: string;
  }): Promise<PolicyCompilation> {
    if (!this.enabled) {
      if (this.judgeMode) {
        throw new ServiceUnavailableException(
          "Public mode requires live AI policy reading. Enable NIYAM_ENABLE_AI_EXTRACTION and configure Amazon Bedrock.",
        );
      }
      return compileScholarshipPolicyText(
        input.canonicalText,
        input.approvedBy,
      );
    }

    try {
      const backend = configuredBackend();
      const extraction =
        backend === "bedrock-chat"
          ? await runBedrockChatPolicyExtraction({
              policyText: input.policyText,
              language: input.language,
              options: { model: configuredPolicyModel() },
            })
          : await runCodexPolicyExtraction({
              policyText: input.policyText,
              language: input.language,
              options: { model: configuredCodexModel() },
            });
      this.lastSuccessfulExtractionAt = new Date().toISOString();
      this.lastFailure = undefined;
      const result = extraction.result;
      const extractionEvidence = {
        mode:
          backend === "bedrock-chat"
            ? ("bedrock-chat" as const)
            : ("bedrock-codex" as const),
        provider: "amazon-bedrock" as const,
        model: extraction.model,
        summary: result.summary,
      };

      const availableRules: ExtractedPolicyRule[] = result.rules.map(
        (rule) => ({
          id: rule.parameter,
          label: rule.label,
          expression: `${rule.parameter.replaceAll("-", " ")} = ${rule.numeric_value}`,
          sourceText: rule.source_text,
          confidence: rule.confidence >= 0.9 ? "high" : "medium",
          status: "awaiting-human-approval",
        }),
      );
      if (
        result.status === "needs-clarification" ||
        result.domain === "unsupported"
      ) {
        const blocked: PolicyNeedsClarification = {
          status: "needs-clarification",
          extractedRules: availableRules,
          ambiguities:
            result.ambiguities.length > 0
              ? result.ambiguities.map((issue) => ({
                  code:
                    issue.code === "CONFLICTING_RULE"
                      ? ("CONFLICTING_POLICY" as const)
                      : issue.code === "UNSUPPORTED_RULE"
                        ? ("UNSUPPORTED_POLICY" as const)
                        : ("AI_AMBIGUITY" as const),
                  message: issue.message,
                  resolution: issue.resolution,
                  sourceText: issue.source_text,
                }))
              : [
                  {
                    code: "UNSUPPORTED_POLICY",
                    message:
                      "This policy is outside the currently verified scholarship domain.",
                    resolution:
                      "Use a scholarship eligibility rule or connect a verified domain adapter.",
                  },
                ],
          extraction: {
            ...extractionEvidence,
            humanApprovalRequired: true,
          },
        };
        return blocked;
      }

      const byParameter = new Map(
        result.rules.map((rule) => [rule.parameter, rule]),
      );
      const income = byParameter.get("income-cap");
      const age = byParameter.get("standard-age-limit");
      const relaxation = byParameter.get("disability-age-relaxation");
      if (!income || !age || !relaxation) {
        return {
          status: "needs-clarification",
          extractedRules: availableRules,
          ambiguities: [
            {
              code: "AI_AMBIGUITY",
              message:
                "Live extraction did not identify all three required scholarship values.",
              resolution:
                "Clarify the income cap, age limit, and disability relaxation.",
            },
          ],
          extraction: {
            ...extractionEvidence,
            humanApprovalRequired: true,
          },
        };
      }

      return compileScholarshipPolicyParameters({
        policyText: input.policyText,
        approvedBy: input.approvedBy,
        incomeCap: income.numeric_value,
        standardAgeLimit: age.numeric_value,
        disabilityRelaxationYears: relaxation.numeric_value,
        sourceRules: result.rules.map((rule) => ({
          parameter: rule.parameter,
          sourceText: rule.source_text,
          confidence: rule.confidence,
        })),
        extraction: extractionEvidence,
      });
    } catch (error) {
      this.lastFailure =
        error instanceof Error ? error.message : "Live extraction failed";
      if (this.judgeMode) {
        throw new ServiceUnavailableException(
          `Live AI policy reading did not complete in public mode: ${this.lastFailure}`,
        );
      }
      return compileScholarshipPolicyText(
        input.canonicalText,
        input.approvedBy,
      );
    }
  }
}
