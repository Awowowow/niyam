import { Module } from "@nestjs/common";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";
import { PolicyExtractionService } from "./policy-extraction.service";

@Module({
  controllers: [DemoController],
  providers: [DemoService, PolicyExtractionService],
  exports: [DemoService, PolicyExtractionService],
})
export class DemoModule {}
