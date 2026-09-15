import { Module } from '@nestjs/common';
import { HrService } from './services/hr.service';
import { HrController } from './controllers/hr.controller';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [HrService],
  controllers: [HrController],
  exports: [HrService],
})
export class HrModule {}
