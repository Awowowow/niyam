import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";

describe("Niyam demo API", () => {
  let app: INestApplication;

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

  it("finds exactly one policy mismatch", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/demo/audits")
      .expect(201);
    expect(response.body.verdict).toBe("policy-drift-detected");
    expect(response.body.summary).toEqual({
      total: 3,
      matched: 2,
      mismatched: 1,
    });
  });

  it("returns a human-gated repair with conformant preview evidence", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/demo/repair-preview")
      .expect(201);
    expect(response.body.status).toBe("ready-for-human-review");
    expect(response.body.proof.after.verdict).toBe("conformant");
    expect(response.body.safety.autoMerge).toBe(false);
  });

  it("regenerates evidence when a reviewer changes the approved threshold", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/demo/challenges")
      .send({ threshold: "300000" })
      .expect(201);
    expect(response.body.status).toBe("ready");
    expect(response.body.scenario.generatedCases).toHaveLength(8);
    expect(response.body.scenario.extractedRules).toHaveLength(3);
    expect(response.body.audit.summary.mismatched).toBe(5);
    expect(response.body.repairPreview.proof.after.verdict).toBe("conformant");
    expect(response.body.repairPreview.independentReview.status).toBe("passed");
    expect(
      response.body.repairPreview.independentReview.casesGenerated,
    ).toBeGreaterThan(50);
    expect(response.body.scenario.policy.approved.approvedBy).toBe(
      "Policy reviewer",
    );
  });

  it("stops for clarification instead of guessing an ambiguous policy", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/demo/challenges")
      .send({ policyText: "Applicants with reasonable income may qualify." })
      .expect(201);
    expect(response.body.status).toBe("needs-clarification");
    expect(response.body.ambiguities).toHaveLength(3);
  });

  it("exports a proof-carrying review package without auto-merging", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/demo/evidence-package")
      .expect(201);
    expect(response.body.kind).toBe("niyam-proof-carrying-repair");
    expect(response.body.integrityHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(response.body.authority.automaticMerge).toBe(false);
    expect(response.body.pullRequestDraft.status).toBe("draft-not-pushed");
  });
});
