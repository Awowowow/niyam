import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { parsePolicyRule, type FactMap } from "@niyam/policy-ir";
import { evaluatePolicy } from "@niyam/rule-engine";

interface EvaluateRequest {
  policy: unknown;
  facts: FactMap;
}

@ApiTags("policy contracts")
@Controller("v1/policies")
export class PoliciesController {
  @Post("evaluate")
  @ApiOperation({
    summary: "Evaluate facts against an approved typed policy rule",
  })
  evaluate(@Body() request: EvaluateRequest) {
    try {
      const policy = parsePolicyRule(request.policy);
      return evaluatePolicy(policy, request.facts);
    } catch (error) {
      throw new BadRequestException({
        message: "The policy contract is invalid",
        details:
          error instanceof Error ? error.message : "Unknown validation error",
      });
    }
  }
}
