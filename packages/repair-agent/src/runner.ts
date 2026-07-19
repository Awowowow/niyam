import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCodexBedrockCommand } from "./codex-command";
import { createRepairPrompt } from "./prompt";
import { git, runCommand } from "./process";
import { agentRepairJsonSchema } from "./schema";
import {
  AgentRepairResultSchema,
  type CodexBedrockOptions,
  type IndependentVerificationResult,
  type IsolatedRepairResult,
  type RepairFinding,
  type VerificationCommand,
} from "./types";

export async function runIsolatedCodexRepair(input: {
  repositoryPath: string;
  revision: string;
  finding: RepairFinding;
  verificationCommands: VerificationCommand[];
  options?: CodexBedrockOptions;
}): Promise<IsolatedRepairResult> {
  if (!/^[A-Za-z0-9._\/-]{1,200}$/.test(input.revision)) {
    throw new Error("Revision contains unsupported characters");
  }

  const repositoryPath = await realpath(resolve(input.repositoryPath));
  const reportedRepositoryRoot = (
    await git(repositoryPath, ["rev-parse", "--show-toplevel"])
  ).trim();
  const repositoryRoot = await realpath(reportedRepositoryRoot);
  if (repositoryRoot !== repositoryPath) {
    throw new Error("repositoryPath must be the Git repository root");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "niyam-repair-"));
  const worktreePath = join(temporaryRoot, "worktree");
  const schemaPath = join(temporaryRoot, "repair-output.schema.json");
  const outputPath = join(temporaryRoot, "agent-output.json");
  const timeoutMs = input.options?.timeoutMs ?? 15 * 60_000;
  let worktreeCreated = false;

  try {
    await writeFile(schemaPath, JSON.stringify(agentRepairJsonSchema), "utf8");
    await git(repositoryPath, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      input.revision,
    ]);
    worktreeCreated = true;

    const prompt = createRepairPrompt(input.finding);
    const command = buildCodexBedrockCommand({
      worktreePath,
      schemaPath,
      outputPath,
      prompt,
      options: input.options,
    });
    const execution = await runCommand({
      command: command.binary,
      args: command.args,
      cwd: worktreePath,
      timeoutMs,
    });
    if (execution.exitCode !== 0) {
      throw new Error(`Codex repair failed: ${execution.stderr.slice(-2_000)}`);
    }

    const agent = AgentRepairResultSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8")) as unknown,
    );
    const patch = await git(worktreePath, [
      "diff",
      "--no-ext-diff",
      "--binary",
    ]);
    const verification: IndependentVerificationResult[] = [];

    if (agent.status === "repaired") {
      for (const verificationCommand of input.verificationCommands) {
        const result = await runCommand({
          command: verificationCommand.command,
          args: verificationCommand.args,
          cwd: worktreePath,
          timeoutMs: Math.min(timeoutMs, 10 * 60_000),
        });
        verification.push({
          label: verificationCommand.label,
          command: [
            verificationCommand.command,
            ...verificationCommand.args,
          ].join(" "),
          exitCode: result.exitCode,
          passed: result.exitCode === 0,
          output: `${result.stdout}\n${result.stderr}`.trim().slice(-20_000),
        });
      }
    }

    const allVerified =
      agent.status === "repaired" &&
      patch.length > 0 &&
      verification.length > 0 &&
      verification.every((result) => result.passed);

    return {
      status:
        agent.status === "blocked"
          ? "agent-blocked"
          : allVerified
            ? "verified-repair"
            : "verification-failed",
      provider: "amazon-bedrock",
      model: input.options?.model ?? "openai.gpt-5.5",
      agent,
      patch,
      verification,
      safety: {
        isolatedWorktree: true,
        sandbox: "workspace-write",
        autoCommit: false,
        autoPush: false,
        autoMerge: false,
      },
    };
  } finally {
    if (worktreeCreated) {
      await git(repositoryPath, [
        "worktree",
        "remove",
        "--force",
        worktreePath,
      ]).catch(() => undefined);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
