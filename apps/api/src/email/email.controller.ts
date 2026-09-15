import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
  Res,
  HttpException,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DatabaseService } from '../common/database.service';
import { EmailFetchService } from './email-fetch.service';
import { EmailParserService } from './email-parser.service';
import { EmailAttachmentService } from './email-attachment.service';
import { EmailSchedulerService } from './email-scheduler.service';
import { EmailConfigService } from './email-config.service';

import { ConfigService } from '@nestjs/config';
@Controller('emails')
@UseGuards(JwtAuthGuard)
export class EmailController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fetchService: EmailFetchService,
    private readonly parserService: EmailParserService,
    private readonly attachmentService: EmailAttachmentService,
    private readonly configService: ConfigService,
    private readonly schedulerService: EmailSchedulerService,
    private readonly emailConfigService: EmailConfigService,
  ) {}

  /**
   * Get inbox emails with pagination and filters
   */
  @Get('inbox')
  async getInbox(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('folder') folder?: string,
    @Query('is_read') isRead?: string,
    @Query('parsed_type') parsedType?: string,
    @Query('search') search?: string,
  ) {
    const offset = (page - 1) * limit;
    
    // Build query dynamically
    const whereConditions = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (folder) {
      whereConditions.push(`folder = $${paramIndex++}`);
      params.push(folder);
    }

    if (isRead !== undefined) {
      whereConditions.push(`is_read = $${paramIndex++}`);
      params.push(isRead === 'true');
    }

    if (parsedType) {
      whereConditions.push(`parsed_type = $${paramIndex++}`);
      params.push(parsedType);
    }

    if (search) {
      whereConditions.push(
        `(subject ILIKE $${paramIndex} OR body_text ILIKE $${paramIndex} OR from_address ILIKE $${paramIndex})`,
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    // Get total count
    const countResult = await this.databaseService.executeQuery(
      `SELECT COUNT(*) FROM email_inbox ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count);

    // Get emails
    params.push(limit, offset);
    const result = await this.databaseService.executeQuery(
      `SELECT id, message_id, from_address, from_name, subject, 
              body_text, received_date, is_read, is_starred, 
              has_attachments, attachment_count, parsed_type, 
              related_entity, related_entity_id, confidence_score,
              processing_status, created_at
       FROM email_inbox 
       ${whereClause}
       ORDER BY received_date DESC 
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params,
    );

    return {
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single email by ID
   */
  @Get(':id(\\d+)')
  async getEmail(@Param('id', ParseIntPipe) id: number) {
    const result = await this.databaseService.executeQuery(
      `SELECT * FROM email_inbox WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new HttpException('Email not found', HttpStatus.NOT_FOUND);
    }

    // Get attachments
    const attachments = await this.attachmentService.getEmailAttachments(id);

    return {
      ...result.rows[0],
      attachments,
    };
  }

  /**
   * Mark email as read/unread
   */
  @Post(':id/read')
  async markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @Body('is_read') isRead: boolean,
  ) {
    await this.databaseService.executeQuery(
      'UPDATE email_inbox SET is_read = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [isRead, id],
    );

    return { success: true };
  }

  /**
   * Star/unstar email
   */
  @Post(':id/star')
  async toggleStar(
    @Param('id', ParseIntPipe) id: number,
    @Body('is_starred') isStarred: boolean,
  ) {
    await this.databaseService.executeQuery(
      'UPDATE email_inbox SET is_starred = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [isStarred, id],
    );

    return { success: true };
  }

  /**
   * Manually trigger email fetch
   */
  @Post('fetch')
  async fetchEmails() {
    try {
      const result = await this.schedulerService.triggerManualFetch();
      return {
        success: true,
        message: `Fetched ${result.fetched} emails, parsed ${result.parsed}`,
        ...result,
      };
    } catch (error) {
      throw new HttpException(
        `Email fetch failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Re-parse email
   */
  @Post(':id/parse')
  async parseEmail(@Param('id', ParseIntPipe) id: number) {
    try {
      const parsed = await this.parserService.parseEmail(id);
      return {
        success: true,
        parsed,
      };
    } catch (error) {
      throw new HttpException(
        `Parse failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get email statistics
   */
  @Get('stats/dashboard')
  async getStats() {
    const [total, unread, pending, types] = await Promise.all([
      this.databaseService.executeQuery('SELECT COUNT(*) FROM email_inbox'),
      this.databaseService.executeQuery('SELECT COUNT(*) FROM email_inbox WHERE is_read = false'),
      this.databaseService.executeQuery(
        "SELECT COUNT(*) FROM email_inbox WHERE processing_status = 'pending'",
      ),
      this.databaseService.executeQuery(
        `SELECT parsed_type, COUNT(*) as count 
         FROM email_inbox 
         WHERE parsed_type IS NOT NULL 
         GROUP BY parsed_type 
         ORDER BY count DESC`,
      ),
    ]);

    return {
      total: parseInt(total.rows[0].count),
      unread: parseInt(unread.rows[0].count),
      pending_parse: parseInt(pending.rows[0].count),
      by_type: types.rows,
    };
  }

  /**
   * Get email attachments
   */
  @Get(':id(\\d+)/attachments')
  async getAttachments(@Param('id', ParseIntPipe) id: number) {
    const attachments = await this.attachmentService.getEmailAttachments(id);
    return { data: attachments };
  }

  /**
   * Download attachment
   */
  @Get('attachments/:attachmentId/download')
  async downloadAttachment(
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() res: Response,
  ) {
    try {
      const attachment = await this.attachmentService.getAttachment(attachmentId);
      
      if (!attachment) {
        throw new HttpException('Attachment not found', HttpStatus.NOT_FOUND);
      }

      const buffer = await this.attachmentService.downloadAttachment(attachmentId);

      res.setHeader('Content-Type', attachment.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
      res.send(buffer);
    } catch (error) {
      throw new HttpException(
        `Download failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Search attachments
   */
  @Get('attachments/search')
  async searchAttachments(@Query('q') searchTerm: string, @Query('limit') limit = 50) {
    if (!searchTerm) {
      throw new HttpException('Search term required', HttpStatus.BAD_REQUEST);
    }

    const results = await this.attachmentService.searchAttachments(searchTerm, limit);
    return { data: results };
  }

  /**
   * Test IMAP connection
   */
  @Get('test/connection')
  async testConnection() {
    const result = await this.fetchService.testConnection();
    return result;
  }

  /**
   * Get scheduler status
   */
  @Get('scheduler/status')
  async getSchedulerStatus() {
    return this.schedulerService.getStatus();
  }

  /**
   * Update email processing status
   */
  @Post(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
    @Body('notes') notes?: string,
  ) {
    await this.databaseService.executeQuery(
      `UPDATE email_inbox 
       SET processing_status = $1, 
           processing_notes = $2, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [status, notes, id],
    );

    return { success: true };
  }

  /**
   * Link email to entity (manual association)
   */
  @Post(':id/link')
  async linkToEntity(
    @Param('id', ParseIntPipe) id: number,
    @Body('entity_type') entityType: string,
    @Body('entity_id') entityId: number,
  ) {
    await this.databaseService.executeQuery(
      `UPDATE email_inbox 
       SET related_entity = $1, 
           related_entity_id = $2, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [entityType, entityId, id],
    );

    return { success: true };
  }

  /**
   * Get email configuration
   */
  @Get('config')
  async getEmailConfig() {
    return this.emailConfigService.getAllEmailConfigDetails();
  }

  @Get('status')
  async getStatus() {
    const smtpUser = (this.configService.get<string>('SMTP_USER') || '').trim();
    const smtpPass = (this.configService.get<string>('SMTP_PASS') || '').trim();
    const gmailUser = (this.configService.get<string>('GMAIL_USER') || '').trim();

    const smtpConfigured = Boolean(smtpUser && smtpPass);
    const gmailOAuthConfigured = Boolean(gmailUser);

    return {
      outboundEnabled: smtpConfigured || gmailOAuthConfigured,
      smtpConfigured,
      gmailOAuthConfigured,
      smtpUserSet: Boolean(smtpUser),
      smtpPassSet: Boolean(smtpPass),
      gmailUserSet: Boolean(gmailUser),
    };
  }

  /**
   * Update email configuration
   */
  @Put('config')
  async updateEmailConfig(
    @Body() configs: Array<{
      email_type: string;
      email_address: string;
      display_name?: string;
      description?: string;
      is_active?: boolean;
    }>,
    @Request() req: any,
  ) {
    const userId = req.user?.userId;

    try {
      await this.emailConfigService.bulkUpdateEmailConfig(configs, userId);
      return { 
        success: true, 
        message: 'Email configuration updated successfully' 
      };
    } catch (error) {
      throw new HttpException(
        'Failed to update email configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update single email configuration
   */
  @Put('config/:type')
  async updateSingleEmailConfig(
    @Param('type') emailType: string,
    @Body('email_address') emailAddress: string,
    @Body('display_name') displayName: string | undefined,
    @Body('description') description: string | undefined,
    @Body('is_active') isActive: boolean | undefined,
    @Request() req: any,
  ) {
    const userId = req.user?.userId;

    try {
      await this.emailConfigService.updateEmailConfig(emailType, emailAddress, userId, {
        display_name: displayName,
        description,
        is_active: isActive,
      });
      return { 
        success: true, 
        message: `${emailType} email updated successfully` 
      };
    } catch (error) {
      throw new HttpException(
        `Failed to update ${emailType} email`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
