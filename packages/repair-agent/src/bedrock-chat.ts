import { Sha256 } from "@aws-crypto/sha256-js";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

export interface BedrockChatOptions {
  model: string;
  region?: string;
  timeoutMs?: number;
  maxTokens?: number;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
}

interface BedrockChatPayload {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  stream: false;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  temperature?: number;
}

interface BedrockChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
    };
  }>;
  error?: { message?: string };
}

export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error("Bedrock model did not return a JSON object");
  }
  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1)) as unknown;
}

export async function runBedrockChatCompletion(input: {
  prompt: string;
  options: BedrockChatOptions;
}): Promise<{ model: string; content: string; reasoning?: string }> {
  const region = input.options.region ?? process.env.AWS_REGION ?? "us-east-2";
  const maxTokensField = input.options.maxTokensField ?? "max_tokens";
  const payload: BedrockChatPayload = {
    model: input.options.model,
    messages: [{ role: "user", content: input.prompt }],
    stream: false,
    [maxTokensField]: input.options.maxTokens ?? 4_096,
  };
  if (input.options.reasoningEffort) {
    payload.reasoning_effort = input.options.reasoningEffort;
  }
  if (input.options.temperature !== undefined) {
    payload.temperature = input.options.temperature;
  }

  const hostname = `bedrock-mantle.${region}.api.aws`;
  const path = "/v1/chat/completions";
  const body = JSON.stringify(payload);
  const credentials = fromNodeProviderChain({
    profile: process.env.AWS_PROFILE,
  });
  const signer = new SignatureV4({
    credentials,
    region,
    service: "bedrock-mantle",
    sha256: Sha256,
  });
  const signed = await signer.sign(
    new HttpRequest({
      protocol: "https:",
      hostname,
      method: "POST",
      path,
      headers: {
        host: hostname,
        "content-type": "application/json",
      },
      body,
    }),
  );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.options.timeoutMs ?? 120_000,
  );
  timeout.unref();

  let response: Response;
  try {
    response = await fetch(`https://${hostname}${path}`, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = (await response.json()) as BedrockChatResponse;
  if (!response.ok) {
    throw new Error(
      `Bedrock model request failed (${response.status}): ${responseBody.error?.message ?? "unknown error"}`,
    );
  }
  const message = responseBody.choices?.[0]?.message;
  if (!message?.content) {
    throw new Error("Bedrock model returned no final content");
  }
  return {
    model: input.options.model,
    content: message.content,
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
  };
}
