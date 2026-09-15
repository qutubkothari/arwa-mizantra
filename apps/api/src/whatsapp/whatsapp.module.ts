import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { CrmModule } from '../crm/crm.module';

@Module({ imports: [AuditModule, CrmModule], controllers: [WhatsAppController], providers: [WhatsAppService], exports: [WhatsAppService] })
export class WhatsAppModule {}
