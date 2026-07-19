import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const publicUrl = process.env.NIYAM_PUBLIC_URL?.replace(/\/$/, "");
if (!publicUrl) {
  console.error(
    "Set NIYAM_PUBLIC_URL to the deployed HTTPS origin before running this check.",
  );
  process.exit(1);
}

const api = `${publicUrl}/api/niyam`;
const session = `smoke_${randomUUID().replaceAll("-", "")}`;
const evidenceOutput = process.env.NIYAM_EVIDENCE_OUTPUT;

async function rawRequest(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Niyam-Session": session,
      ...init.headers,
    },
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function request(path, init = {}) {
  const { response, body } = await rawRequest(path, init);
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${body.message ?? "unknown error"}`,
    );
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log("1/7 Public service and live AI configuration");
  const [health, capabilities] = await Promise.all([
    request("/health"),
    request("/v1/policy-ci/capabilities"),
  ]);
  assert(
    health.service === "niyam-evidence-api",
    "Evidence API is not healthy",
  );
  assert(
    capabilities.status === "live-ai-configured",
    "Live AI is not configured",
  );
  assert(
    capabilities.fallbackAllowed === false,
    "Judge mode allows a hidden fallback",
  );

  console.log("2/7 Hindi complaint and deterministic disagreement");
  const complaint = await request("/v1/policy-ci/complaints", {
    method: "POST",
    body: JSON.stringify({
      complaint:
        "मेरी आय ₹ 300,000 है, मेरी आयु 30 वर्ष है और मैं दिव्यांग हूँ, लेकिन आवेदन अस्वीकार हुआ।",
      language: "hi",
      decisionDate: "2026-07-18",
    }),
  });
  assert(
    complaint.disagreement === true,
    "The seeded affected-person case was not found",
  );

  console.log(
    "3/7 Page-aware PDF extraction, live rule reading, and human approval",
  );
  const policyPdf = await readFile(
    new URL("../output/pdf/niyam-demo-policy.pdf", import.meta.url),
  );
  const document = await request("/v1/policy-ci/documents", {
    method: "POST",
    body: JSON.stringify({
      filename: "niyam-demo-policy.pdf",
      mimeType: "application/pdf",
      language: "en",
      contentBase64: policyPdf.toString("base64"),
    }),
  });
  assert(
    document.extraction === "pypdf",
    "The policy PDF was not parsed by the PDF service",
  );
  assert(document.pages.length === 1, "The PDF page citation was not retained");
  const draft = await request("/v1/policy-ci/drafts", {
    method: "POST",
    body: JSON.stringify({
      documentId: document.id,
      language: "en",
      effectiveFrom: "2026-08-01",
    }),
  });
  assert(
    draft.status === "awaiting-policy-owner",
    "Policy extraction did not produce an approvable contract",
  );
  assert(
    draft.compilation?.extraction?.provider === "amazon-bedrock",
    "Policy extraction did not use live Bedrock AI",
  );
  const approval = await request(`/v1/policy-ci/drafts/${draft.id}/approve`, {
    method: "POST",
    body: JSON.stringify({
      approver: {
        id: "smoke-owner",
        name: "Production smoke test",
        role: "policy-owner",
      },
    }),
  });
  assert(
    approval.impact.label === "synthetic-sample-not-real-population",
    "Impact evidence is not labelled synthetic",
  );

  console.log("4/7 Isolated live-AI source repair");
  const repair = await request("/v1/policy-ci/repairs", {
    method: "POST",
    body: JSON.stringify({ draftId: draft.id, target: "node" }),
  });
  assert(repair.ai.used === true, "Repair did not use the configured AI agent");
  assert(
    repair.originalReplay.outcomeCode === "INELIGIBLE",
    "Original failure did not replay",
  );
  assert(
    repair.repairedReplay.outcomeCode === "ELIGIBLE",
    "Repaired decision is not eligible",
  );
  const prematureEvidence = await rawRequest(
    `/v1/policy-ci/repairs/${repair.runId}/evidence`,
    {
      method: "POST",
      body: JSON.stringify({ publicExport: true }),
    },
  );
  assert(
    prematureEvidence.response.status === 400,
    "The API allowed evidence signing before both approvals",
  );

  console.log("5/7 Independent tests and adversarial review");
  assert(
    repair.verification.every((check) => check.passed),
    "A repair verification command failed",
  );
  assert(
    repair.adversarialReview.casesGenerated === 112,
    "The 112-case review did not run",
  );
  assert(
    repair.adversarialReview.counterexamplesFound === 0,
    "A counterexample remains after repair",
  );

  console.log("6/7 Dual human gate and signed evidence");
  for (const approver of [
    { id: "smoke-owner", name: "Production smoke test", role: "policy-owner" },
    { id: "smoke-engineer", name: "Production smoke test", role: "engineer" },
  ]) {
    await request(`/v1/policy-ci/repairs/${repair.runId}/approvals`, {
      method: "POST",
      body: JSON.stringify({ approver }),
    });
  }
  const evidence = await request(
    `/v1/policy-ci/repairs/${repair.runId}/evidence`,
    {
      method: "POST",
      body: JSON.stringify({ publicExport: true }),
    },
  );
  assert(
    evidence.signature.keySource === "environment",
    "Production evidence is not using the stable signing key",
  );

  console.log("7/7 Portable signature and content-integrity verification");
  const verification = await request("/v1/policy-ci/evidence/verify", {
    method: "POST",
    body: JSON.stringify({
      payload: evidence.signedPayload,
      signature: evidence.signature.signature,
      publicKey: evidence.signature.publicKey,
      publicKeyFingerprint: evidence.signature.publicKeyFingerprint,
      integrityHash: evidence.integrityHash,
    }),
  });
  assert(verification.valid === true, "The exported evidence did not verify");
  if (evidenceOutput) {
    await writeFile(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Saved verified production evidence to ${evidenceOutput}`);
  }
  const tamperedPayload = structuredClone(evidence.signedPayload);
  tamperedPayload.authority.automaticMerge = true;
  const tamperedVerification = await request("/v1/policy-ci/evidence/verify", {
    method: "POST",
    body: JSON.stringify({
      payload: tamperedPayload,
      signature: evidence.signature.signature,
      publicKey: evidence.signature.publicKey,
      publicKeyFingerprint: evidence.signature.publicKeyFingerprint,
      integrityHash: evidence.integrityHash,
    }),
  });
  assert(
    tamperedVerification.valid === false,
    "Tampered evidence unexpectedly passed verification",
  );
  console.log(
    "PASS: the public judge journey is live, gated, repaired, tested, signed, and verified.",
  );
}

try {
  await run();
} finally {
  await request("/v1/policy-ci/reset", {
    method: "POST",
    body: JSON.stringify({}),
  }).catch(() => undefined);
}
