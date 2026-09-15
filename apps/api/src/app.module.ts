import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';

// Core Modules
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { TenantModule } from './tenant/tenant.module';
import { UserModule } from './user/user.module';

// Business Modules
import { PurchaseModule } from './purchase/purchase.module';
import { InventoryModule } from './inventory/inventory.module';
import { ItemsModule } from './items/items.module';
import { CategoriesModule } from './categories/categories.module';
import { NomenclatureModule } from './nomenclature/nomenclature.module';
import { ProductionModule } from './production/production.module';
import { QualityModule } from './quality/quality.module';
import { SalesModule } from './sales/sales.module';
import { ServiceModule } from './service/service.module';
import { BomModule } from './bom/bom.module';
import { DocumentsModule } from './documents/documents.module';
import { HrModule } from './hr/hr.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SubcontractingModule } from './subcontracting/subcontracting.module';
import { ProjectsModule } from './projects/projects.module';

// Support Modules
import { WorkflowModule } from './workflow/workflow.module';
import { UidModule } from './uid/uid.module';
import { NotificationModule } from './notification/notification.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';
import { UploadModule } from './upload/upload.module';
import { ManagerModule } from './manager/manager.module';
import { AutomationModule } from './automation/automation.module';
import { AccountingModule } from './accounting/accounting.module';
import { MarginControlModule } from './margin-control/margin-control.module';
import { MrpModule } from './mrp/mrp.module';
import { CostingModule } from './costing/costing.module';
import { CollectionsModule } from './collections/collections.module';
import { PlantMaintenanceModule } from './plant-maintenance/plant-maintenance.module';
import { UaeComplianceModule } from './uae-compliance/uae-compliance.module';
import { EnterpriseEdgeModule } from './enterprise-edge/enterprise-edge.module';
import { ExpenseControlModule } from './expense-control/expense-control.module';
import { MasterDataGovernanceModule } from './master-data-governance/master-data-governance.module';
import { MasterDataGovernanceEnforcementGuard } from './master-data-governance/master-data-governance-enforcement.guard';
import { IntegrationHubModule } from './integration-hub/integration-hub.module';
import { IntelligenceModule } from './intelligence/intelligence.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { FeatureAccessModule } from './feature-access/feature-access.module';
import { FeatureEntitlementGuard } from './feature-access/feature-entitlement.guard';
import { CrmModule } from './crm/crm.module';
import { FsmModule } from './fsm/fsm.module';

const runtimeEnv = process.env.APP_ENV || process.env.NODE_ENV;
const apiEnvFiles = runtimeEnv === 'test'
  ? ['.env.test.local', '.env.test', '.env.local', '.env']
  : ['.env.local', '.env'];

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: apiEnvFiles,
    }),

    // GraphQL - Disabled for now (using REST API)
    // GraphQLModule.forRoot<ApolloDriverConfig>({
    //   driver: ApolloDriver,
    //   autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
    //   sortSchema: true,
    //   playground: true,
    //   context: ({ req, res }: { req: any; res: any }) => ({ req, res }),
    // }),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Job Queue
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),

    // Scheduled Jobs
    ScheduleModule.forRoot(),

    // Core
    CommonModule,
    PrismaModule,
    AuthModule,
    TenantModule,
    UserModule,

    // Business
    PurchaseModule,
    InventoryModule,
    ItemsModule,
    CategoriesModule,
    NomenclatureModule,
    ProductionModule,
    QualityModule,
    SalesModule,
    ServiceModule,
    BomModule,
    HrModule,
    DocumentsModule,
    DashboardModule,
    SubcontractingModule,
    ProjectsModule,

    // Support
    WorkflowModule,
    UidModule,
    NotificationModule,
    AuditModule,
    EmailModule,
    UploadModule,
    ManagerModule,
    AutomationModule,
    AccountingModule,
    MarginControlModule,
    MrpModule,
    CostingModule,
    CollectionsModule,
    PlantMaintenanceModule,
    UaeComplianceModule,
    EnterpriseEdgeModule,
    ExpenseControlModule,
    MasterDataGovernanceModule,
    IntegrationHubModule,
    IntelligenceModule,
    WhatsAppModule,
    FeatureAccessModule,
    CrmModule,
    FsmModule,
  ],
  controllers: [MigrationController],
  providers: [
    MigrationService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: FeatureEntitlementGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MasterDataGovernanceEnforcementGuard,
    },
  ],
})
export class AppModule {}
