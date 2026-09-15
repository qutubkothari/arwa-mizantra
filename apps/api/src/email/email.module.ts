import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailService } from './email.service';
import { EmailConfigService } from './email-config.service';
import { EmailFetchService } from './email-fetch.service';
import { EmailParserService } from './email-parser.service';
import { EmailAttachmentService } from './email-attachment.service';
import { EmailSchedulerService } from './email-scheduler.service';
import { EmailController } from './email.controller';
import { GmailOAuth2Service } from './gmail-oauth2.service';
import { GmailAuthController } from './gmail-auth.controller';
import { GmailWebhookController } from './gmail-webhook.controller';
import { GmailAdminController } from './gmail-admin.controller';
import { GmailWebhookService } from './gmail-webhook.service';
import { DatabaseModule } from '../common/database.module';
import { StorageModule } from '../common/storage.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    DatabaseModule,
    StorageModule,
  ],
  controllers: [
    EmailController,
    GmailAuthController,
    GmailWebhookController,
    GmailAdminController,
  ],
  providers: [
    EmailService,
    EmailConfigService,
    EmailFetchService,
    EmailParserService,
    EmailAttachmentService,
    EmailSchedulerService,
    GmailOAuth2Service,
    GmailWebhookService,
  ],
  exports: [
    EmailService,
    EmailConfigService,
    EmailFetchService,
    EmailParserService,
    EmailAttachmentService,
    GmailOAuth2Service,
    GmailWebhookService,
  ],
})
export class EmailModule {}
