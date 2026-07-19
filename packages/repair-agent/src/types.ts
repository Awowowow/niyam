import { z } from "zod";

export interface RepairFinding {
  id: string;
  title: string;
  summary: string;
  citation: {
    documentName: string;
    section: string;
    quote: string;
  };
  mismatch: {
    caseId: string;
    factPath: string;
    facts: unknown;
    expectedOutcome: string;
    actualOutcome: string;
  };
}

export interface VerificationCommand {
  command: string;
  args: string[];
  label: string;
}

export interface CodexBedrockOptions {
  model?:
    | "openai.gpt-5.6-sol"
    | "openai.gpt-5.5"
    | "openai.gpt-5.4";
  codexBinary?: string;
  timeoutMs?: number;
}

export const AgentRepairResultSchema = z.object({
  status: z.enum(["repaired", "blocked"]),
  summary: z.string(),
  files_changed: z.array(z.string()),
  tests_run: z.array(
    z.object({
      command: z.string(),
      status: z.enum(["passed", "failed", "not-run"]),
    }),
  ),
  residual_risks: z.array(z.string()),
});
export type AgentRepairResult = z.infer<typeof AgentRepairResultSchema>;

export interface IndependentVerificationResult {
  label: string;
  command: string;
  exitCode: number;
  passed: boolean;
  output: string;
}

export interface IsolatedRepairResult {
  status: "verified-repair" | "verification-failed" | "agent-blocked";
  provider: "amazon-bedrock";
  model: string;
  agent: AgentRepairResult;
  patch: string;
  verification: IndependentVerificationResult[];
  safety: {
    isolatedWorktree: true;
    sandbox: "workspace-write";
    autoCommit: false;
    autoPush: false;
    autoMerge: false;
  };
}
