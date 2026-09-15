import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FsmController } from "./fsm.controller";
import { FsmService } from "./fsm.service";

@Module({
  imports: [AuditModule],
  controllers: [FsmController],
  providers: [FsmService],
  exports: [FsmService],
})
export class FsmModule {}
