import { Module } from '@nestjs/common';
import { ExpenseControlController } from './expense-control.controller';
import { ExpenseControlService } from './expense-control.service';

@Module({ controllers: [ExpenseControlController], providers: [ExpenseControlService] })
export class ExpenseControlModule {}

