import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { agentRepairJsonSchema } from "@niyam/repair-agent";

function detectedAwsAuthentication():
  "bedrock-api-key" | "aws-sdk-chain" | "not-detected" {
  if (process.env.AWS_BEARER_TOKEN_BEDROCK) return "bedrock-api-key";
  if (
    process.env.AWS_PROFILE ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  ) {
    return "aws-sdk-chain";
  }
  return "not-detected";
}

@ApiTags("repair agent")
@Controller("v1/repairs")
export class RepairsController {
  @Get("capabilities")
  @ApiOperation({
    summary: "Show the configured repair model and safety boundaries",
  })
  capabilities(): Record<string, unknown> {
    const authentication = detectedAwsAuthentication();
    const backend =
      process.env.NIYAM_AI_BACKEND === "bedrock-chat"
        ? "bedrock-chat"
        : "codex";
    return {
      enabled: process.env.NIYAM_ENABLE_CODEX_REPAIRS === "true",
      provider: "amazon-bedrock",
      backend,
      model:
        backend === "bedrock-chat"
          ? (process.env.NIYAM_REPAIR_MODEL ??
            "qwen.qwen3-coder-480b-a35b-instruct")
          : (process.env.NIYAM_CODEX_MODEL ?? "openai.gpt-5.5"),
      authentication,
      configured:
        authentication !== "not-detected" && Boolean(process.env.AWS_REGION),
      execution: {
        isolation: "temporary-detached-git-worktree",
        sandbox:
          backend === "bedrock-chat"
            ? "single-source-file-write"
            : "workspace-write",
        structuredOutput: true,
        independentVerification: true,
      },
      prohibited: ["network tools", "secret access", "commit", "push", "merge"],
      humanGate: {
        required: true,
        autoMerge: false,
      },
      outputSchema: agentRepairJsonSchema,
    };
  }
}
