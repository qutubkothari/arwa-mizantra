import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SubcontractingController } from './subcontracting.controller';
import { SubcontractingService } from './subcontracting.service';

@Module({
  imports: [InventoryModule, AccountingModule],
  controllers: [SubcontractingController],
  providers: [SubcontractingService],
  exports: [SubcontractingService],
})
export class SubcontractingModule {}
