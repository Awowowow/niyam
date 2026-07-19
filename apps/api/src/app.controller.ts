import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("system")
@Controller()
export class AppController {
  @Get("health")
  @ApiOperation({ summary: "Check whether the Niyam API is ready" })
  health(): Record<string, unknown> {
    return {
      status: "ok",
      service: "niyam-evidence-api",
      version: "0.1.0",
      guarantees: [
        "human-approved policy contract",
        "deterministic decisions",
        "no automatic merge",
      ],
    };
  }
}
