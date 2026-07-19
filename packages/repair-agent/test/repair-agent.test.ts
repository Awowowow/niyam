import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildCodexBedrockCommand,
  createRepairPrompt,
  extractJsonObject,
  runCodexPolicyExtraction,
  runIsolatedCodexRepair,
} from "../src";

const execFileAsync = promisify(execFile);

const finding = {
  id: "finding-1",
  title: "Exact threshold is excluded",
  summary: "The code uses a strict comparison for an inclusive policy.",
  citation: {
    documentName: "Scholarship policy",
    section: "2.1",
    quote: "Income must be up to and including INR 250,000.",
  },
  mismatch: {
    caseId: "exact",
    factPath: "applicant.income",
    facts: { applicant: { income: "250000" } },
    expectedOutcome: "ELIGIBLE",
    actualOutcome: "INELIGIBLE",
  },
};

describe("Codex Bedrock repair agent", () => {
  it("normalizes fenced Bedrock JSON before strict validation", () => {
    expect(extractJsonObject('```json\n{"status":"repaired"}\n```')).toEqual(
      { status: "repaired" },
    );
  });

  it("creates a bounded evidence-first repair prompt", () => {
    const prompt = createRepairPrompt(finding);
    expect(prompt).toContain("up to and including INR 250,000");
    expect(prompt).toContain("do not reinterpret");
    expect(prompt).toContain(
      "Do not access secrets, use the network, commit, push, merge",
    );
    expect(prompt).toContain('return status "blocked"');
  });

  it("uses the built-in Amazon Bedrock provider and workspace-only sandbox", () => {
    const command = buildCodexBedrockCommand({
      worktreePath: "/tmp/niyam/worktree",
      schemaPath: "/tmp/niyam/schema.json",
      outputPath: "/tmp/niyam/output.json",
      prompt: "repair",
    });
    expect(command.binary).toBe("codex");
    expect(command.args).toContain("workspace-write");
    expect(command.args).toContain("openai.gpt-5.5");
    expect(command.args).toContain('model_provider="amazon-bedrock"');
    expect(command.args).toContain("--ephemeral");
    expect(command.args).not.toContain("danger-full-access");
  });

  it("captures a verified patch without changing the main checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "niyam-agent-test-"));
    const fakeCodex = join(root, "fake-codex.mjs");

    try {
      await execFileAsync("git", ["init", "-b", "main", root]);
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "user.email",
        "test@niyam.local",
      ]);
      await execFileAsync("git", [
        "-C",
        root,
        "config",
        "user.name",
        "Niyam Test",
      ]);
      await writeFile(join(root, "logic.txt"), "broken\n", "utf8");
      await execFileAsync("git", ["-C", root, "add", "logic.txt"]);
      await execFileAsync("git", ["-C", root, "commit", "-m", "baseline"]);
      await writeFile(
        fakeCodex,
        `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
writeFileSync("logic.txt", "fixed\\n", "utf8");
writeFileSync(args[outputIndex + 1], JSON.stringify({
  status: "repaired",
  summary: "Fixed the test logic",
  files_changed: ["logic.txt"],
  tests_run: [],
  residual_risks: []
}), "utf8");
`,
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      const result = await runIsolatedCodexRepair({
        repositoryPath: root,
        revision: "HEAD",
        finding,
        verificationCommands: [
          {
            label: "focused regression",
            command: process.execPath,
            args: [
              "-e",
              'const fs=require("fs");if(fs.readFileSync("logic.txt","utf8")!=="fixed\\n")process.exit(1)',
            ],
          },
        ],
        options: { codexBinary: fakeCodex, timeoutMs: 10_000 },
      });

      expect(result.status).toBe("verified-repair");
      expect(result.patch).toContain("+fixed");
      expect(result.verification).toMatchObject([{ passed: true }]);
      expect(await readFile(join(root, "logic.txt"), "utf8")).toBe("broken\n");
      const worktrees = await execFileAsync("git", [
        "-C",
        root,
        "worktree",
        "list",
      ]);
      expect(worktrees.stdout.trim().split("\n")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extracts cited policy values through the strict live-AI schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "niyam-extraction-test-"));
    const fakeCodex = join(root, "fake-codex.mjs");
    try {
      await writeFile(
        fakeCodex,
        `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output-last-message");
writeFileSync(args[outputIndex + 1], JSON.stringify({
  status: "extracted",
  domain: "scholarship-eligibility",
  summary: "Three rules were cited without making a decision.",
  rules: [
    { parameter: "income-cap", label: "Annual income", numeric_value: 512000, source_text: "Income may not exceed INR 512,000.", confidence: 0.98 },
    { parameter: "standard-age-limit", label: "Age limit", numeric_value: 29, source_text: "Candidates remain eligible through age 29.", confidence: 0.96 },
    { parameter: "disability-age-relaxation", label: "Disability relaxation", numeric_value: 6, source_text: "A documented disability adds 6 years.", confidence: 0.94 }
  ],
  ambiguities: []
}), "utf8");
`,
        "utf8",
      );
      await chmod(fakeCodex, 0o755);

      const extraction = await runCodexPolicyExtraction({
        policyText:
          "Income may not exceed INR 512,000. Candidates remain eligible through age 29. A documented disability adds 6 years.",
        language: "en",
        options: { codexBinary: fakeCodex, timeoutMs: 10_000 },
      });

      expect(extraction.provider).toBe("amazon-bedrock");
      expect(extraction.result.status).toBe("extracted");
      expect(extraction.result.rules.map((rule) => rule.numeric_value)).toEqual(
        [512000, 29, 6],
      );
      expect(extraction.result.rules[0]?.source_text).toContain("512,000");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
