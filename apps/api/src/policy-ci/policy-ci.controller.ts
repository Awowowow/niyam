import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ApprovalIdentity, SupportedLanguage } from "./policy-ci.types";
import { PolicyCiService } from "./policy-ci.service";

@ApiTags("policy ci")
@Controller("v1/policy-ci")
export class PolicyCiController {
  constructor(private readonly policyCi: PolicyCiService) {}

  @Get("workspace")
  @ApiOperation({ summary: "Open the complete seeded Policy CI workspace" })
  workspace() {
    return this.policyCi.workspace();
  }

  @Get("capabilities")
  @ApiOperation({ summary: "Report live AI and safety-gate configuration" })
  capabilities() {
    return this.policyCi.capabilities();
  }

  @Post("reset")
  @ApiOperation({ summary: "Restore the example scholarship workspace" })
  reset() {
    return this.policyCi.reset();
  }

  @Post("documents")
  @ApiOperation({ summary: "Ingest English or Hindi text/PDF policy evidence" })
  async ingestDocument(
    @Body()
    body: {
      filename: string;
      mimeType: "application/pdf" | "text/plain";
      language: SupportedLanguage;
      contentBase64?: string;
      text?: string;
    },
  ) {
    try {
      return await this.policyCi.ingestDocument(body);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Document ingestion failed",
      );
    }
  }

  @Post("drafts")
  @ApiOperation({ summary: "Extract a draft contract and expose ambiguity" })
  async createDraft(
    @Body()
    body: {
      documentId?: string;
      policyText?: string;
      language?: SupportedLanguage;
      effectiveFrom?: string;
      translatedText?: string;
    },
  ) {
    return await this.policyCi.createDraft(body);
  }

  @Post("drafts/:draftId/approve")
  @ApiOperation({ summary: "Record explicit policy-owner approval" })
  approveDraft(
    @Param("draftId") draftId: string,
    @Body() body: { approver: ApprovalIdentity },
  ) {
    return this.policyCi.approveDraft(draftId, body.approver);
  }

  @Post("impact")
  @ApiOperation({
    summary: "Calculate gains and losses across fictional example applicants",
  })
  impact(
    @Body()
    body: {
      fromVersionId: string;
      toVersionId?: string;
      draftId?: string;
    },
  ) {
    return this.policyCi.impact(body);
  }

  @Post("time-machine/decisions")
  @ApiOperation({
    summary: "Evaluate which policy and code governed a historical decision",
  })
  decisionAt(
    @Body()
    body: {
      decisionDate: string;
      applicant: {
        annualHouseholdIncome: number;
        age: number;
        hasDisability: boolean;
      };
    },
  ) {
    return this.policyCi.decisionAt(body);
  }

  @Post("complaints")
  @ApiOperation({
    summary: "Reconstruct an English or Hindi citizen complaint and appeal",
  })
  complaint(
    @Body()
    body: {
      complaint: string;
      language: SupportedLanguage;
      decisionDate: string;
      transcript?: string;
    },
  ) {
    return this.policyCi.createComplaint(body);
  }

  @Post("repairs")
  @ApiOperation({ summary: "Repair a real isolated Node or Python repository" })
  runRepair(@Body() body: { draftId: string; target: "node" | "python" }) {
    return this.policyCi.runRepair(body);
  }

  @Post("repairs/:runId/approvals")
  @ApiOperation({ summary: "Record policy-owner or engineer repair approval" })
  approveRepair(
    @Param("runId") runId: string,
    @Body() body: { approver: ApprovalIdentity },
  ) {
    return this.policyCi.approveRepair(runId, body.approver);
  }

  @Post("repairs/:runId/evidence")
  @ApiOperation({
    summary: "Create signed evidence for an approved and verified repair",
  })
  evidence(
    @Param("runId") runId: string,
    @Body() body: { publicExport?: boolean },
  ) {
    return this.policyCi.evidence(runId, body);
  }

  @Post("evidence/verify")
  @ApiOperation({ summary: "Verify an evidence-bundle signature" })
  verifyEvidence(
    @Body()
    body: {
      payload: unknown;
      signature: string;
      publicKey?: string;
      publicKeyFingerprint?: string;
      integrityHash?: string;
    },
  ) {
    return this.policyCi.verifyEvidence(body);
  }

  @Post("repairs/:runId/publish")
  @ApiOperation({
    summary: "Push an approved branch and open a real GitHub pull request",
  })
  publish(
    @Param("runId") runId: string,
    @Body()
    body: {
      repository: string;
      baseBranch?: string;
      confirmPublish: boolean;
    },
  ) {
    return this.policyCi.publishPullRequest(runId, body);
  }

  @Post("versions/:versionId/rollback")
  @ApiOperation({ summary: "Record a human-approved policy rollback" })
  rollback(
    @Param("versionId") versionId: string,
    @Body() body: { approver: ApprovalIdentity },
  ) {
    return this.policyCi.rollback(versionId, body.approver);
  }
}
