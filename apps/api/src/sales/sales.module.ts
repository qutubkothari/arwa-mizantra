import { Module } from '@nestjs/common';
import { SalesService } from './services/sales.service';
import { SalesController } from './controllers/sales.controller';
import { EmailModule } from '../email/email.module';
import { UidModule } from '../uid/uid.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DocumentsModule } from '../documents/documents.module';
import { AccountingModule } from '../accounting/accounting.module';
import { TransportControlController } from './controllers/transport-control.controller';
import { TransportControlService } from './services/transport-control.service';

@Module({
  imports: [EmailModule, UidModule, InventoryModule, DocumentsModule, AccountingModule],
  providers: [SalesService, TransportControlService],
  controllers: [SalesController, TransportControlController],
  exports: [SalesService],
})
export class SalesModule {}
