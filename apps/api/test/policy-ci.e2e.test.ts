import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

const policyText =
  "Applicants with annual household income up to and including INR 437,500 are eligible. Applicants must be 27 years old or younger. Applicants with disabilities receive a 4 year age relaxation.";

describe("Niyam Policy CI", () => {
  let app: INestApplication;
  let draftId = "";
  let runId = "";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes policy history and four real adapter surfaces", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/workspace")
      .expect(200);
    expect(response.body.category).toBe("Policy CI");
    expect(response.body.versions).toHaveLength(3);
    expect(
      response.body.adapters.map((item: { kind: string }) => item.kind),
    ).toEqual(["node", "python", "openapi", "browser"]);

    const capabilities = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/capabilities")
      .expect(200);
    expect(capabilities.body).toMatchObject({
      mode: "development",
      status: "safe-local-fallback",
      fallbackAllowed: true,
      authority: {
        modelMakesEligibilityDecisions: false,
        humanPolicyApprovalRequired: true,
        deterministicVerificationRequired: true,
        automaticMerge: false,
      },
    });
  });

  it("makes ambiguity a blocking product state", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/drafts")
      .send({
        policyText: "Exceptional hardship may be considered where appropriate.",
        language: "en",
      })
      .expect(201);
    expect(response.body.status).toBe("needs-clarification");
    expect(response.body.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNDEFINED_TERM",
          severity: "blocking",
        }),
        expect.objectContaining({
          code: "DISCRETIONARY_LANGUAGE",
          severity: "blocking",
        }),
        expect.objectContaining({ code: "MISSING_EFFECTIVE_DATE" }),
      ]),
    );
  });

  it("creates, explicitly approves, and impact-tests a judge policy", async () => {
    const draft = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/drafts")
      .send({ policyText, language: "en", effectiveFrom: "2026-08-01" })
      .expect(201);
    expect(draft.body.status).toBe("awaiting-policy-owner");
    draftId = draft.body.id;

    const approval = await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/drafts/${draftId}/approve`)
      .send({
        approver: {
          id: "judge-001",
          name: "Hackathon judge",
          role: "policy-owner",
        },
      })
      .expect(201);
    expect(approval.body.version.status).toBe("scheduled");
    expect(approval.body.version.approvals[0].id).toBe("judge-001");
    expect(approval.body.impact.label).toBe(
      "synthetic-sample-not-real-population",
    );

    await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/drafts/${draftId}/approve`)
      .send({
        approver: {
          id: "judge-001",
          name: "Hackathon judge",
          role: "policy-owner",
        },
      })
      .expect(400);

    const scheduledHistory = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/time-machine/decisions")
      .send({
        decisionDate: "2026-08-01",
        applicant: {
          annualHouseholdIncome: 437500,
          age: 27,
          hasDisability: false,
        },
      })
      .expect(201);
    expect(scheduledHistory.body.governingPolicy.id).toBe(
      approval.body.version.id,
    );
  });

  it("compiles the supported Hindi policy subset", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/drafts")
      .send({
        policyText:
          "₹ 300,000 तक वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु 25 वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को आयु में 5 वर्ष की छूट मिलेगी।",
        language: "hi",
        effectiveFrom: "2026-09-01",
      })
      .expect(201);
    expect(response.body.status).toBe("awaiting-policy-owner");
    expect(response.body.compilation.parameters).toMatchObject({
      incomeCap: 300000,
      standardAgeLimit: 25,
      disabilityRelaxationYears: 5,
    });
  });

  it.each([
    [
      "वार्षिक पारिवारिक आय ₹ 425,000 से अधिक नहीं होनी चाहिए। आवेदक की आयु 26 वर्ष से अधिक नहीं होनी चाहिए। दिव्यांग आवेदकों को आयु में 5 वर्ष की छूट मिलेगी।",
      425000,
      26,
      5,
    ],
    [
      "अधिकतम वार्षिक घरेलू आय ₹ 480,000 है। अधिकतम आयु 28 वर्ष है। विकलांग आवेदकों की आयु सीमा 3 वर्ष बढ़ेगी।",
      480000,
      28,
      3,
    ],
    [
      "₹ 350,000 या कम वार्षिक आय वाले आवेदक पात्र हैं। आयु 27 साल तक होनी चाहिए। दिव्यांग आवेदकों को 4 अतिरिक्त वर्ष मिलते हैं।",
      350000,
      27,
      4,
    ],
    [
      "4.5 लाख तक वार्षिक आय वाले आवेदक पात्र हैं। आयु सीमा 29 साल है। दिव्यांग आवेदकों को अतिरिक्त 6 वर्ष मिलते हैं।",
      450000,
      29,
      6,
    ],
    [
      "₹ ३७५,००० तक वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु २४ वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को आयु में ४ वर्ष की छूट मिलेगी।",
      375000,
      24,
      4,
    ],
  ])(
    "compiles safe inclusive Hindi paraphrase %#",
    async (submittedPolicy, incomeCap, ageLimit, relaxation) => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/policy-ci/drafts")
        .set("X-Niyam-Session", `hindi_valid_${incomeCap}`)
        .send({
          policyText: submittedPolicy,
          language: "hi",
          effectiveFrom: "2026-09-01",
        })
        .expect(201);
      expect(response.body.status).toBe("awaiting-policy-owner");
      expect(response.body.compilation.parameters).toMatchObject({
        incomeCap,
        standardAgeLimit: ageLimit,
        disabilityRelaxationYears: relaxation,
      });
    },
  );

  it.each([
    "₹ 300,000 से कम वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु 25 वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को आयु में 5 वर्ष की छूट मिलेगी।",
    "₹ 300,000 तक वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु 25 वर्ष से कम होनी चाहिए। दिव्यांग आवेदकों को आयु में 5 वर्ष की छूट मिलेगी।",
    "₹ 300,000 तक आय वाले आवेदक पात्र हैं और ₹ 400,000 तक आय वाले आवेदक भी पात्र हैं। आवेदक की आयु 25 वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को आयु में 5 वर्ष की छूट मिलेगी।",
    "₹ 300,000 तक वार्षिक आय वाले आवेदक पात्र हैं। आवेदक की आयु 25 वर्ष या कम होनी चाहिए। दिव्यांग आवेदकों को विशेष छूट मिल सकती है।",
  ])("stops on ambiguous Hindi wording %#", async (submittedPolicy) => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/drafts")
      .set("X-Niyam-Session", "hindi_blocked_tests")
      .send({
        policyText: submittedPolicy,
        language: "hi",
        effectiveFrom: "2026-09-01",
      })
      .expect(201);
    expect(response.body.status).toBe("needs-clarification");
  });

  it("answers historical policy questions and creates a Hindi appeal", async () => {
    const history = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/time-machine/decisions")
      .send({
        decisionDate: "2026-03-18",
        applicant: {
          annualHouseholdIncome: 250000,
          age: 25,
          hasDisability: false,
        },
      })
      .expect(201);
    expect(history.body.governingPolicy.id).toBe("policy-v1");
    expect(history.body.evaluation.decision.code).toBe("ELIGIBLE");

    const complaint = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/complaints")
      .send({
        complaint:
          "मेरी आय ₹ 300,000 है, मेरी आयु 30 वर्ष है और मैं दिव्यांग हूँ, लेकिन आवेदन अस्वीकार हुआ।",
        language: "hi",
        decisionDate: "2026-07-18",
      })
      .expect(201);
    expect(complaint.body.language).toBe("hi");
    expect(complaint.body.disagreement).toBe(true);
    expect(complaint.body.appealDocument.mimeType).toBe("text/html");

    await request(app.getHttpServer())
      .post("/api/v1/policy-ci/complaints")
      .send({
        complaint: "My scholarship application was rejected.",
        language: "en",
        decisionDate: "2026-07-18",
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toContain(
          "Niyam never invents missing decision facts",
        );
      });
  });

  it("repairs a real isolated Node repository and signs its evidence", async () => {
    const repair = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/repairs")
      .send({ draftId, target: "node" })
      .expect(201);
    runId = repair.body.runId;
    expect(repair.body.mode).toBe("offline-supported-repair");
    expect(repair.body.patch).toContain("income <= 437500");
    expect(repair.body.originalReplay.outcomeCode).toBe("INELIGIBLE");
    expect(repair.body.repairedReplay.outcomeCode).toBe("ELIGIBLE");
    expect(
      repair.body.verification.every(
        (item: { passed: boolean }) => item.passed,
      ),
    ).toBe(true);
    expect(repair.body.adversarialReview).toMatchObject({
      status: "passed",
      casesGenerated: 112,
      counterexamplesFound: 0,
      policyBranches: { covered: 4, total: 4 },
    });
    expect(repair.body.commitHash).toMatch(/^[a-f0-9]{40}$/);

    await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/repairs/${runId}/evidence`)
      .send({ publicExport: true })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/repairs/${runId}/publish`)
      .send({ repository: "owner/decision-app", confirmPublish: false })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/repairs/${runId}/publish`)
      .send({ repository: "owner/decision-app", confirmPublish: true })
      .expect(400);

    for (const approver of [
      { id: "judge-001", name: "Hackathon judge", role: "policy-owner" },
      { id: "engineer-001", name: "Aarav", role: "engineer" },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/policy-ci/repairs/${runId}/approvals`)
        .send({ approver })
        .expect(201);
    }

    const evidence = await request(app.getHttpServer())
      .post(`/api/v1/policy-ci/repairs/${runId}/evidence`)
      .send({ publicExport: true })
      .expect(201);
    expect(evidence.body.signature.algorithm).toBe("Ed25519");
    expect(evidence.body.integrityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.body.approvals).toHaveLength(2);
    expect(evidence.body.authority.automaticMerge).toBe(false);
    expect(evidence.body.signedPayload).toBeDefined();

    const verification = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/evidence/verify")
      .send({
        payload: evidence.body.signedPayload,
        signature: evidence.body.signature.signature,
        publicKey: evidence.body.signature.publicKey,
        publicKeyFingerprint: evidence.body.signature.publicKeyFingerprint,
        integrityHash: evidence.body.integrityHash,
      })
      .expect(201);
    expect(verification.body).toMatchObject({
      valid: true,
      signatureValid: true,
      integrityValid: true,
      fingerprintValid: true,
    });

    const tampered = structuredClone(evidence.body.signedPayload);
    tampered.authority.automaticMerge = true;
    const rejectedTamper = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/evidence/verify")
      .send({
        payload: tampered,
        signature: evidence.body.signature.signature,
        publicKey: evidence.body.signature.publicKey,
        publicKeyFingerprint: evidence.body.signature.publicKeyFingerprint,
        integrityHash: evidence.body.integrityHash,
      })
      .expect(201);
    expect(rejectedTamper.body.valid).toBe(false);
  }, 30_000);

  it("repairs and verifies a real Python decision application", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/repairs")
      .send({ draftId, target: "python" })
      .expect(201);
    expect(response.body.target).toBe("python");
    expect(response.body.repairedReplay.outcomeCode).toBe("ELIGIBLE");
    expect(response.body.policyTests).toEqual({ passed: 5, total: 5 });
    expect(response.body.adversarialReview.status).toBe("passed");
  }, 30_000);

  it("restores the seeded judge workspace on demand", async () => {
    const reset = await request(app.getHttpServer())
      .post("/api/v1/policy-ci/reset")
      .send({})
      .expect(201);
    expect(reset.body.status).toBe("reset");
    const workspace = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/workspace")
      .expect(200);
    expect(workspace.body.versions).toHaveLength(3);
    expect(workspace.body.repairs).toHaveLength(0);
  });

  it("isolates judge workspaces and reset operations by session", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/policy-ci/drafts")
      .set("X-Niyam-Session", "judge_session_alpha")
      .send({ policyText, language: "en", effectiveFrom: "2026-08-01" })
      .expect(201);

    const alpha = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/workspace")
      .set("X-Niyam-Session", "judge_session_alpha")
      .expect(200);
    const beta = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/workspace")
      .set("X-Niyam-Session", "judge_session_beta")
      .expect(200);
    expect(alpha.body.drafts).toHaveLength(1);
    expect(beta.body.drafts).toHaveLength(0);

    await request(app.getHttpServer())
      .post("/api/v1/policy-ci/reset")
      .set("X-Niyam-Session", "judge_session_alpha")
      .send({})
      .expect(201);
    const betaAfterReset = await request(app.getHttpServer())
      .get("/api/v1/policy-ci/workspace")
      .set("X-Niyam-Session", "judge_session_beta")
      .expect(200);
    expect(betaAfterReset.body.versions).toHaveLength(3);
    expect(betaAfterReset.body.drafts).toHaveLength(0);
  });
});
