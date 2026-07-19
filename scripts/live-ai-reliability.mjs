import { randomUUID } from "node:crypto";

const publicUrl = process.env.NIYAM_PUBLIC_URL?.replace(/\/$/, "");
const runCount = Number(process.env.NIYAM_RELIABILITY_RUNS ?? 12);

if (!publicUrl) {
  throw new Error("Set NIYAM_PUBLIC_URL to the deployed HTTPS origin");
}
if (!Number.isInteger(runCount) || runCount < 1) {
  throw new Error("NIYAM_RELIABILITY_RUNS must be a positive integer");
}

const api = `${publicUrl}/api/niyam`;
const policies = [
  {
    name: "sample",
    text: "Applicants with annual household income up to and including INR 437,500 are eligible. Applicants must be 27 years old or younger. Applicants with disabilities receive a 4 year age relaxation.",
  },
  {
    name: "manual-425k",
    text: "The scholarship accepts applicants whose annual household income is INR 425,000 or less. Applicants must be no older than 26 years. A documented disability extends the age limit by 5 years.",
  },
  {
    name: "manual-480k",
    text: "Applicants qualify when annual household income is at or below INR 480,000. The standard age limit is 28 years inclusive. Applicants with disabilities receive an additional 3 years of age relaxation.",
  },
];

async function rawRequest(session, path, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Niyam-Session": session,
      ...init.headers,
    },
    signal: AbortSignal.timeout(180_000),
  });
  const responseText = await response.text();
  let body;
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(
      `${path} returned malformed JSON (${response.status}): ${responseText.slice(0, 200)}`,
    );
  }
  return {
    response,
    body,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

async function request(session, path, init = {}) {
  const result = await rawRequest(session, path, init);
  if (!result.response.ok) {
    const message = Array.isArray(result.body?.message)
      ? result.body.message.join(" ")
      : result.body?.message;
    throw new Error(
      `${path} returned ${result.response.status}: ${message ?? "unknown error"}`,
    );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];

for (let index = 0; index < runCount; index += 1) {
  const session = `reliability_${randomUUID().replaceAll("-", "")}`;
  const policy = policies[index % policies.length];
  const target = index % 2 === 0 ? "node" : "python";
  const runStartedAt = performance.now();
  const result = {
    run: index + 1,
    policy: policy.name,
    target,
    success: false,
  };

  try {
    const capabilities = await request(session, "/v1/policy-ci/capabilities");
    assert(
      capabilities.body.status === "live-ai-configured",
      `runtime status was ${capabilities.body.status}`,
    );

    const complaint = await request(session, "/v1/policy-ci/complaints", {
      method: "POST",
      body: JSON.stringify({
        complaint:
          "मेरी आय ₹ 300,000 है, मेरी आयु 30 वर्ष है और मैं दिव्यांग हूँ, लेकिन आवेदन अस्वीकार हुआ।",
        language: "hi",
        decisionDate: "2026-07-18",
      }),
    });
    assert(
      complaint.body.disagreement === true,
      "Aarohi case did not disagree",
    );

    const draft = await request(session, "/v1/policy-ci/drafts", {
      method: "POST",
      body: JSON.stringify({
        policyText: policy.text,
        language: "en",
        effectiveFrom: "2026-08-01",
      }),
    });
    result.extractionMs = draft.durationMs;
    assert(
      draft.body.status === "awaiting-policy-owner",
      `draft status was ${draft.body.status}`,
    );
    assert(
      draft.body.compilation?.extraction?.provider === "amazon-bedrock",
      "draft did not use Amazon Bedrock",
    );
    assert(
      draft.body.compilation?.extractedRules?.length === 3,
      "draft did not return exactly three validated rules",
    );

    await request(session, `/v1/policy-ci/drafts/${draft.body.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        approver: {
          id: `reliability-owner-${index + 1}`,
          name: "Reliability test owner",
          role: "policy-owner",
        },
      }),
    });

    const repair = await request(session, "/v1/policy-ci/repairs", {
      method: "POST",
      body: JSON.stringify({ draftId: draft.body.id, target }),
    });
    result.repairMs = repair.durationMs;
    result.model = repair.body.ai?.model;
    assert(repair.body.ai?.used === true, "repair did not use live AI");
    assert(
      repair.body.originalReplay?.outcomeCode === "INELIGIBLE",
      "original decision did not replay as INELIGIBLE",
    );
    assert(
      repair.body.repairedReplay?.outcomeCode === "ELIGIBLE",
      "repaired decision did not replay as ELIGIBLE",
    );
    assert(
      repair.body.verification?.every((check) => check.passed),
      "a verification check failed",
    );
    assert(
      repair.body.adversarialReview?.counterexamplesFound === 0,
      "adversarial review found a counterexample",
    );

    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.totalMs = Math.round(performance.now() - runStartedAt);
    results.push(result);
    console.log(JSON.stringify(result));
    await rawRequest(session, "/v1/policy-ci/reset", {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }
}

const successful = results.filter((result) => result.success);
const average = (key) =>
  successful.length === 0
    ? null
    : Math.round(
        successful.reduce((sum, result) => sum + (result[key] ?? 0), 0) /
          successful.length,
      );
const summary = {
  runs: results.length,
  successes: successful.length,
  failures: results.length - successful.length,
  successRate: results.length ? successful.length / results.length : 0,
  averageExtractionMs: average("extractionMs"),
  averageRepairMs: average("repairMs"),
  averageTotalMs: average("totalMs"),
  failuresByMessage: results
    .filter((result) => result.error)
    .map((result) => ({ run: result.run, error: result.error })),
};

console.log(`SUMMARY ${JSON.stringify(summary)}`);
process.exitCode = summary.failures === 0 ? 0 : 1;
