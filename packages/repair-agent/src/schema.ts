export const agentRepairJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["repaired", "blocked"] },
    summary: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    tests_run: {
      type: "array",
      items: {
        type: "object",
        properties: {
          command: { type: "string" },
          status: { type: "string", enum: ["passed", "failed", "not-run"] },
        },
        required: ["command", "status"],
        additionalProperties: false,
      },
    },
    residual_risks: { type: "array", items: { type: "string" } },
  },
  required: [
    "status",
    "summary",
    "files_changed",
    "tests_run",
    "residual_risks",
  ],
  additionalProperties: false,
} as const;
