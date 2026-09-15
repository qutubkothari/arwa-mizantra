import { Module } from '@nestjs/common';
import { ServiceService } from './services/service.service';
import { ServiceController } from './controllers/service.controller';
import { ServicePortalController } from './controllers/service-portal.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { EmailModule } from '../email/email.module';
import { DocumentsModule } from '../documents/documents.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [InventoryModule, EmailModule, DocumentsModule, AccountingModule],
  controllers: [ServiceController, ServicePortalController],
  providers: [ServiceService],
  exports: [ServiceService],
})
export class ServiceModule {}
