import { afterEach, describe, expect, it } from "vitest";
import { extractPolicyDocument } from "../src/policy-ci/document.client";

const originalSolverUrl = process.env.NIYAM_SOLVER_URL;

afterEach(() => {
  if (originalSolverUrl === undefined) delete process.env.NIYAM_SOLVER_URL;
  else process.env.NIYAM_SOLVER_URL = originalSolverUrl;
});

describe("policy document safety", () => {
  it("accepts bounded UTF-8 text and strips path components from filenames", async () => {
    delete process.env.NIYAM_SOLVER_URL;
    const policy =
      "Applicants earning up to and including INR 300,000 are eligible.";
    const result = await extractPolicyDocument({
      filename: "../../policy.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from(policy).toString("base64"),
    });
    expect(result.filename).toBe("policy.txt");
    expect(result.text).toBe(policy);
  });

  it("rejects a file labelled PDF when its bytes are not a PDF", async () => {
    await expect(
      extractPolicyDocument({
        filename: "policy.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("not-a-pdf").toString("base64"),
      }),
    ).rejects.toThrow("not a valid PDF");
  });

  it("rejects documents larger than the public five-megabyte limit", async () => {
    await expect(
      extractPolicyDocument({
        filename: "policy.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1, 65).toString("base64"),
      }),
    ).rejects.toThrow("5 MB or smaller");
  });
});
