import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GmailOAuth2Service } from './gmail-oauth2.service';
import { DatabaseService } from '../common/database.service';

@Injectable()
export class GmailWebhookService {
  private readonly logger = new Logger(GmailWebhookService.name);
  private lastHistoryId: string | null = null;
  private readonly enabled: boolean;

  // Spam/newsletter patterns to block
  private readonly SPAM_PATTERNS = [
    /beehiiv/i,
    /mailchimp/i,
    /sendgrid/i,
    /unsubscribe/i,
    /newsletter/i,
    /noreply@/i,
    /no-reply@/i,
    /donotreply@/i,
    /marketing@/i,
    /promo@/i,
    /notification@/i,
  ];

  constructor(
    private readonly gmailOAuth2Service: GmailOAuth2Service,
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get('EMAIL_FETCH_ENABLED', 'false') === 'true';
    if (!this.enabled) {
      this.logger.log('Gmail webhook disabled (set EMAIL_FETCH_ENABLED=true to enable)');
      return;
    }

    this.loadLastHistoryId();
  }

  private decodeBase64Url(data: string): string {
    if (!data) return '';
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').toString('utf-8');
  }

  private async loadLastHistoryId() {
    try {
      const result = await this.databaseService.executeQuery(
        'SELECT last_message_id FROM email_sync_status WHERE email_account = $1',
        [this.configService.get('GMAIL_USER', 'erpsak53@gmail.com')]
      );

      if (result.rows.length > 0) {
        this.lastHistoryId = result.rows[0].last_message_id || null;
        this.logger.log(`Loaded last history ID: ${this.lastHistoryId}`);
      }
    } catch (error) {
      this.logger.error('Failed to load last history ID:', error);
    }
  }

  private async saveHistoryId(historyId: string) {
    try {
      await this.databaseService.executeQuery(
        `INSERT INTO email_sync_status (email_account, last_message_id, last_sync_date, sync_status)
         VALUES ($1, $2, NOW(), 'idle')
         ON CONFLICT (email_account)
         DO UPDATE SET last_message_id = $2, last_sync_date = NOW(), sync_status = 'idle'`,
        [this.configService.get('GMAIL_USER', 'erpsak53@gmail.com'), historyId]
      );

      this.lastHistoryId = historyId;
    } catch (error) {
      this.logger.error('Failed to save history ID:', error);
    }
  }

  async processNotification(payload: any) {
    if (!this.enabled) return;
    try {
      // Decode Pub/Sub message
      const messageData = JSON.parse(
        Buffer.from(payload.message.data, 'base64').toString('utf-8')
      );

      this.logger.log('Gmail notification:', messageData);

      const { historyId, emailAddress } = messageData;
      const configuredUser = this.configService.get('GMAIL_USER', 'erpsak53@gmail.com');

      if (emailAddress && configuredUser && emailAddress.toLowerCase() !== configuredUser.toLowerCase()) {
        this.logger.warn(`Ignoring notification for different account: ${emailAddress}`);
        return;
      }

      if (!this.lastHistoryId) {
        this.logger.warn('No last history ID, fetching recent messages');
        await this.fetchRecentMessages();
        await this.saveHistoryId(historyId);
        return;
      }

      // Get history since last known history ID
      let history: any;
      try {
        history = await this.gmailOAuth2Service.getHistory(this.lastHistoryId);
      } catch (err: any) {
        const status = err?.code || err?.response?.status;
        const message = String(err?.message || '');
        const historyTooOld = status === 404 || /historyid/i.test(message);
        if (historyTooOld) {
          this.logger.warn('Gmail historyId is too old/invalid; refetching recent messages');
          await this.fetchRecentMessages();
          await this.saveHistoryId(historyId);
          return;
        }
        throw err;
      }

      if (!history.history || history.history.length === 0) {
        this.logger.log('No new messages in history');
        await this.saveHistoryId(historyId);
        return;
      }

      // Process new messages
      for (const historyRecord of history.history) {
        if (historyRecord.messagesAdded) {
          for (const messageAdded of historyRecord.messagesAdded) {
            await this.processNewMessage(messageAdded.message.id);
          }
        }
      }

      // Update history ID
      await this.saveHistoryId(historyId);
    } catch (error) {
      this.logger.error('Error processing notification:', error);
      throw error;
    }
  }

