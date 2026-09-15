import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../common/database.service';

export interface EmailConfig {
  admin: string;
  sales: string;
  support: string;
  technical: string;
  purchase: string;
  production: string;
  accounts: string;
  reminders: string;
  quality: string;
  documents: string;
  hr: string;
  noreply: string;
}

export interface EmailConfigDetail {
  id?: number;
  email_type: string;
  email_address: string;
  display_name?: string;
  description?: string;
  is_active?: boolean;
}

const DEFAULT_EMAIL_CONFIGS: Array<{
  email_type: keyof EmailConfig;
  envVar: string;
  display_name: string;
  description: string;
}> = [
  {
    email_type: 'admin',
    envVar: 'EMAIL_ADMIN',
    display_name: 'System Administrator',
    description: 'System notifications, critical alerts, user access and administrative messages',
  },
  {
    email_type: 'sales',
    envVar: 'EMAIL_SALES',
    display_name: 'Sales',
    description: 'Quotations, sales orders, customer communication and commercial follow-up',
  },
  {
    email_type: 'purchase',
    envVar: 'EMAIL_PURCHASE',
    display_name: 'Purchase',
    description: 'RFQs, purchase orders, vendor communication and procurement follow-up',
  },
  {
    email_type: 'production',
    envVar: 'EMAIL_PRODUCTION',
    display_name: 'Production',
    description: 'Job orders, subcontracting, shop-floor coordination and production alerts',
  },
  {
    email_type: 'accounts',
    envVar: 'EMAIL_ACCOUNTS',
    display_name: 'Accounts',
    description: 'Supplier invoices, payment advice, advances, debit notes and account statements',
  },
  {
    email_type: 'reminders',
    envVar: 'EMAIL_REMINDERS',
    display_name: 'Reminders',
    description: 'Automated due-date reminders, pending approvals, overdue GRN/QC and escalations',
  },
  {
    email_type: 'quality',
    envVar: 'EMAIL_QUALITY',
    display_name: 'Quality',
    description: 'QC inspection, rejected material, deviation reports and quality communication',
  },
  {
    email_type: 'documents',
    envVar: 'EMAIL_DOCUMENTS',
    display_name: 'Documents',
    description: 'Document dispatch, PDFs, drawings, letterheads and controlled attachments',
  },
  {
    email_type: 'support',
    envVar: 'EMAIL_SUPPORT',
    display_name: 'Support',
    description: 'Customer support requests, service tickets and customer inquiries',
  },
  {
    email_type: 'technical',
    envVar: 'EMAIL_TECHNICAL',
    display_name: 'Technical',
    description: 'Engineering questions, product specifications and technical clarification',
  },
  {
    email_type: 'hr',
    envVar: 'EMAIL_HR',
    display_name: 'Human Resources',
    description: 'Employee notifications, payroll, attendance, leave and HR communication',
  },
  {
    email_type: 'noreply',
    envVar: 'EMAIL_NOREPLY',
    display_name: 'No Reply',
    description: 'Automated notifications where users should not reply',
  },
];

