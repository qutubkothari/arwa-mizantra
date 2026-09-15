import { Controller, Post, Get, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { GmailOAuth2Service } from './gmail-oauth2.service';

/**
 * Administrative endpoints for Gmail integration management
 * These are public for initial setup - should be secured in production
 */
@Controller('admin/gmail')
export class GmailAdminController {
  private readonly logger = new Logger(GmailAdminController.name);

  constructor(private readonly gmailOAuth2Service: GmailOAuth2Service) {}

  /**
   * Start Gmail push notifications watch
   * Call this once after OAuth setup to enable real-time email notifications
   */
  @Public()
  @Post('start-watch')
  async startWatch() {
    try {
      this.logger.log('Starting Gmail watch for push notifications');
      const result = await this.gmailOAuth2Service.startWatch();
      
      this.logger.log(`Gmail watch started successfully. History ID: ${result.historyId}`);
      
      return {
        success: true,
        message: 'Gmail push notifications enabled successfully',
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to start Gmail watch:', error);
      throw new HttpException(
        {
          success: false,
          message: 'Failed to start Gmail watch',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Stop Gmail push notifications watch
   */
  @Public()
  @Post('stop-watch')
  async stopWatch() {
    try {
      this.logger.log('Stopping Gmail watch');
      await this.gmailOAuth2Service.stopWatch();
      
      this.logger.log('Gmail watch stopped successfully');
      
      return {
        success: true,
        message: 'Gmail push notifications disabled',
      };
    } catch (error) {
      this.logger.error('Failed to stop Gmail watch:', error);
      throw new HttpException(
        {
          success: false,
          message: 'Failed to stop Gmail watch',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Test Gmail API connectivity
   */
  @Public()
  @Get('test-connection')
  async testConnection() {
    try {
      this.logger.log('Testing Gmail API connection');
      const messages = await this.gmailOAuth2Service.listMessages(1);
      
      return {
        success: true,
        message: 'Gmail API connection successful',
        data: {
          canAccessMailbox: true,
          messageCount: messages.length,
          sampleMessage: messages[0] || null,
        },
      };
    } catch (error) {
      this.logger.error('Gmail API connection test failed:', error);
      throw new HttpException(
        {
          success: false,
          message: 'Gmail API connection failed',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Check Gmail OAuth configuration status (non-sensitive)
   */
  @Public()
  @Get('status')
  getStatus() {
    return {
      success: true,
      data: this.gmailOAuth2Service.getStatus(),
    };
  }
}