  private async processNewMessage(messageId: string) {
    try {
      this.logger.log(`Processing message: ${messageId}`);

      // Get full message
      const message = await this.gmailOAuth2Service.getMessage(messageId);

      // Extract headers
      const headers = message.payload?.headers || [];
      const fromHeader = this.getHeader(headers, 'From');
      const subject = this.getHeader(headers, 'Subject');
      const messageIdHeader = this.getHeader(headers, 'Message-ID');
      const listUnsubscribe = this.getHeader(headers, 'List-Unsubscribe');
      const toHeader = this.getHeader(headers, 'To');
      const ccHeader = this.getHeader(headers, 'Cc');
      const bccHeader = this.getHeader(headers, 'Bcc');
      const replyToHeader = this.getHeader(headers, 'Reply-To');

      // Check if it's spam/newsletter
      if (this.isSpam(fromHeader, subject, listUnsubscribe)) {
        this.logger.log(`Skipping spam/newsletter: ${fromHeader} - ${subject}`);
        await this.gmailOAuth2Service.markAsRead(messageId);
        return;
      }

      const { name: fromName, email: fromAddress } = this.parseAddress(fromHeader);
      const toAddresses = this.parseAddressList(toHeader);
      const ccAddresses = this.parseAddressList(ccHeader);
      const bccAddresses = this.parseAddressList(bccHeader);
      const replyTo = this.parseAddress(replyToHeader).email;

      const stableMessageId = (messageIdHeader && messageIdHeader.trim()) || message.id;

      // Check if already processed (using Message-ID as external ID)
      const existing = await this.databaseService.executeQuery(
        'SELECT id FROM email_inbox WHERE message_id = $1',
        [stableMessageId]
      );

      if (existing.rows.length > 0) {
        this.logger.log(`Message already processed: ${messageIdHeader}`);
        return;
      }

      // Extract body
      const { text: bodyText, html: bodyHtml } = this.extractBodies(message.payload);

      const attachmentCount = this.countAttachments(message.payload);
      const hasAttachments = attachmentCount > 0;

      // Store in database
      await this.storeEmail({
        messageId: stableMessageId,
        threadId: message.threadId || null,
        fromAddress: fromAddress || fromHeader || 'unknown',
        fromName: fromName || null,
        toAddresses: toAddresses.length ? toAddresses : [this.configService.get('GMAIL_USER', 'erpsak53@gmail.com')],
        ccAddresses,
        bccAddresses,
        replyTo: replyTo || null,
        subject: subject || null,
        bodyText,
        bodyHtml,
        receivedDate: new Date(parseInt(message.internalDate, 10)),
        folder: 'INBOX',
        labels: message.labelIds || [],
        hasAttachments,
        attachmentCount,
        rawHeaders: JSON.stringify(headers),
        sizeBytes: typeof message.sizeEstimate === 'number' ? message.sizeEstimate : null,
      });

      // Leave as unread in Gmail; the app controls read state.
      this.logger.log(`Successfully stored message: ${messageId}`);
    } catch (error) {
      this.logger.error(`Error processing message ${messageId}:`, error);
      throw error;
    }
  }

  private async fetchRecentMessages() {
    this.logger.log('Fetching recent messages (fallback)');
    try {
      const list = await this.gmailOAuth2Service.listMessages(10, ['INBOX']);
      const messages = list?.messages || [];
      for (const msg of messages) {
        if (msg?.id) {
          await this.processNewMessage(msg.id);
        }
      }
    } catch (error) {
      this.logger.error('Failed to fetch recent messages:', error);
    }
  }

  private getHeader(headers: any[], name: string): string {
    const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return header?.value || '';
  }

  private isSpam(from: string, subject: string, listUnsubscribe: string): boolean {
    // Check if it matches spam patterns
    const combined = `${from} ${subject} ${listUnsubscribe}`.toLowerCase();

    return this.SPAM_PATTERNS.some((pattern) => pattern.test(combined));
  }

  private extractBodies(payload: any): { text: string; html: string } {
    let text = '';
    let html = '';

    const walk = (part: any) => {
      if (!part) return;

      if (part.mimeType === 'text/plain' && part.body?.data && !text) {
        text = this.decodeBase64Url(part.body.data);
      }

      if (part.mimeType === 'text/html' && part.body?.data && !html) {
        html = this.decodeBase64Url(part.body.data);
      }

      if (part.body?.data && !part.parts && !text && part.mimeType === 'text/plain') {
        text = this.decodeBase64Url(part.body.data);
      }

      if (Array.isArray(part.parts)) {
        for (const child of part.parts) walk(child);
      }
    };

    walk(payload);
    return { text, html };
  }

  private countAttachments(payload: any): number {
    let count = 0;
    const walk = (part: any) => {
      if (!part) return;
      if (part.filename && String(part.filename).trim().length > 0) count += 1;
      if (Array.isArray(part.parts)) {
        for (const child of part.parts) walk(child);
      }
    };
    walk(payload);
    return count;
  }

  private async storeEmail(emailData: any) {
    try {
      await this.databaseService.executeQuery(
        `INSERT INTO email_inbox (
          message_id,
          thread_id,
          from_address,
          from_name,
          to_addresses,
          cc_addresses,
          bcc_addresses,
          reply_to,
          subject,
          body_text,
          body_html,
          received_date,
          folder,
          labels,
          has_attachments,
          attachment_count,
          raw_headers,
          size_bytes,
          processing_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending'
        )`,
        [
          emailData.messageId,
          emailData.threadId,
          emailData.fromAddress,
          emailData.fromName,
          JSON.stringify(emailData.toAddresses || []),
          emailData.ccAddresses && emailData.ccAddresses.length ? JSON.stringify(emailData.ccAddresses) : null,
          emailData.bccAddresses && emailData.bccAddresses.length ? JSON.stringify(emailData.bccAddresses) : null,
          emailData.replyTo,
          emailData.subject,
          emailData.bodyText || null,
          emailData.bodyHtml || null,
          emailData.receivedDate,
          emailData.folder || 'INBOX',
          JSON.stringify(emailData.labels || []),
          !!emailData.hasAttachments,
          Number.isFinite(emailData.attachmentCount) ? emailData.attachmentCount : 0,
          emailData.rawHeaders || null,
          Number.isFinite(emailData.sizeBytes) ? emailData.sizeBytes : null,
        ]
      );

      this.logger.log(`Email stored: ${emailData.messageId}`);
    } catch (error) {
      this.logger.error('Failed to store email:', error);
      throw error;
    }
  }

  private parseAddress(value: string): { name: string; email: string } {
    const v = (value || '').trim();
    if (!v) return { name: '', email: '' };

    const match = v.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (match) {
      return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim() };
    }

    // If it's just an email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { name: '', email: v };

    return { name: v, email: '' };
  }

  private parseAddressList(value: string): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((part) => this.parseAddress(part).email)
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
  }
}
