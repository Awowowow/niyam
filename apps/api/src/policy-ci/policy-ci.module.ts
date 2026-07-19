import { Module } from "@nestjs/common";
import { DemoModule } from "../demo/demo.module";
import { PolicyCiController } from "./policy-ci.controller";
import { PolicyCiService } from "./policy-ci.service";
import { RepositoryRepairService } from "./repository-repair.service";

@Module({
  imports: [DemoModule],
  controllers: [PolicyCiController],
  providers: [PolicyCiService, RepositoryRepairService],
})
export class PolicyCiModule {}