@Injectable()
export class EmailConfigService {
  private emailCache: Map<string, string> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private readonly emailTypeToEnvVar: Record<keyof EmailConfig, string> = {
    admin: 'EMAIL_ADMIN',
    sales: 'EMAIL_SALES',
    support: 'EMAIL_SUPPORT',
    technical: 'EMAIL_TECHNICAL',
    purchase: 'EMAIL_PURCHASE',
    production: 'EMAIL_PRODUCTION',
    accounts: 'EMAIL_ACCOUNTS',
    reminders: 'EMAIL_REMINDERS',
    quality: 'EMAIL_QUALITY',
    documents: 'EMAIL_DOCUMENTS',
    hr: 'EMAIL_HR',
    noreply: 'EMAIL_NOREPLY',
  };

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
  ) {}

  /**
   * Get email by type from database (with caching) or fall back to env vars
   */
  private async getEmailByType(type: string, envVar: string, defaultEmail: string): Promise<string> {
    // Check cache first
    const now = Date.now();
    if (this.emailCache.has(type) && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.emailCache.get(type)!;
    }

    const dbUrl = this.configService.get<string>('DATABASE_URL');
    if (!dbUrl || dbUrl.includes('dummy')) {
      // Skip DB lookup when prisma DB is not configured
      const email = this.configService.get<string>(envVar, defaultEmail);
      this.emailCache.set(type, email);
      this.cacheTimestamp = now;
      return email;
    }

    try {
      // Try to get from database
      const result = await this.databaseService.executeQuery(
        `SELECT email_address FROM email_config WHERE email_type = $1 AND is_active = true LIMIT 1`,
        [type]
      );

      if (result.rows.length > 0) {
        const email = result.rows[0].email_address;
        this.emailCache.set(type, email);
        this.cacheTimestamp = now;
        return email;
      }
    } catch (error) {
      // Database error, fall through to env vars
      console.warn(`Failed to fetch ${type} email from database, using env var:`, error);
    }

    // Fall back to environment variable
    const email = this.configService.get<string>(envVar, defaultEmail);
    this.emailCache.set(type, email);
    this.cacheTimestamp = now;
    return email;
  }

  /**
   * Clear the email cache (call after updating email config)
   */
  clearCache(): void {
    this.emailCache.clear();
    this.cacheTimestamp = 0;
  }

  /**
   * Get all configured email addresses (async version for database)
   */
  async getEmailConfigAsync(): Promise<EmailConfig> {
    const defaultEmail = this.configService.get<string>('DEFAULT_EMAIL', 'erpsak53@gmail.com');
    
    return {
      admin: await this.getEmailByType('admin', 'EMAIL_ADMIN', defaultEmail),
      sales: await this.getEmailByType('sales', 'EMAIL_SALES', defaultEmail),
      support: await this.getEmailByType('support', 'EMAIL_SUPPORT', defaultEmail),
      technical: await this.getEmailByType('technical', 'EMAIL_TECHNICAL', defaultEmail),
      purchase: await this.getEmailByType('purchase', 'EMAIL_PURCHASE', defaultEmail),
      production: await this.getEmailByType('production', 'EMAIL_PRODUCTION', defaultEmail),
      accounts: await this.getEmailByType('accounts', 'EMAIL_ACCOUNTS', defaultEmail),
      reminders: await this.getEmailByType('reminders', 'EMAIL_REMINDERS', defaultEmail),
      quality: await this.getEmailByType('quality', 'EMAIL_QUALITY', defaultEmail),
      documents: await this.getEmailByType('documents', 'EMAIL_DOCUMENTS', defaultEmail),
      hr: await this.getEmailByType('hr', 'EMAIL_HR', defaultEmail),
      noreply: await this.getEmailByType('noreply', 'EMAIL_NOREPLY', defaultEmail),
    };
  }

  /**
   * Get all configured email addresses (sync version for backward compatibility)
   */
  getEmailConfig(): EmailConfig {
    const defaultEmail = this.configService.get<string>('DEFAULT_EMAIL', 'erpsak53@gmail.com');
    
    return {
      admin: this.configService.get<string>('EMAIL_ADMIN', defaultEmail),
      sales: this.configService.get<string>('EMAIL_SALES', defaultEmail),
      support: this.configService.get<string>('EMAIL_SUPPORT', defaultEmail),
      technical: this.configService.get<string>('EMAIL_TECHNICAL', defaultEmail),
      purchase: this.configService.get<string>('EMAIL_PURCHASE', defaultEmail),
      production: this.configService.get<string>('EMAIL_PRODUCTION', defaultEmail),
      accounts: this.configService.get<string>('EMAIL_ACCOUNTS', defaultEmail),
      reminders: this.configService.get<string>('EMAIL_REMINDERS', defaultEmail),
      quality: this.configService.get<string>('EMAIL_QUALITY', defaultEmail),
      documents: this.configService.get<string>('EMAIL_DOCUMENTS', defaultEmail),
      hr: this.configService.get<string>('EMAIL_HR', defaultEmail),
      noreply: this.configService.get<string>('EMAIL_NOREPLY', defaultEmail),
    };
  }

  /**
   * Get specific email by type
   */
  getEmail(type: keyof EmailConfig): string {
    return this.getEmailConfig()[type];
  }

  /**
   * Get specific email by type (async, database-backed)
   */
  async getEmailAsync(type: keyof EmailConfig): Promise<string> {
    const defaultEmail = this.configService.get<string>('DEFAULT_EMAIL', 'erpsak53@gmail.com');
    const envVar = this.emailTypeToEnvVar[type];
    return this.getEmailByType(type, envVar, defaultEmail);
  }

  /**
   * Get admin email
   */
  getAdminEmail(): string {
    return this.getEmail('admin');
  }

  /**
   * Get sales email
   */
  getSalesEmail(): string {
    return this.getEmail('sales');
  }

  /**
   * Get support email
   */
  getSupportEmail(): string {
    return this.getEmail('support');
  }

  /**
   * Get technical email
   */
  getTechnicalEmail(): string {
    return this.getEmail('technical');
  }

  /**
   * Get purchase email
   */
  getPurchaseEmail(): string {
    return this.getEmail('purchase');
  }

  getProductionEmail(): string {
    return this.getEmail('production');
  }

  getAccountsEmail(): string {
    return this.getEmail('accounts');
  }

  getRemindersEmail(): string {
    return this.getEmail('reminders');
  }

  /**
   * Get HR email
   */
  getHREmail(): string {
    return this.getEmail('hr');
  }

  /**
   * Get no-reply email
   */
  getNoReplyEmail(): string {
    return this.getEmail('noreply');
  }

  /**
   * Get all email configurations with details from database
   */
  async getAllEmailConfigDetails(): Promise<EmailConfigDetail[]> {
    try {
      const result = await this.databaseService.executeQuery(
        `SELECT id, email_type, email_address, display_name, description, is_active 
         FROM email_config 
         ORDER BY 
           CASE email_type 
             WHEN 'admin' THEN 1 
             WHEN 'sales' THEN 2 
             WHEN 'purchase' THEN 3 
             WHEN 'production' THEN 4 
             WHEN 'accounts' THEN 5 
             WHEN 'reminders' THEN 6 
             WHEN 'quality' THEN 7 
             WHEN 'documents' THEN 8 
             WHEN 'support' THEN 9 
             WHEN 'technical' THEN 10 
             WHEN 'hr' THEN 11 
             WHEN 'noreply' THEN 12 
             ELSE 13 
           END`,
        []
      );
      return this.mergeDefaultConfigDetails(result.rows as EmailConfigDetail[]);
    } catch (error) {
      console.error('Failed to fetch email config details:', error);
      return this.mergeDefaultConfigDetails([]);
    }
  }

  private mergeDefaultConfigDetails(rows: EmailConfigDetail[]): EmailConfigDetail[] {
    const defaultEmail = this.configService.get<string>('DEFAULT_EMAIL', 'erpsak53@gmail.com');
    const byType = new Map(rows.map((row) => [row.email_type, row]));

    return DEFAULT_EMAIL_CONFIGS.map((definition) => {
      const saved = byType.get(definition.email_type);
      return {
        ...definition,
        ...saved,
        email_type: definition.email_type,
        email_address:
          saved?.email_address ||
          this.configService.get<string>(definition.envVar, defaultEmail),
        display_name: saved?.display_name || definition.display_name,
        description: saved?.description || definition.description,
        is_active: saved?.is_active ?? true,
      };
    });
  }

  /**
   * Update email configuration
   */
  async updateEmailConfig(
    emailType: string,
    emailAddress: string,
    userId?: string,
    metadata?: { display_name?: string; description?: string; is_active?: boolean },
  ): Promise<void> {
    try {
      const defaultDefinition = DEFAULT_EMAIL_CONFIGS.find((config) => config.email_type === emailType);
      const result = await this.databaseService.executeQuery(
        `UPDATE email_config 
         SET email_address = $1,
             display_name = COALESCE($2, display_name),
             description = COALESCE($3, description),
             is_active = COALESCE($4, is_active),
             updated_by = $5,
             updated_at = CURRENT_TIMESTAMP 
         WHERE email_type = $6
         RETURNING id`,
        [
          emailAddress,
          metadata?.display_name || null,
          metadata?.description || null,
          typeof metadata?.is_active === 'boolean' ? metadata.is_active : null,
          userId || null,
          emailType,
        ]
      );

      if (result.rows.length === 0) {
        // Insert if not exists
        await this.databaseService.executeQuery(
          `INSERT INTO email_config (email_type, email_address, display_name, description, is_active, updated_by) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            emailType,
            emailAddress,
            metadata?.display_name || defaultDefinition?.display_name || emailType,
            metadata?.description || defaultDefinition?.description || '',
            metadata?.is_active ?? true,
            userId || null,
          ]
        );
      }

      // Clear cache after update
      this.clearCache();
    } catch (error) {
      console.error(`Failed to update ${emailType} email:`, error);
      throw new Error(`Failed to update email configuration`);
    }
  }

  /**
   * Bulk update email configurations
   */
  async bulkUpdateEmailConfig(
    configs: Array<{
      email_type: string;
      email_address: string;
      display_name?: string;
      description?: string;
      is_active?: boolean;
    }>,
    userId?: string,
  ): Promise<void> {
    for (const config of configs) {
      await this.updateEmailConfig(config.email_type, config.email_address, userId, {
        display_name: config.display_name,
        description: config.description,
        is_active: config.is_active,
      });
    }
  }

  /**
   * Get company name
   */
  getCompanyName(companyNameOverride?: string): string {
    if (typeof companyNameOverride === 'string' && companyNameOverride.trim()) {
      return companyNameOverride.trim();
    }
    return this.configService.get('COMPANY_NAME', 'SAK Solutions');
  }

  /**
   * Get company address
   */
  getCompanyAddress(): string {
    return this.configService.get('COMPANY_ADDRESS', '');
  }

  /**
   * Get company phone
   */
  getCompanyPhone(): string {
    return this.configService.get('COMPANY_PHONE', '');
  }

  /**
   * Get formatted sender address for emails
   */
  getFromAddress(type: keyof EmailConfig = 'noreply', companyNameOverride?: string): string {
    const email = this.getEmail(type);
    const companyName = this.getCompanyName(companyNameOverride);
    return `"${companyName}" <${email}>`;
  }

  /**
   * Get formatted sender address for emails (async, database-backed)
   */
  async getFromAddressAsync(type: keyof EmailConfig = 'noreply', companyNameOverride?: string): Promise<string> {
    const email = await this.getEmailAsync(type);
    const companyName = this.getCompanyName(companyNameOverride);
    return `"${companyName}" <${email}>`;
  }

  /**
   * Get email signature HTML
   */
  getEmailSignature(overrides?: { companyName?: string; address?: string; phone?: string; email?: string }): string {
    const companyName = this.getCompanyName(overrides?.companyName);
    const companyAddress = typeof overrides?.address === 'string' ? overrides.address.trim() : this.getCompanyAddress();
    const companyPhone = typeof overrides?.phone === 'string' ? overrides.phone.trim() : this.getCompanyPhone();
    const supportEmail = typeof overrides?.email === 'string' && overrides.email.trim()
      ? overrides.email.trim()
      : this.getSupportEmail();

    let signature = `
      <br><br>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #f59e0b; font-family: Arial, sans-serif;">
        <p style="margin: 0; font-weight: bold; color: #1f2937; font-size: 16px;">${companyName}</p>
    `;

    if (companyAddress) {
      signature += `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;">${companyAddress}</p>`;
    }

    if (companyPhone) {
      signature += `<p style="margin: 5px 0; color: #6b7280; font-size: 14px;">Tel: ${companyPhone}</p>`;
    }

    signature += `
        <p style="margin: 5px 0; color: #6b7280; font-size: 14px;">Email: <a href="mailto:${supportEmail}" style="color: #f59e0b; text-decoration: none;">${supportEmail}</a></p>
      </div>
    `;

    return signature;
  }
}
