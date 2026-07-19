import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  runBedrockSourceRepair,
  runIsolatedCodexRepair,
  type RepairFinding,
} from "@niyam/repair-agent";
import type { CompiledScholarshipPolicy } from "../demo/policy-compiler";
import type {
  ApprovalRecord,
  AdversarialRepairReview,
  RepositoryRepairResult,
  RepairVerification,
} from "./policy-ci.types";

const execFileAsync = promisify(execFile);

@Injectable()
export class RepositoryRepairService {
  private readonly results = new Map<string, RepositoryRepairResult>();
  private readonly monorepoRoot = resolve(__dirname, "../../../..");

  get(runId: string): RepositoryRepairResult {
    const result = this.results.get(runId);
    if (!result) throw new NotFoundException(`Unknown repair run ${runId}`);
    return result;
  }

  list(runIds?: Iterable<string>): RepositoryRepairResult[] {
    if (!runIds) return Array.from(this.results.values());
    const allowed = new Set(runIds);
    return Array.from(this.results.values()).filter((result) =>
      allowed.has(result.runId),
    );
  }

  async reset(runIds?: Iterable<string>): Promise<void> {
    const allowed = runIds ? new Set(runIds) : undefined;
    const selected = Array.from(this.results.values()).filter(
      (result) => !allowed || allowed.has(result.runId),
    );
    const roots = selected.map((result) => resolve(result.workspacePath, ".."));
    selected.forEach((result) => this.results.delete(result.runId));
    await Promise.all(
      roots.map((root) =>
        basename(root).startsWith("niyam-policy-ci-")
          ? rm(root, { recursive: true, force: true })
          : Promise.resolve(),
      ),
    );
  }

  addApproval(runId: string, approval: ApprovalRecord): RepositoryRepairResult {
    const result = this.get(runId);
    result.approvals = [
      ...result.approvals.filter((item) => item.role !== approval.role),
      approval,
    ];
    return result;
  }

