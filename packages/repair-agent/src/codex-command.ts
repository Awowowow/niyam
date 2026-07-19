import type { CodexBedrockOptions } from "./types";

export interface CodexCommand {
  binary: string;
  args: string[];
}

export function buildCodexBedrockCommand(input: {
  worktreePath: string;
  schemaPath: string;
  outputPath: string;
  prompt: string;
  options?: CodexBedrockOptions;
}): CodexCommand {
  const model = input.options?.model ?? "openai.gpt-5.5";

  return {
    binary: input.options?.codexBinary ?? "codex",
    args: [
      "--ask-for-approval",
      "never",
      "--sandbox",
      "workspace-write",
      "--model",
      model,
      "--config",
      'model_provider="amazon-bedrock"',
      "--cd",
      input.worktreePath,
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--output-schema",
      input.schemaPath,
      "--output-last-message",
      input.outputPath,
      input.prompt,
    ],
  };
}
