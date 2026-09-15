import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as nodemailer from 'nodemailer';

@Injectable()
export class GmailOAuth2Service {
  private readonly logger = new Logger(GmailOAuth2Service.name);
  private oauth2Client: any;
  private gmail: any;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    this.initializeOAuth2();
  }

  private isSmtpAuthError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      message.includes('535') ||
      message.includes('invalid login') ||
      message.includes('badcredentials') ||
      message.includes('username and password not accepted')
    );
  }

  private async sendViaGmailApi(mailOptions: nodemailer.SendMailOptions) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    const streamTransport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    });

    const compiled = await streamTransport.sendMail(mailOptions);
    const messageBuffer = compiled.message as Buffer;
    const raw = messageBuffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return {
      messageId: response.data.id,
      threadId: response.data.threadId,
      provider: 'gmail-api',
    };
  }

  private initializeOAuth2() {
    const clientId = this.configService.get('GMAIL_CLIENT_ID');
    const clientSecret = this.configService.get('GMAIL_CLIENT_SECRET');
    const refreshToken = this.configService.get('GMAIL_REFRESH_TOKEN');

    if (!clientId || !clientSecret) {
      this.logger.warn('Gmail OAuth2 not configured - missing client credentials');
      return;
    }

    try {
      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        this.configService.get('GMAIL_REDIRECT_URI', 'http://localhost:4000/api/v1/auth/google/callback')
      );

      if (refreshToken) {
        this.oauth2Client.setCredentials({
          refresh_token: refreshToken,
        });

        // Initialize Gmail API
        this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

        // Initialize Nodemailer with OAuth2
        this.initializeTransporter();
        
        this.logger.log('Gmail OAuth2 initialized successfully');
      } else {
        this.logger.warn('Gmail OAuth2 configured but missing refresh token');
      }
    } catch (error) {
      this.logger.error('Failed to initialize Gmail OAuth2:', error);
    }
  }

  private async initializeTransporter() {
    try {
      const accessToken = await this.oauth2Client.getAccessToken();
      
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: this.configService.get('GMAIL_USER', 'erpsak53@gmail.com'),
          clientId: this.configService.get('GMAIL_CLIENT_ID'),
          clientSecret: this.configService.get('GMAIL_CLIENT_SECRET'),
          refreshToken: this.configService.get('GMAIL_REFRESH_TOKEN'),
          accessToken: accessToken.token,
        },
      });

      this.logger.log('Gmail OAuth2 transporter initialized');
    } catch (error) {
      this.logger.error('Failed to initialize Gmail transporter:', error);
    }
  }

  /**
   * Check if OAuth2 is properly configured and working
   */
  isConfigured(): boolean {
    return !!this.oauth2Client && !!this.configService.get('GMAIL_REFRESH_TOKEN');
  }

  /**
   * Expose non-sensitive configuration status for diagnostics
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      hasClientId: !!this.configService.get('GMAIL_CLIENT_ID'),
      hasClientSecret: !!this.configService.get('GMAIL_CLIENT_SECRET'),
      hasRefreshToken: !!this.configService.get('GMAIL_REFRESH_TOKEN'),
      hasUser: !!this.configService.get('GMAIL_USER'),
      redirectUri: this.configService.get(
        'GMAIL_REDIRECT_URI',
        'http://localhost:4000/api/v1/auth/google/callback',
      ),
    };
  }

  /**
   * Get OAuth2 authorization URL for initial setup
   */
  getAuthUrl(): string {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
      ],
      prompt: 'consent', // Force to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string) {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // Ensure Gmail API is available immediately after auth.
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    
    // Initialize transporter with new tokens
    await this.initializeTransporter();

    return tokens;
  }

  /**
   * List messages (used for fallback sync)
   */
  async listMessages(maxResults = 10, labelIds: string[] = ['INBOX']) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults,
      labelIds,
    });

    return response.data;
  }

  /**
   * Send email using OAuth2
   */
  async sendEmail(mailOptions: nodemailer.SendMailOptions) {
    if (!this.transporter && !this.gmail) {
      throw new Error('Gmail OAuth2 not initialized');
    }

    try {
      // Refresh transporter if needed (access token might have expired)
      await this.initializeTransporter();

      if (this.transporter) {
        try {
          const info = await this.transporter.sendMail(mailOptions);
          this.logger.log(`Email sent (SMTP OAuth2): ${info.messageId}`);
          return info;
        } catch (smtpError) {
          if (!this.isSmtpAuthError(smtpError)) {
            throw smtpError;
          }

          this.logger.warn(
            'SMTP OAuth2 send failed with auth error, falling back to Gmail API send',
          );
          const apiResult = await this.sendViaGmailApi(mailOptions);
          this.logger.log(`Email sent (Gmail API fallback): ${apiResult.messageId}`);
          return apiResult;
        }
      }

      const apiResult = await this.sendViaGmailApi(mailOptions);
      this.logger.log(`Email sent (Gmail API): ${apiResult.messageId}`);
      return apiResult;
    } catch (error) {
      this.logger.error('Failed to send email:', error);
      throw error;
    }
  }

  /**
   * Start watching Gmail inbox for new messages
   */
  async startWatch(labelIds: string[] = ['INBOX']) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      const topicName = this.configService.get('GMAIL_PUBSUB_TOPIC');
      if (!topicName) {
        throw new Error('GMAIL_PUBSUB_TOPIC not configured');
      }

      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds,
          topicName,
        },
      });

      this.logger.log('Gmail watch started:', response.data);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to start Gmail watch:', error);
      throw error;
    }
  }

  /**
   * Stop watching Gmail inbox
   */
  async stopWatch() {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      await this.gmail.users.stop({
        userId: 'me',
      });
      this.logger.log('Gmail watch stopped');
    } catch (error) {
      this.logger.error('Failed to stop Gmail watch:', error);
      throw error;
    }
  }

  /**
   * Get email history since a specific history ID
   */
  async getHistory(startHistoryId: string) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      const response = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get Gmail history:', error);
      throw error;
    }
  }

  /**
   * Get full message by ID
   */
  async getMessage(messageId: string) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });

      this.logger.log(`Message ${messageId} marked as read`);
    } catch (error) {
      this.logger.error(`Failed to mark message ${messageId} as read:`, error);
      throw error;
    }
  }

  /**
   * Send reply to a message
   */
  async sendReply(messageId: string, replyText: string, originalMessage: any) {
    if (!this.gmail) {
      throw new Error('Gmail API not initialized');
    }

    try {
      // Extract headers from original message
      const headers = originalMessage.payload.headers;
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
      const from = headers.find((h: any) => h.name === 'From')?.value || '';
      const messageIdHeader = headers.find((h: any) => h.name === 'Message-ID')?.value || '';
      const references = headers.find((h: any) => h.name === 'References')?.value || '';

      // Build reply
      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
      const replyHeaders = [
        `To: ${from}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messageIdHeader}`,
        `References: ${references} ${messageIdHeader}`.trim(),
      ];

      const rawMessage = [
        ...replyHeaders,
        '',
        replyText,
      ].join('\r\n');

      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId: originalMessage.threadId,
        },
      });

      this.logger.log(`Reply sent to message ${messageId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send reply to message ${messageId}:`, error);
      throw error;
    }
  }
}
