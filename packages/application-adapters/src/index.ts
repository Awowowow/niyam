import { spawn } from "node:child_process";
import { chromium, type Browser } from "playwright-core";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type FactMap = { [key: string]: JsonValue };

export interface DecisionResult {
  outcomeCode: string;
  explanation?: string;
  raw?: JsonValue;
  trace?: {
    adapter: "node" | "python" | "openapi" | "browser" | "function";
    target: string;
    durationMs: number;
  };
}

export interface DecisionAdapter {
  name: string;
  kind: DecisionResult["trace"] extends infer T
    ? T extends { adapter: infer A }
      ? A
      : never
    : never;
  evaluate(facts: FactMap): Promise<DecisionResult>;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function withTrace(
  result: Omit<DecisionResult, "trace">,
  adapter: NonNullable<DecisionResult["trace"]>["adapter"],
  target: string,
  startedAt: number,
): DecisionResult {
  return {
    ...result,
    trace: { adapter, target, durationMs: Date.now() - startedAt },
  };
}

async function runCommandWithInput(input: {
  command: string;
  args: string[];
  cwd?: string;
  stdin: string;
  timeoutMs: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${input.command} timed out`));
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${input.command} exited ${code}: ${stderr}`));
    });
    child.stdin.end(input.stdin);
  });
}

export function createFunctionDecisionAdapter(input: {
  name: string;
  evaluate: (
    facts: FactMap,
  ) => Omit<DecisionResult, "trace"> | Promise<Omit<DecisionResult, "trace">>;
}): DecisionAdapter {
  return {
    name: input.name,
    kind: "function",
    async evaluate(facts) {
      const startedAt = Date.now();
      return withTrace(
        await input.evaluate(facts),
        "function",
        input.name,
        startedAt,
      );
    },
  };
}

export function createCommandDecisionAdapter(input: {
  name: string;
  runtime: "node" | "python";
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}): DecisionAdapter {
  return {
    name: input.name,
    kind: input.runtime,
    async evaluate(facts) {
      const startedAt = Date.now();
      const stdout = await runCommandWithInput({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? 10_000,
        stdin: JSON.stringify(facts),
      });
      const parsed = JSON.parse(stdout.trim()) as {
        outcomeCode?: unknown;
        explanation?: unknown;
        raw?: JsonValue;
      };
      if (typeof parsed.outcomeCode !== "string") {
        throw new Error(`${input.name} did not return an outcomeCode`);
      }
      return withTrace(
        {
          outcomeCode: parsed.outcomeCode,
          ...(typeof parsed.explanation === "string"
            ? { explanation: parsed.explanation }
            : {}),
          ...(parsed.raw === undefined ? {} : { raw: parsed.raw }),
        },
        input.runtime,
        `${input.command} ${input.args.join(" ")}`,
        startedAt,
      );
    },
  };
}

export function createOpenApiDecisionAdapter(input: {
  name: string;
  endpoint: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  outcomePath: string;
  explanationPath?: string;
  timeoutMs?: number;
}): DecisionAdapter {
  return {
    name: input.name,
    kind: "openapi",
    async evaluate(facts) {
      const startedAt = Date.now();
      const response = await fetch(input.endpoint, {
        method: input.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...input.headers,
        },
        body: JSON.stringify(facts),
        signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
      });
      const raw = (await response.json()) as JsonValue;
      if (!response.ok) {
        throw new Error(`${input.name} returned HTTP ${response.status}`);
      }
      const outcome = readPath(raw, input.outcomePath);
      const explanation = input.explanationPath
        ? readPath(raw, input.explanationPath)
        : undefined;
      if (typeof outcome !== "string") {
        throw new Error(
          `${input.name} response is missing string path ${input.outcomePath}`,
        );
      }
      return withTrace(
        {
          outcomeCode: outcome,
          ...(typeof explanation === "string" ? { explanation } : {}),
          raw,
        },
        "openapi",
        input.endpoint,
        startedAt,
      );
    },
  };
}

export interface OpenApiDecisionDocument {
  openapi: string;
  servers?: Array<{ url: string }>;
  paths: Record<
    string,
    Partial<
      Record<
        "post" | "put",
        {
          operationId?: string;
        }
      >
    >
  >;
}

export function createOpenApiDecisionAdapterFromDocument(input: {
  name: string;
  document: OpenApiDecisionDocument;
  operationId: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  outcomePath: string;
  explanationPath?: string;
  timeoutMs?: number;
}): DecisionAdapter {
  const match = Object.entries(input.document.paths)
    .flatMap(([path, operations]) =>
      (["post", "put"] as const).map((method) => ({
        path,
        method,
        operation: operations[method],
      })),
    )
    .find(
      (candidate) => candidate.operation?.operationId === input.operationId,
    );
  if (!match) {
    throw new Error(
      `OpenAPI operationId ${input.operationId} was not found in the document`,
    );
  }
  const baseUrl = input.baseUrl ?? input.document.servers?.[0]?.url;
  if (!baseUrl) {
    throw new Error(
      "OpenAPI decision adapter requires a baseUrl or servers[0].url",
    );
  }
  return createOpenApiDecisionAdapter({
    name: input.name,
    endpoint: `${baseUrl.replace(/\/$/, "")}${match.path.startsWith("/") ? "" : "/"}${match.path}`,
    method: match.method.toUpperCase() as "POST" | "PUT",
    headers: input.headers,
    outcomePath: input.outcomePath,
    explanationPath: input.explanationPath,
    timeoutMs: input.timeoutMs,
  });
}

export interface BrowserFieldBinding {
  factPath: string;
  selector: string;
  control?: "text" | "checkbox" | "select";
}

export function createBrowserDecisionAdapter(input: {
  name: string;
  url: string;
  executablePath?: string;
  fields: BrowserFieldBinding[];
  submitSelector: string;
  outcomeSelector: string;
  explanationSelector?: string;
  timeoutMs?: number;
}): DecisionAdapter {
  return {
    name: input.name,
    kind: "browser",
    async evaluate(facts) {
      const startedAt = Date.now();
      let browser: Browser | undefined;
      try {
        browser = await chromium.launch({
          headless: true,
          ...(input.executablePath
            ? { executablePath: input.executablePath }
            : {}),
        });
        const page = await browser.newPage();
        await page.goto(input.url, {
          waitUntil: "domcontentloaded",
          timeout: input.timeoutMs ?? 15_000,
        });
        for (const binding of input.fields) {
          const value = readPath(facts, binding.factPath);
          const locator = page.locator(binding.selector);
          if (binding.control === "checkbox") {
            await locator.setChecked(Boolean(value));
          } else if (binding.control === "select") {
            await locator.selectOption(String(value ?? ""));
          } else {
            await locator.fill(String(value ?? ""));
          }
        }
        await page.locator(input.submitSelector).click();
        const outcomeLocator = page.locator(input.outcomeSelector);
        await outcomeLocator.waitFor({
          state: "visible",
          timeout: input.timeoutMs ?? 15_000,
        });
        const outcomeCode = (await outcomeLocator.innerText()).trim();
        const explanation = input.explanationSelector
          ? (await page.locator(input.explanationSelector).innerText()).trim()
          : undefined;
        return withTrace(
          {
            outcomeCode,
            ...(explanation ? { explanation } : {}),
          },
          "browser",
          input.url,
          startedAt,
        );
      } finally {
        await browser?.close();
      }
    },
  };
}
