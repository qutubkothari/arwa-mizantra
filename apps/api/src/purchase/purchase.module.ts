import { Module } from '@nestjs/common';
import { PurchaseRequisitionsController } from './controllers/purchase-requisitions.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { VendorsController } from './controllers/vendors.controller';
import { GrnController } from './controllers/grn.controller';
import { DebitNoteController } from './controllers/debit-note.controller';
import { AccountsCompatController } from './controllers/accounts-compat.controller';
import { SyncController } from './controllers/sync-controller';
import { ServiceEntrySheetsController } from './controllers/service-entry-sheets.controller';
import { ImportFilesController } from './controllers/import-files.controller';
import { SpendIntelligenceController } from './controllers/spend-intelligence.controller';
import { StrategicSourcingController } from './controllers/strategic-sourcing.controller';
import { ContractControlController } from './controllers/contract-control.controller';
import { PurchaseRequisitionsService } from './services/purchase-requisitions.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { VendorsService } from './services/vendors.service';
import { GrnService } from './services/grn.service';
import { DebitNoteService } from './services/debit-note.service';
import { RfqExcelService } from './services/rfq-excel.service';
import { WorldClassPoPdfService } from './services/world-class-po-pdf.service';
import { ServiceEntrySheetsService } from './services/service-entry-sheets.service';
import { ImportFilesService } from './services/import-files.service';
import { SpendIntelligenceService } from './services/spend-intelligence.service';
import { StrategicSourcingService } from './services/strategic-sourcing.service';
import { ContractControlService } from './services/contract-control.service';
import { UidModule } from '../uid/uid.module';
import { EmailModule } from '../email/email.module';
import { PoTrackingReminderJob } from './jobs/po-tracking-reminder.job';
import { ProjectsModule } from '../projects/projects.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [UidModule, EmailModule, ProjectsModule, AccountingModule],
  controllers: [
    PurchaseRequisitionsController,
    PurchaseOrdersController,
    VendorsController,
    GrnController,
    DebitNoteController,
    AccountsCompatController,
    SyncController,
    ServiceEntrySheetsController,
    ImportFilesController,
    SpendIntelligenceController,
    StrategicSourcingController,
    ContractControlController,
  ],
  providers: [
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    VendorsService,
    GrnService,
    DebitNoteService,
    RfqExcelService,
    WorldClassPoPdfService,
    ServiceEntrySheetsService,
    ImportFilesService,
    SpendIntelligenceService,
    StrategicSourcingService,
    ContractControlService,
    PoTrackingReminderJob,
  ],
  exports: [
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    VendorsService,
    GrnService,
    DebitNoteService,
    RfqExcelService,
    WorldClassPoPdfService,
    ServiceEntrySheetsService,
    ImportFilesService,
  ],
})
export class PurchaseModule {}
