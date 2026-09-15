import { Module } from '@nestjs/common';
import { InventoryService } from './services/inventory.service';
import { InventoryController } from './controllers/inventory.controller';
import { ItemsModule } from '../items/items.module';
import { EmailModule } from '../email/email.module';
import { UidModule } from '../uid/uid.module';
import { PurchaseModule } from '../purchase/purchase.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [ItemsModule, EmailModule, UidModule, PurchaseModule, AccountingModule],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
