import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailFetchService } from './email-fetch.service';
import { EmailParserService } from './email-parser.service';
import { EmailAttachmentService } from './email-attachment.service';
import { FetchedEmail } from './email-fetch.service';

@Injectable()
export class EmailSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(EmailSchedulerService.name);
  private isEnabled = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly fetchService: EmailFetchService,
    private readonly parserService: EmailParserService,
    private readonly attachmentService: EmailAttachmentService,
  ) {}

  onModuleInit() {
    // Enable scheduler if configured
    this.isEnabled = this.configService.get<string>('EMAIL_FETCH_ENABLED', 'false') === 'true';
    
    if (this.isEnabled) {
      this.logger.log('Email scheduler enabled');
    } else {
      this.logger.log('Email scheduler disabled (set EMAIL_FETCH_ENABLED=true to enable)');
    }
  }

  /**
   * Fetch emails every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async fetchEmailsJob() {
    if (!this.isEnabled) {
      return;
    }

    this.logger.log('Starting scheduled email fetch...');

    try {
      // Fetch new emails
      const emails = await this.fetchService.fetchEmails({
        limit: 50,
        unseen: true, // Only fetch unread emails
      });

      this.logger.log(`Fetched ${emails.length} new emails`);

      // Process each email
      for (const email of emails) {
        await this.processEmail(email);
      }

      this.logger.log('Scheduled email fetch completed');
    } catch (error) {
      this.logger.error('Error in scheduled email fetch:', error);
    }
  }

  /**
   * Parse pending emails every 10 minutes
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async parseEmailsJob() {
    if (!this.isEnabled) {
      return;
    }

    this.logger.log('Starting scheduled email parsing...');

    try {
      const parsedCount = await this.parserService.batchParsePendingEmails(50);
      this.logger.log(`Parsed ${parsedCount} emails`);
    } catch (error) {
      this.logger.error('Error in scheduled email parsing:', error);
    }
  }

  /**
   * Process a single fetched email
   */
  private async processEmail(email: FetchedEmail): Promise<void> {
    try {
      // Save email to database
      const emailId = await this.fetchService.saveEmailToDatabase(email);

      // Save attachments if any
      if (email.attachments && email.attachments.length > 0) {
        this.logger.log(`Processing ${email.attachments.length} attachments for email ${emailId}`);

        for (const attachment of email.attachments) {
          try {
            await this.attachmentService.saveAttachment(
              emailId,
              attachment.filename,
              attachment.contentType,
              attachment.content,
            );
          } catch (error) {
            this.logger.error(
              `Failed to save attachment ${attachment.filename}:`,
              error,
            );
          }
        }
      }

      // Parse email (will be picked up by batch parser)
      // Or parse immediately if high priority
      if (this.isHighPriority(email)) {
        const parsed = await this.parserService.parseEmail(emailId);
        
        // Execute auto actions if confidence is high
        if (parsed.confidenceScore > 0.7) {
          await this.parserService.executeAutoActions(emailId, parsed.suggestedActions);
        }
      }
    } catch (error) {
      this.logger.error(`Error processing email ${email.messageId}:`, error);
    }
  }

  /**
   * Check if email is high priority (requires immediate parsing)
   */
  private isHighPriority(email: FetchedEmail): boolean {
    const subject = email.subject.toLowerCase();
    const highPriorityKeywords = ['urgent', 'asap', 'immediate', 'critical', 'po', 'order'];

    return highPriorityKeywords.some((keyword) => subject.includes(keyword));
  }

  /**
   * Manual trigger for email fetch (for testing/admin use)
   */
  async triggerManualFetch(): Promise<{ fetched: number; parsed: number }> {
    this.logger.log('Manual email fetch triggered');

    try {
      const count = await this.fetchService.fetchAndSaveEmails({
        limit: 100,
      });

      const parsedCount = await this.parserService.batchParsePendingEmails(100);

      return { fetched: count, parsed: parsedCount };
    } catch (error) {
      this.logger.error('Error in manual fetch:', error);
      throw error;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { enabled: boolean; lastRun?: Date } {
    return {
      enabled: this.isEnabled,
      // TODO: Track last run time
    };
  }
}
