import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DemoService } from "./demo.service";

@ApiTags("policy verification example")
@Controller("v1/demo")
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Get()
  @ApiOperation({
    summary: "Show the approved rule and generated boundary cases",
  })
  scenario(): Record<string, unknown> {
    return this.demoService.scenario();
  }

  @Post("audits")
  @ApiOperation({ summary: "Find policy drift in the buggy scholarship app" })
  audit() {
    return this.demoService.auditLegacy();
  }

  @Post("repair-preview")
  @ApiOperation({
    summary: "Preview a minimal repair with before-and-after evidence",
  })
  repairPreview(): Promise<Record<string, unknown>> {
    return this.demoService.repairPreview();
  }

  @Post("challenges")
  @ApiOperation({
    summary: "Compile a submitted policy and regenerate the evidence",
  })
  async challenge(
    @Body()
    body: {
      policyText?: string;
      threshold?: string;
      approvedBy?: string;
    },
  ): Promise<Record<string, unknown>> {
    try {
      return await this.demoService.challenge(body);
    } catch (error) {
      throw new BadRequestException({
        message: error instanceof Error ? error.message : "Invalid challenge",
      });
    }
  }

  @Post("evidence-package")
  @ApiOperation({
    summary: "Create a downloadable evidence package for human review",
  })
  evidencePackage(): Promise<Record<string, unknown>> {
    return this.demoService.evidencePackage();
  }
}