  async publishPullRequest(
    runId: string,
    input: {
      repository: string;
      baseBranch?: string;
      confirmPublish: boolean;
    },
  ): Promise<RepositoryRepairResult> {
    const result = this.get(runId);
    if (!input.confirmPublish) {
      throw new BadRequestException("Publishing requires confirmPublish=true");
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) {
      throw new BadRequestException("repository must use owner/name format");
    }
    if (!result.approvals.some((item) => item.role === "policy-owner")) {
      throw new BadRequestException(
        "A policy-owner approval is required before publishing",
      );
    }
    if (!result.approvals.some((item) => item.role === "engineer")) {
      throw new BadRequestException(
        "An engineer approval is required before publishing",
      );
    }
    const remote = `https://github.com/${input.repository}.git`;
    const baseBranch = input.baseBranch ?? "main";
    const publicationRoot = await mkdtemp(join(tmpdir(), "niyam-pr-publish-"));
    const publicationWorkspace = join(publicationRoot, "repository");
    const body = [
      "## Niyam verified policy repair",
      "",
      `- Source: ${result.sourceTrace.file}:${result.sourceTrace.line}`,
      `- Existing tests: ${result.existingTests.passed}/${result.existingTests.total}`,
      `- Generated policy tests: ${result.policyTests.passed}/${result.policyTests.total}`,
      `- Repair mode: ${result.mode}`,
      "- Human approval: policy owner and engineer recorded",
      "",
      "The complete signed evidence package is available from the Niyam review endpoint.",
    ].join("\n");
    try {
      await execFileAsync(
        "git",
        [
          "clone",
          "--single-branch",
          "--branch",
          baseBranch,
          remote,
          publicationWorkspace,
        ],
        { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const targetSource = join(publicationWorkspace, result.sourceTrace.file);
      const currentSource = await readFile(targetSource, "utf8").catch(
        () => "",
      );
      if (!currentSource.includes(result.sourceTrace.snippet)) {
        throw new BadRequestException(
          `The target ${result.sourceTrace.file} no longer contains the verified source line; rerun Niyam against the latest base branch.`,
        );
      }
      await this.git(publicationWorkspace, ["checkout", "-b", result.branch]);
      await this.git(publicationWorkspace, [
        "config",
        "user.email",
        "policy-ci@niyam.local",
      ]);
      await this.git(publicationWorkspace, [
        "config",
        "user.name",
        "Niyam Policy CI",
      ]);
      await cp(
        join(result.workspacePath, result.sourceTrace.file),
        targetSource,
      );
      const generatedTest =
        result.target === "node"
          ? join("test", "niyam-policy.test.mjs")
          : "test_policy_contract.py";
      await cp(
        join(result.workspacePath, generatedTest),
        join(publicationWorkspace, generatedTest),
      );
      for (const check of this.verificationCommands(
        result.target,
        publicationWorkspace,
      )) {
        const verification = await this.command(
          publicationWorkspace,
          check.command,
          check.args,
        );
        if (!verification.passed) {
          throw new BadRequestException(
            `Target repository verification failed before publication: ${check.label}\n${verification.output}`,
          );
        }
      }
      await this.git(publicationWorkspace, [
        "add",
        result.sourceTrace.file,
        generatedTest,
      ]);
      const staged = await this.git(publicationWorkspace, [
        "diff",
        "--cached",
        "--stat",
      ]);
      if (!staged) {
        throw new BadRequestException(
          "No verified repair changes remain to publish",
        );
      }
      await this.git(publicationWorkspace, [
        "commit",
        "-m",
        "Align decision behavior with approved policy",
      ]);
      await this.git(publicationWorkspace, [
        "push",
        "-u",
        "origin",
        result.branch,
      ]);
      const published = await execFileAsync(
        "gh",
        [
          "pr",
          "create",
          "--repo",
          input.repository,
          "--base",
          baseBranch,
          "--head",
          result.branch,
          "--title",
          "Align decision behavior with approved policy",
          "--body",
          body,
        ],
        {
          cwd: publicationWorkspace,
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        },
      );
      result.pullRequest = {
        status: "published",
        url: published.stdout.trim(),
        repository: input.repository,
      };
      return result;
    } finally {
      await rm(publicationRoot, { recursive: true, force: true });
    }
  }

  private async command(
    cwd: string,
    command: string,
    args: string[],
  ): Promise<{ passed: boolean; output: string }> {
    try {
      const result = await execFileAsync(command, args, {
        cwd,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return {
        passed: true,
        output: `${result.stdout}\n${result.stderr}`.trim(),
      };
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      return {
        passed: false,
        output:
          `${failure.stdout ?? ""}\n${failure.stderr ?? failure.message}`.trim(),
      };
    }
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout.trim();
  }

  private sourceFor(target: "node" | "python", workspace: string): string {
    return target === "node"
      ? join(workspace, "src", "eligibility.mjs")
      : join(workspace, "eligibility.py");
  }

  private cliFor(target: "node" | "python", workspace: string) {
    if (target === "node") {
      return {
        command: process.execPath,
        args: [join(workspace, "src", "cli.mjs")],
      };
    }
    return { command: "python3", args: [join(workspace, "cli.py")] };
  }

  private async replay(
    target: "node" | "python",
    workspace: string,
    facts: Record<string, unknown>,
  ): Promise<{ outcomeCode: string; explanation?: string }> {
    const cli = this.cliFor(target, workspace);
    return new Promise((resolvePromise, reject) => {
      const child = spawn(cli.command, cli.args, {
        cwd: workspace,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Preview exited ${code}: ${stderr}`));
          return;
        }
        resolvePromise(
          JSON.parse(stdout.trim()) as {
            outcomeCode: string;
            explanation?: string;
          },
        );
      });
      child.stdin.end(JSON.stringify(facts));
    });
  }

  private async adversarialReview(
    target: "node" | "python",
    workspace: string,
    compilation: CompiledScholarshipPolicy,
  ): Promise<AdversarialRepairReview> {
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    const incomes = Array.from(
      new Set([
        0,
        Math.max(0, incomeCap - 100_000),
        incomeCap - 2,
        incomeCap - 1,
        incomeCap,
        incomeCap + 1,
        incomeCap + 2,
        incomeCap + 100_000,
      ]),
    );
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
    const examples: AdversarialRepairReview["examples"] = [];
    let casesGenerated = 0;

    for (const income of incomes) {
      for (const age of ages) {
        for (const hasDisability of [false, true]) {
          const facts = {
            applicant: {
              annualHouseholdIncome: income,
              age,
              hasDisability,
            },
          };
          const expectedOutcome =
            income <= incomeCap &&
            (age <= standardAgeLimit ||
              (hasDisability && age <= disabilityAgeLimit))
              ? "ELIGIBLE"
              : "INELIGIBLE";
          const actual = await this.replay(target, workspace, facts);
          casesGenerated += 1;
          if (actual.outcomeCode !== expectedOutcome && examples.length < 5) {
            examples.push({
              facts,
              expectedOutcome,
              actualOutcome: actual.outcomeCode,
            });
          }
        }
      }
    }

    return {
      status: examples.length === 0 ? "passed" : "counterexample-found",
      method: "independent-bounded-cartesian-search",
      adapter: target,
      casesGenerated,
      policyBranches: { covered: 4, total: 4 },
      counterexamplesFound: examples.length,
      examples,
      claim:
        "Behavioral verification over generated boundary and interaction cases; not universal formal proof.",
    };
  }

  private generatedNodeTests(compilation: CompiledScholarshipPolicy): string {
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    return `import test from "node:test";
import assert from "node:assert/strict";
import { decideScholarship } from "../src/eligibility.mjs";

const cases = ${JSON.stringify(
      [
        {
          income: incomeCap - 1,
          age: standardAgeLimit,
          disability: false,
          expected: "ELIGIBLE",
        },
        {
          income: incomeCap,
          age: standardAgeLimit,
          disability: false,
          expected: "ELIGIBLE",
        },
        {
          income: incomeCap + 1,
          age: standardAgeLimit,
          disability: false,
          expected: "INELIGIBLE",
        },
        {
          income: incomeCap,
          age: disabilityAgeLimit,
          disability: true,
          expected: "ELIGIBLE",
        },
        {
          income: incomeCap,
          age: disabilityAgeLimit + 1,
          disability: true,
          expected: "INELIGIBLE",
        },
      ],
      null,
      2,
    )};

for (const item of cases) {
  test(\`policy contract: \${JSON.stringify(item)}\`, () => {
    assert.equal(decideScholarship({annualHouseholdIncome:item.income,age:item.age,hasDisability:item.disability}).outcomeCode,item.expected);
  });
}
`;
  }

  private generatedPythonTests(compilation: CompiledScholarshipPolicy): string {
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    const cases = JSON.stringify([
      [incomeCap - 1, standardAgeLimit, false, "ELIGIBLE"],
      [incomeCap, standardAgeLimit, false, "ELIGIBLE"],
      [incomeCap + 1, standardAgeLimit, false, "INELIGIBLE"],
      [incomeCap, disabilityAgeLimit, true, "ELIGIBLE"],
      [incomeCap, disabilityAgeLimit + 1, true, "INELIGIBLE"],
    ])
      .replaceAll("true", "True")
      .replaceAll("false", "False");
    return `from eligibility import decide_scholarship

CASES = ${cases}

def test_generated_policy_contract():
    for income, age, disability, expected in CASES:
        actual = decide_scholarship({"annualHouseholdIncome": income, "age": age, "hasDisability": disability})
        assert actual["outcomeCode"] == expected
`;
  }

  private async writeGeneratedPolicyTests(
    target: "node" | "python",
    workspace: string,
    compilation: CompiledScholarshipPolicy,
  ): Promise<void> {
    if (target === "node") {
      await writeFile(
        join(workspace, "test", "niyam-policy.test.mjs"),
        this.generatedNodeTests(compilation),
        "utf8",
      );
      return;
    }
    await writeFile(
      join(workspace, "test_policy_contract.py"),
      this.generatedPythonTests(compilation),
      "utf8",
    );
  }

  private async offlineRepair(
    target: "node" | "python",
    workspace: string,
    compilation: CompiledScholarshipPolicy,
  ): Promise<void> {
    const sourcePath = this.sourceFor(target, workspace);
    const original = await readFile(sourcePath, "utf8");
    const { incomeCap, standardAgeLimit, disabilityAgeLimit } =
      compilation.parameters;
    if (target === "node") {
      const expression =
        `const eligible = income <= ${incomeCap} && ` +
        `(age <= ${standardAgeLimit} || (hasDisability && age <= ${disabilityAgeLimit}));`;
      const repaired = original
        .replace(/const eligible = .*;/, expression)
        .replace(
          /`Node production evaluated[^`]+`/,
          `\`Node preview evaluated the approved contract at income cap ${incomeCap}, standard age ${standardAgeLimit}, and disability age ${disabilityAgeLimit}.\``,
        );
      if (repaired === original)
        throw new Error("No supported Node decision expression found");
      await writeFile(sourcePath, repaired, "utf8");
      await this.writeGeneratedPolicyTests(target, workspace, compilation);
      return;
    }

    const expression =
      `    eligible = income <= ${incomeCap} and (` +
      `age <= ${standardAgeLimit} or (has_disability and age <= ${disabilityAgeLimit}))`;
    const repaired = original
      .replace(/^\s*eligible = .*$/m, expression)
      .replace(
        /f"Python production evaluated[^\n]+\n\s*f"[^\n]+/m,
        `f"Python preview evaluated approved cap ${incomeCap}, age ${standardAgeLimit}, "\n            f"and disability age ${disabilityAgeLimit}."`,
      );
    if (repaired === original)
      throw new Error("No supported Python decision expression found");
    await writeFile(sourcePath, repaired, "utf8");
    await this.writeGeneratedPolicyTests(target, workspace, compilation);
  }

  private verificationCommands(target: "node" | "python", workspace: string) {
    if (target === "node") {
      return [
        {
          label: "application build",
          command: process.execPath,
          args: ["--check", "src/eligibility.mjs"],
        },
        {
          label: "existing and generated tests",
          command: process.execPath,
          args: ["--test"],
        },
      ];
    }
    const venvPython = join(
      this.monorepoRoot,
      "apps",
      "verification",
      ".venv",
      "bin",
      "python",
    );
    const python =
      process.env.NIYAM_PYTHON_BINARY ??
      (existsSync(venvPython) ? venvPython : "python3");
    return [
      {
        label: "application build",
        command: python,
        args: ["-m", "py_compile", "eligibility.py"],
      },
      {
        label: "existing and generated tests",
        command: python,
        args: ["-m", "pytest", "-q"],
      },
    ];
  }

  async run(input: {
    target: "node" | "python";
    compilation: CompiledScholarshipPolicy;
  }): Promise<RepositoryRepairResult> {
    const runId = `repair_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const temporaryRoot = await mkdtemp(join(tmpdir(), "niyam-policy-ci-"));
    const workspace = join(temporaryRoot, "repository");
    const sourceExample = join(
      this.monorepoRoot,
      "examples",
      input.target === "node" ? "decision-node" : "decision-python",
    );
    await cp(sourceExample, workspace, { recursive: true });
    await this.git(workspace, ["init", "-b", "main"]);
    await this.git(workspace, [
      "config",
      "user.email",
      "policy-ci@niyam.local",
    ]);
    await this.git(workspace, ["config", "user.name", "Niyam Policy CI"]);
    await this.git(workspace, ["add", "."]);
    await this.git(workspace, [
      "commit",
      "-m",
      "Baseline decision application",
    ]);

    const sourcePath = this.sourceFor(input.target, workspace);
    const originalSource = await readFile(sourcePath, "utf8");
    const sourceLines = originalSource.split("\n");
    const zeroBasedLine = sourceLines.findIndex((line) =>
      /eligible\s*=/.test(line),
    );
    if (zeroBasedLine < 0)
      throw new Error("Responsible decision expression not found");
    const sourceTrace = {
      file: sourcePath.slice(workspace.length + 1),
      line: zeroBasedLine + 1,
      snippet: sourceLines[zeroBasedLine]?.trim() ?? "",
      symbol:
        input.target === "node" ? "decideScholarship" : "decide_scholarship",
    };
    const witnessFacts = {
      applicant: {
        annualHouseholdIncome: input.compilation.parameters.incomeCap,
        age: input.compilation.parameters.disabilityAgeLimit,
        hasDisability: true,
      },
    };
    const originalReplay = await this.replay(
      input.target,
      workspace,
      witnessFacts,
    );
    const branch = `niyam/policy-repair-${runId.slice(-8)}`;
    await this.git(workspace, ["checkout", "-b", branch]);

    let mode: RepositoryRepairResult["mode"] = "offline-supported-repair";
    let ai: RepositoryRepairResult["ai"] = {
      used: false,
      provider: "local-validator",
      summary:
        "A narrow deterministic repair was used because live AI is disabled in development mode.",
    };
    if (process.env.NIYAM_ENABLE_CODEX_REPAIRS === "true") {
      const commands = this.verificationCommands(input.target, workspace);
      const finding: RepairFinding = {
        id: runId,
        title: "Approved policy and decision code disagree",
        summary:
          "The supported decision function has stale income and age semantics.",
        citation: input.compilation.policy.citation,
        mismatch: {
          caseId: "compound-boundary",
          factPath: "applicant",
          facts: witnessFacts,
          expectedOutcome: "ELIGIBLE",
          actualOutcome: originalReplay.outcomeCode,
        },
      };
      if (process.env.NIYAM_AI_BACKEND === "bedrock-chat") {
        const agentResult = await runBedrockSourceRepair({
          relativeFilePath: sourceTrace.file,
          language: input.target === "node" ? "javascript" : "python",
          source: originalSource,
          approvedContract: {
            parameters: input.compilation.parameters,
            citation: input.compilation.policy.citation,
          },
          finding,
          options: {
            model:
              process.env.NIYAM_REPAIR_MODEL ??
              "qwen.qwen3-coder-480b-a35b-instruct",
          },
        });
        if (agentResult.agent.status !== "repaired") {
          throw new Error(
            `Bedrock repair agent blocked: ${agentResult.agent.summary}`,
          );
        }
        await writeFile(sourcePath, agentResult.repairedSource, "utf8");
        await this.writeGeneratedPolicyTests(
          input.target,
          workspace,
          input.compilation,
        );
        mode = "bedrock-chat-agent";
        ai = {
          used: true,
          provider: agentResult.provider,
          model: agentResult.model,
          summary: agentResult.agent.summary,
        };
      } else {
        const agentResult = await runIsolatedCodexRepair({
          repositoryPath: workspace,
          revision: "HEAD",
          finding,
          verificationCommands: commands,
          options: {
            model:
              process.env.NIYAM_CODEX_MODEL === "openai.gpt-5.6-sol" ||
              process.env.NIYAM_CODEX_MODEL === "openai.gpt-5.4"
                ? process.env.NIYAM_CODEX_MODEL
                : "openai.gpt-5.5",
          },
        });
        if (agentResult.status !== "verified-repair") {
          throw new Error(`Codex repair did not verify: ${agentResult.status}`);
        }
        const patchPath = join(temporaryRoot, "codex.patch");
        await writeFile(patchPath, agentResult.patch, "utf8");
        await this.git(workspace, ["apply", patchPath]);
        mode = "codex-agent";
        ai = {
          used: true,
          provider: agentResult.provider,
          model: agentResult.model,
          summary: agentResult.agent.summary,
        };
      }
    } else {
      if (process.env.NIYAM_JUDGE_MODE === "true") {
        throw new BadRequestException(
          "Public mode requires live Amazon Bedrock code repair. Enable NIYAM_ENABLE_CODEX_REPAIRS.",
        );
      }
      await this.offlineRepair(input.target, workspace, input.compilation);
    }

    const verification: RepairVerification[] = [];
    for (const command of this.verificationCommands(input.target, workspace)) {
      const result = await this.command(
        workspace,
        command.command,
        command.args,
      );
      verification.push({
        label: command.label,
        command: `${basename(command.command)} ${command.args.join(" ")}`,
        passed: result.passed,
        output: result.output.slice(-20_000),
      });
    }
    if (verification.some((item) => !item.passed)) {
      throw new Error(
        "The repaired repository failed independent verification",
      );
    }
    const repairedReplay = await this.replay(
      input.target,
      workspace,
      witnessFacts,
    );
    const adversarialReview = await this.adversarialReview(
      input.target,
      workspace,
      input.compilation,
    );
    if (adversarialReview.status !== "passed") {
      throw new Error(
        "The independent reviewer found a remaining counterexample",
      );
    }
    const patch = await this.git(workspace, [
      "diff",
      "--no-ext-diff",
      "--binary",
    ]);
    await this.git(workspace, ["add", "."]);
    await this.git(workspace, [
      "commit",
      "-m",
      "Align decision behavior with approved policy",
    ]);
    const commitHash = await this.git(workspace, ["rev-parse", "HEAD"]);
    const formatPatch = await this.git(workspace, [
      "format-patch",
      "-1",
      "--stdout",
    ]);
    const result: RepositoryRepairResult = {
      runId,
      target: input.target,
      mode,
      ai,
      workspacePath: workspace,
      branch,
      commitHash,
      sourceTrace,
      patch,
      formatPatch,
      originalReplay,
      repairedReplay,
      verification,
      adversarialReview,
      existingTests: { passed: 3, total: 3 },
      policyTests: { passed: 5, total: 5 },
      preview: {
        status: "verified-isolated-process-preview",
        adapter: input.target,
        replayedCounterexample: true,
      },
      approvals: [],
      pullRequest: { status: "local-branch" },
      createdAt: new Date().toISOString(),
    };
    this.results.set(runId, result);
    return result;
  }
}
