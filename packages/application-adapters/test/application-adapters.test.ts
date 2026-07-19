import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCommandDecisionAdapter,
  createBrowserDecisionAdapter,
  createFunctionDecisionAdapter,
  createOpenApiDecisionAdapterFromDocument,
} from "../src";

const browserExecutable = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].find(existsSync);

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("application adapters", () => {
  it("wraps a deterministic decision function with trace evidence", async () => {
    const adapter = createFunctionDecisionAdapter({
      name: "local decision",
      evaluate: () => ({ outcomeCode: "ELIGIBLE" }),
    });
    const result = await adapter.evaluate({ applicant: { income: 1 } });
    expect(result.outcomeCode).toBe("ELIGIBLE");
    expect(result.trace?.adapter).toBe("function");
  });

  it("evaluates a real OpenAPI-shaped HTTP decision endpoint", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ decision: { code: "ELIGIBLE", reason: "test" } }),
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const adapter = createOpenApiDecisionAdapterFromDocument({
      name: "HTTP scholarship app",
      document: {
        openapi: "3.1.0",
        servers: [{ url: `http://127.0.0.1:${address.port}` }],
        paths: {
          "/decide": { post: { operationId: "decideScholarship" } },
        },
      },
      operationId: "decideScholarship",
      outcomePath: "decision.code",
      explanationPath: "decision.reason",
    });
    const result = await adapter.evaluate({ applicant: { income: 1 } });
    expect(result).toMatchObject({
      outcomeCode: "ELIGIBLE",
      explanation: "test",
      trace: { adapter: "openapi" },
    });
  });

  it("refuses an OpenAPI document without the requested operation", () => {
    expect(() =>
      createOpenApiDecisionAdapterFromDocument({
        name: "Unknown operation",
        document: { openapi: "3.1.0", paths: {} },
        operationId: "missingDecision",
        baseUrl: "http://127.0.0.1:1",
        outcomePath: "decision.code",
      }),
    ).toThrow("operationId missingDecision was not found");
  });

  it("executes both Node and Python decision applications", async () => {
    const directory = await mkdtemp(join(tmpdir(), "niyam-adapters-"));
    const nodeScript = join(directory, "decision.mjs");
    const pythonScript = join(directory, "decision.py");
    await writeFile(
      nodeScript,
      'process.stdin.on("data",()=>{});process.stdin.on("end",()=>console.log(JSON.stringify({outcomeCode:"ELIGIBLE"})));',
    );
    await writeFile(
      pythonScript,
      'import sys\nsys.stdin.read()\nprint("{\\"outcomeCode\\":\\"INELIGIBLE\\"}")\n',
    );
    const node = createCommandDecisionAdapter({
      name: "Node decision",
      runtime: "node",
      command: process.execPath,
      args: [nodeScript],
    });
    const python = createCommandDecisionAdapter({
      name: "Python decision",
      runtime: "python",
      command: "python3",
      args: [pythonScript],
    });
    await expect(node.evaluate({})).resolves.toMatchObject({
      outcomeCode: "ELIGIBLE",
      trace: { adapter: "node" },
    });
    await expect(python.evaluate({})).resolves.toMatchObject({
      outcomeCode: "INELIGIBLE",
      trace: { adapter: "python" },
    });
  });

  (browserExecutable ? it : it.skip)(
    "drives a real browser-only decision form through Playwright",
    async () => {
      const server = createServer((_request, response) => {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html>
          <html lang="en"><body>
            <form id="decision-form">
              <input id="income" />
              <input id="age" />
              <input id="disability" type="checkbox" />
              <button type="submit">Decide</button>
            </form>
            <output id="outcome"></output><p id="explanation"></p>
            <script>
              document.querySelector("#decision-form").addEventListener("submit", (event) => {
                event.preventDefault();
                const income = Number(document.querySelector("#income").value);
                const age = Number(document.querySelector("#age").value);
                const disability = document.querySelector("#disability").checked;
                const eligible = income <= 300000 && (age <= 25 || (disability && age <= 30));
                document.querySelector("#outcome").textContent = eligible ? "ELIGIBLE" : "INELIGIBLE";
                document.querySelector("#explanation").textContent = "Browser-only decision executed";
              });
            </script>
          </body></html>`);
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");

      const adapter = createBrowserDecisionAdapter({
        name: "Browser-only scholarship portal",
        url: `http://127.0.0.1:${address.port}`,
        executablePath: browserExecutable,
        fields: [
          { factPath: "applicant.annualHouseholdIncome", selector: "#income" },
          { factPath: "applicant.age", selector: "#age" },
          {
            factPath: "applicant.hasDisability",
            selector: "#disability",
            control: "checkbox",
          },
        ],
        submitSelector: 'button[type="submit"]',
        outcomeSelector: "#outcome",
        explanationSelector: "#explanation",
      });
      const result = await adapter.evaluate({
        applicant: {
          annualHouseholdIncome: 300_000,
          age: 30,
          hasDisability: true,
        },
      });
      expect(result).toMatchObject({
        outcomeCode: "ELIGIBLE",
        explanation: "Browser-only decision executed",
        trace: { adapter: "browser" },
      });
    },
    30_000,
  );
});
