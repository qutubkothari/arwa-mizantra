import { Module } from '@nestjs/common';
import { MasterDataGovernanceController } from './master-data-governance.controller';
import { MasterDataGovernanceService } from './master-data-governance.service';
import { MasterDataGovernanceSlaScheduler } from './master-data-governance-sla.scheduler';

@Module({
  controllers: [MasterDataGovernanceController],
  providers: [MasterDataGovernanceService, MasterDataGovernanceSlaScheduler],
})
export class MasterDataGovernanceModule {}
