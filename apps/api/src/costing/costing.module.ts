import { Module } from '@nestjs/common';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({ imports: [AccountingModule], controllers: [CostingController], providers: [CostingService], exports: [CostingService] })
export class CostingModule {}
