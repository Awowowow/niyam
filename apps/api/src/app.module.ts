import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DemoModule } from "./demo/demo.module";
import { PoliciesController } from "./policies/policies.controller";
import { PolicyCiModule } from "./policy-ci/policy-ci.module";
import { RepairsController } from "./repairs/repairs.controller";

@Module({
  imports: [DemoModule, PolicyCiModule],
  controllers: [AppController, PoliciesController, RepairsController],
})
export class AppModule {}
