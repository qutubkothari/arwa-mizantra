import { Module } from '@nestjs/common';
import { UidService } from './uid.service';
import { UidSupabaseService } from './services/uid-supabase.service';
import { UidSupabaseController } from './controllers/uid-supabase.controller';
import { UidController } from './uid.controller';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';
import { PublicWarrantyController } from './public-warranty.controller';
import { TraceabilityService } from './traceability.service';
import { TraceabilityController } from './traceability.controller';

@Module({
  providers: [UidService, UidSupabaseService, DeploymentService, TraceabilityService],
  controllers: [
    UidSupabaseController,
    UidController,
    DeploymentController,
    PublicWarrantyController,
    TraceabilityController,
  ],
  exports: [UidService, UidSupabaseService, DeploymentService, TraceabilityService],
})
export class UidModule {}
