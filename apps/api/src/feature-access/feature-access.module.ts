import { Module } from '@nestjs/common';
import { FeatureAccessController } from './feature-access.controller';
import { FeatureAccessService } from './feature-access.service';
import { FeatureEntitlementGuard } from './feature-entitlement.guard';

@Module({
  controllers: [FeatureAccessController],
  providers: [FeatureAccessService, FeatureEntitlementGuard],
  exports: [FeatureAccessService, FeatureEntitlementGuard],
})
export class FeatureAccessModule {}
