import { Controller, Post, Body, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { GmailWebhookService } from './gmail-webhook.service';
import { Public } from '../auth/decorators/public.decorator';

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

@Controller('webhooks')
export class GmailWebhookController {
  private readonly logger = new Logger(GmailWebhookController.name);

  constructor(private readonly gmailWebhookService: GmailWebhookService) {}

  @Public()
  @Post('gmail')
  @HttpCode(HttpStatus.OK)
  async handleGmailWebhook(@Body() payload: PubSubMessage) {
    try {
      this.logger.log('Received Gmail webhook notification');

      // Acknowledge immediately (respond 200)
      // Do heavy processing in background
      setImmediate(async () => {
        try {
          await this.gmailWebhookService.processNotification(payload);
        } catch (error) {
          this.logger.error('Error processing Gmail notification:', error);
        }
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error handling Gmail webhook:', error);
      // Still return 200 to acknowledge receipt
      return { success: false, error: error.message };
    }
  }
}
