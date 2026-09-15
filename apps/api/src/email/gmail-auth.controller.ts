import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { GmailOAuth2Service } from './gmail-oauth2.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('auth')
export class GmailAuthController {
  private readonly logger = new Logger(GmailAuthController.name);

  constructor(private readonly gmailOAuth2Service: GmailOAuth2Service) {}

  @Public()
  @Get('google')
  async googleAuth(@Res() res: Response) {
    try {
      const authUrl = this.gmailOAuth2Service.getAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      this.logger.error('Error generating auth URL:', error);
      res.status(500).json({ error: 'Failed to generate authorization URL' });
    }
  }

  @Public()
  @Get('google/callback')
  async googleAuthCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.error('OAuth error:', error);
      return res.status(400).json({ error });
    }

    if (!code) {
      return res.status(400).json({ error: 'No authorization code provided' });
    }

    try {
      const tokens = await this.gmailOAuth2Service.getTokensFromCode(code);
      
      this.logger.log('OAuth tokens obtained successfully');

      // Return tokens to be saved in .env
      res.json({
        success: true,
        message: 'Authorization successful! Add these to your .env file:',
        tokens: {
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          expiry_date: tokens.expiry_date,
        },
        envVars: {
          GMAIL_REFRESH_TOKEN: tokens.refresh_token,
        },
      });
    } catch (error) {
      this.logger.error('Error exchanging code for tokens:', error);
      res.status(500).json({ error: 'Failed to exchange authorization code' });
    }
  }
}
