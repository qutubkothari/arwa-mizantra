import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { EmailConfigService } from './email-config.service';
import { GmailOAuth2Service } from './gmail-oauth2.service';
import { DocumentBranding, DocumentBrandingService } from '../common/services/document-branding.service';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(
    private configService: ConfigService,
    private emailConfig: EmailConfigService,
    private gmailOAuth2Service: GmailOAuth2Service,
    private documentBrandingService: DocumentBrandingService,
  ) {
    // Initialize email transporter
    const portRaw = this.configService.get('SMTP_PORT', 587);
    const port = typeof portRaw === 'string' ? parseInt(portRaw, 10) : portRaw;

    this.transporter = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST', 'smtp.gmail.com'),
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
    });
  }

  private getTransportUser(): string | undefined {
    if (this.gmailOAuth2Service?.isConfigured()) {
      return this.configService.get('GMAIL_USER') || this.configService.get('SMTP_USER');
    }
    return this.configService.get('SMTP_USER');
  }

  private normalizeEmailAddress(value?: string): string {
    return (value || '').trim().toLowerCase();
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatPlainTextAsHtml(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return this.escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
  }

  private listAttachmentNames(attachments: nodemailer.SendMailOptions['attachments']): string[] {
    const raw = attachments;
    if (!raw) return [];
    const items = Array.isArray(raw) ? raw : [raw];

    const names: string[] = [];
    for (const item of items) {
      if (!item) continue;
      if (typeof item === 'string') {
        names.push(item);
        continue;
      }

      const filename = (item as any).filename;
      if (typeof filename === 'string' && filename.trim()) {
        names.push(filename.trim());
        continue;
      }

      const path = (item as any).path;
      if (typeof path === 'string' && path.trim()) {
        names.push(path.trim());
      }
    }

    return names;
  }

  private hasSmtpCredentials(): boolean {
    const smtpUser = (this.configService.get('SMTP_USER') || '').trim();
    const smtpPass = (this.configService.get('SMTP_PASS') || '').trim();
    return Boolean(smtpUser && smtpPass);
  }

  private getForcedRecipients(): string[] {
    const recipient =
      this.configService.get<string>('EMAIL_FORCE_RECIPIENT') ||
      this.configService.get<string>('EMAIL_RECIPIENT_OVERRIDE') ||
      this.configService.get<string>('EMAIL_TEST_RECIPIENT');

    if (typeof recipient !== 'string' || !recipient.trim()) return [];

    return recipient
      .split(/[;,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private stringifyRecipients(value: nodemailer.SendMailOptions['to']): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          return String((entry as any).address || (entry as any).name || '');
        })
        .filter(Boolean)
        .join(', ');
    }
    return String((value as any).address || (value as any).name || '');
  }

  private applyForcedRecipient(mailOptions: nodemailer.SendMailOptions): nodemailer.SendMailOptions {
    const forcedRecipients = this.getForcedRecipients();
    if (forcedRecipients.length === 0) return mailOptions;

    const originalTo = this.stringifyRecipients(mailOptions.to);
    const originalCc = this.stringifyRecipients(mailOptions.cc as any);
    const originalBcc = this.stringifyRecipients(mailOptions.bcc as any);
    const originalRecipients = [originalTo && `to=${originalTo}`, originalCc && `cc=${originalCc}`, originalBcc && `bcc=${originalBcc}`]
      .filter(Boolean)
      .join('; ');

    const forcedRecipientLabel = forcedRecipients.join(', ');

    console.log(
      `Email recipient override active: redirecting outbound email to ${forcedRecipientLabel}${
        originalRecipients ? ` (original ${originalRecipients})` : ''
      }`,
    );

    return {
      ...mailOptions,
      to: forcedRecipients,
      cc: undefined,
      bcc: undefined,
      headers: {
        ...(mailOptions.headers || {}),
        'X-SAK-Email-Recipient-Override': 'true',
        ...(originalRecipients ? { 'X-SAK-Original-Recipients': originalRecipients } : {}),
      },
    };
  }

  private isAuthError(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return (
      message.includes('535') ||
      message.includes('invalid login') ||
      message.includes('badcredentials') ||
      message.includes('username and password not accepted')
    );
  }

  public async applyFromAndReplyTo(
    mailOptions: nodemailer.SendMailOptions,
    fromType:
      | 'admin'
      | 'sales'
      | 'support'
      | 'technical'
      | 'purchase'
      | 'production'
      | 'accounts'
      | 'reminders'
      | 'quality'
      | 'documents'
      | 'hr'
      | 'noreply' = 'noreply',
    companyName?: string,
  ): Promise<nodemailer.SendMailOptions> {
    const transportUser = this.getTransportUser();

    const configuredFromEmail = await this.emailConfig.getEmailAsync(fromType);
    const configuredFrom = await this.emailConfig.getFromAddressAsync(fromType, companyName);

    if (!transportUser) {
      // Keep configured sender; the underlying transport will throw a clear error.
      return { ...mailOptions, from: configuredFrom };
    }

    const transportFrom = `"${this.emailConfig.getCompanyName(companyName)}" <${transportUser}>`;

    // If the configured From isn't the same as the authenticated user, many SMTP providers reject it.
    // In that case, send from the authenticated user and set Reply-To to the configured department inbox.
    const sameAddress =
      this.normalizeEmailAddress(configuredFromEmail) === this.normalizeEmailAddress(transportUser);

    if (sameAddress) {
      return { ...mailOptions, from: configuredFrom };
    }

    return {
      ...mailOptions,
      from: transportFrom,
      replyTo: configuredFromEmail,
    };
  }

  private async resolveBranding(data?: any): Promise<DocumentBranding> {
    const tenantId = this.extractTenantId(data);

    return this.documentBrandingService.getBranding(tenantId, {
      companyName: this.readString(data?.company_name) || this.readString(data?.companyName),
      address: this.readString(data?.company_address) || this.readString(data?.companyAddress),
      phone: this.readString(data?.company_phone) || this.readString(data?.companyPhone),
      email: this.readString(data?.company_email) || this.readString(data?.companyEmail),
      website: this.readString(data?.company_website) || this.readString(data?.companyWebsite),
      taxId: this.readString(data?.company_tax_id) || this.readString(data?.companyTaxId),
      logoUrl: this.readString(data?.company_logo_url) || this.readString(data?.companyLogoUrl),
    });
  }

  private extractTenantId(data?: any): string | undefined {
    const tenantId = data?.tenant_id ?? data?.tenantId;
    return typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private getEmailSignature(branding: DocumentBranding): string {
    return this.emailConfig.getEmailSignature({
      companyName: branding.companyName,
      address: branding.address,
      phone: branding.phone,
      email: branding.email,
    });
  }

  private renderEmailHeader(
    title: string,
    reference: string,
    branding: DocumentBranding,
    accentColor: string,
    subtitle?: string,
  ): string {
    const logoSrc = this.getEmailLogoSrc(branding);
    const addressHtml = branding.addressLines.map((line) => `<div>${this.escapeHtml(line)}</div>`).join('');
    const contactHtml = branding.contactLine ? `<div class="brand-contact">${this.escapeHtml(branding.contactLine)}</div>` : '';
    const subtitleHtml = subtitle ? `<p class="doc-subtitle">${this.escapeHtml(subtitle)}</p>` : '';
    const logoHtml = logoSrc
      ? `<div class="brand-logo-wrap"><img class="brand-logo" src="${logoSrc}" alt="${this.escapeHtml(branding.companyName)} logo" /></div>`
      : `<div class="brand-badge" style="background:${accentColor};">${this.escapeHtml(branding.initials)}</div>`;

    return `
      <div class="brand-shell">
        <div class="brand-card">
          ${logoHtml}
          <div class="brand-copy">
            <div class="brand-name">${this.escapeHtml(branding.companyName)}</div>
            <div class="brand-address">${addressHtml}</div>
            ${contactHtml}
          </div>
        </div>
        <div class="doc-card" style="background:${accentColor};">
          <div class="doc-title">${this.escapeHtml(title)}</div>
          <div class="doc-reference">${this.escapeHtml(reference || '')}</div>
          ${subtitleHtml}
        </div>
      </div>
    `;
  }

  private getEmailStyles(accentColor: string, accentTint: string): string {
    return `
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 24px; background: #f5f7fb; }
      .mail-wrap { max-width: 920px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; }
      .brand-shell { padding: 20px 20px 0; }
      .brand-card { display: flex; gap: 16px; align-items: flex-start; padding: 18px; border: 1px solid #d1d5db; border-bottom: none; }
      .brand-logo-wrap { width: 120px; min-width: 120px; height: 56px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .brand-logo { max-width: 120px; max-height: 56px; width: auto; height: auto; display: block; }
      .brand-badge { width: 52px; height: 52px; border-radius: 12px; color: white; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
      .brand-copy { min-width: 0; }
      .brand-name { font-size: 18px; font-weight: 700; color: #111827; }
      .brand-address { margin-top: 4px; color: #4b5563; font-size: 13px; }
      .brand-contact { margin-top: 6px; color: #6b7280; font-size: 12px; }
      .doc-card { color: white; padding: 18px 20px; }
      .doc-title { font-size: 28px; font-weight: 800; }
      .doc-reference { margin-top: 6px; font-size: 14px; font-weight: 600; letter-spacing: 0.03em; }
      .doc-subtitle { margin: 8px 0 0; font-size: 13px; opacity: 0.92; }
      .content { padding: 20px; }
      .info-box, .alert-box, .certificate-box { padding: 15px; margin: 15px 0; border-left: 4px solid ${accentColor}; background: ${accentTint}; }
      .certificate-box { border: 2px solid ${accentColor}; }
      .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
      .table th, .table td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: top; }
      .table th { background: #f4f4f4; font-weight: bold; }
      .total { text-align: right; font-size: 18px; font-weight: bold; color: ${accentColor}; }
      .footer { background: #f9fafb; padding: 15px 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
      .critical { background: #FEE2E2; color: #991B1B; font-weight: bold; }
      .high { background: #FED7AA; color: #9A3412; }
      ul, ol { padding-left: 20px; }
      p { margin: 0 0 14px; }
      a { color: ${accentColor}; }
    `;
  }

  private getEmailLogoSrc(branding: DocumentBranding): string | undefined {
    if (branding.logoUrl && /^https?:\/\//i.test(branding.logoUrl)) {
      return this.escapeHtml(branding.logoUrl);
    }

    const assetPath = this.resolveEmailLogoAsset();
    if (!assetPath) return undefined;

    try {
      const buffer = fs.readFileSync(assetPath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  private resolveEmailLogoAsset(): string | undefined {
    const candidates = [
      path.join(process.cwd(), 'assets', 'sak-solutions-mark.png'),
      path.join(process.cwd(), 'apps', 'api', 'assets', 'sak-solutions-mark.png'),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  async sendRFQ(to: string, rfqData: any) {
    const subject = String(rfqData?.subject || '').trim() || `Request for Quotation - ${rfqData.rfq_number}`;
    const branding = await this.resolveBranding(rfqData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject,
      html: this.generateRFQTemplate(rfqData, branding) + this.getEmailSignature(branding),
      attachments: rfqData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'purchase', branding.companyName);
    return this.sendMail(mailOptions);
  }

  async buildRFQPreview(to: string, rfqData: any) {
    const subject = String(rfqData?.subject || '').trim() || `Request for Quotation - ${rfqData.rfq_number}`;
    const branding = await this.resolveBranding(rfqData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject,
      html: this.generateRFQTemplate(rfqData, branding) + this.getEmailSignature(branding),
      attachments: rfqData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'purchase', branding.companyName);

    return {
      to: mailOptions.to,
      from: mailOptions.from,
      replyTo: mailOptions.replyTo,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: this.listAttachmentNames(mailOptions.attachments),
    };
  }

  async sendPO(to: string, poData: any) {
    const subject = String(poData?.subject || '').trim() || `Purchase Order - ${poData.po_number}`;
    const branding = await this.resolveBranding(poData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject,
      html: this.generatePOTemplate(poData, branding) + this.getEmailSignature(branding),
      attachments: poData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'purchase', branding.companyName);
    return this.sendMail(mailOptions);
  }

  async buildPOPreview(to: string, poData: any) {
    const subject = String(poData?.subject || '').trim() || `Purchase Order - ${poData.po_number}`;
    const branding = await this.resolveBranding(poData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject,
      html: this.generatePOTemplate(poData, branding) + this.getEmailSignature(branding),
      attachments: poData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'purchase', branding.companyName);

    return {
      to: mailOptions.to,
      from: mailOptions.from,
      replyTo: mailOptions.replyTo,
      subject: mailOptions.subject,
      html: mailOptions.html,
      attachments: this.listAttachmentNames(mailOptions.attachments),
    };
  }

  async sendPOTrackingReminder(to: string, poData: any) {
    const branding = await this.resolveBranding(poData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject: `Tracking Information Request - PO ${poData.po_number}`,
      html: this.generateTrackingReminderTemplate(poData, branding) + this.getEmailSignature(branding),
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'purchase', branding.companyName);
    return this.sendMail(mailOptions);
  }

  async sendSO(to: string, soData: any) {
    const branding = await this.resolveBranding(soData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject: `Sales Order Confirmation - ${soData.so_number}`,
      html: this.generateSOTemplate(soData, branding) + this.getEmailSignature(branding),
      attachments: soData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'sales', branding.companyName);
    return this.sendMail(mailOptions);
  }

  async sendDispatchNote(to: string, dispatchData: any) {
    const branding = await this.resolveBranding(dispatchData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject: `Dispatch Note - ${dispatchData.dispatch_number}`,
      html: this.generateDispatchTemplate(dispatchData, branding) + this.getEmailSignature(branding),
      attachments: dispatchData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'sales', branding.companyName);
    return this.sendMail(mailOptions);
  }

  async sendIssueCertificate(to: string, certificateData: any) {
    const branding = await this.resolveBranding(certificateData);
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject: `Issue Certificate - ${certificateData.certificate_number}`,
      html: this.generateCertificateTemplate(certificateData, branding) + this.getEmailSignature(branding),
      attachments: certificateData.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'sales', branding.companyName);
    return this.sendMail(mailOptions);
  }

  private async sendMail(mailOptions: nodemailer.SendMailOptions) {
    mailOptions = this.applyForcedRecipient(mailOptions);

    const oauthEnabled = Boolean(this.gmailOAuth2Service?.isConfigured());
    const smtpEnabled = this.hasSmtpCredentials();

    if (!oauthEnabled && !smtpEnabled) {
      throw new Error(
        'No outbound email transport configured. Configure Gmail OAuth2 (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN) or SMTP (SMTP_USER/SMTP_PASS).',
      );
    }

    const errors: string[] = [];

    if (oauthEnabled) {
      try {
        const info = await this.gmailOAuth2Service.sendEmail(mailOptions);
        console.log('Email sent (OAuth2):', info.messageId);
        return { success: true, messageId: info.messageId };
      } catch (error) {
        const msg = String((error as any)?.message || error);
        console.error('Email send error (OAuth2):', error);
        errors.push(`OAuth2: ${msg}`);
      }
    }

    if (smtpEnabled) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        console.log('Email sent (SMTP):', info.messageId);
        return { success: true, messageId: info.messageId };
      } catch (error) {
        const msg = String((error as any)?.message || error);
        console.error('Email send error (SMTP):', error);
        errors.push(`SMTP: ${msg}`);

        if (this.isAuthError(error) && oauthEnabled) {
          try {
            const info = await this.gmailOAuth2Service.sendEmail(mailOptions);
            console.log('Email sent (OAuth2 fallback after SMTP auth error):', info.messageId);
            return { success: true, messageId: info.messageId };
          } catch (oauthFallbackError) {
            const oauthMsg = String((oauthFallbackError as any)?.message || oauthFallbackError);
            console.error('Email send error (OAuth2 fallback):', oauthFallbackError);
            errors.push(`OAuth2 fallback: ${oauthMsg}`);
          }
        }
      }
    }

    throw new Error(`Failed to send email via all configured transports. ${errors.join(' | ')}`);
  }

  private generateRFQTemplate(rfqData: any, branding: DocumentBranding): string {
    const vendorName = this.escapeHtml(rfqData?.vendor_name || 'Vendor');
    const responseDate = this.escapeHtml(rfqData?.response_date || 'As soon as possible');
    const remarks = this.escapeHtml(rfqData?.remarks || '-');
    const customMessageHtml = rfqData?.custom_message
      ? this.formatPlainTextAsHtml(rfqData.custom_message)
      : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#8B6F47', '#f9f6f1')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Request for Quotation', this.escapeHtml(rfqData?.rfq_number || ''), branding, '#8B6F47', 'Vendor quotation request generated from ERP')}
          <div class="content">
            <p>Dear ${vendorName},</p>
            <p>We would like to request a quotation for the following items:</p>

            ${customMessageHtml ? `
              <div class="info-box">
                <strong>Message:</strong><br>
                ${customMessageHtml}
              </div>
            ` : ''}
            
            <table class="table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Quantity</th>
                  <th>UOM</th>
                  <th>Description</th>
                  <th>Required Date</th>
                </tr>
              </thead>
              <tbody>
                ${rfqData.items.map((item: any, index: number) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${this.escapeHtml(item?.item_code || '-')}</td>
                    <td>${this.escapeHtml(item?.item_name || '-')}</td>
                    <td>${item.quantity}</td>
                    <td>${this.escapeHtml(item?.uom || '-')}</td>
                    <td>${this.escapeHtml(item?.description || '-')}</td>
                    <td>${this.escapeHtml(item?.required_date || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <p><strong>Expected Response Date:</strong> ${responseDate}</p>
            <p><strong>Remarks:</strong> ${remarks}</p>
            
            <p>Please provide your best quotation including:</p>
            <ul>
              <li>Unit prices</li>
              <li>Lead time</li>
              <li>Payment terms</li>
              <li>Delivery terms</li>
            </ul>
            
            <p>Thank you for your cooperation.</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply directly to this email.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  private generatePOTemplate(poData: any, branding: DocumentBranding): string {
    const vendorName = this.escapeHtml(poData?.vendor_name || 'Vendor');
    const deliveryAddress = poData?.delivery_address ? this.escapeHtml(poData.delivery_address) : '';
    const remarks = poData?.remarks ? this.escapeHtml(poData.remarks) : '';
    const customMessageHtml = poData?.custom_message
      ? this.formatPlainTextAsHtml(poData.custom_message)
      : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#8B6F47', '#f9f6f1')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Purchase Order', this.escapeHtml(poData?.po_number || ''), branding, '#8B6F47', 'Purchase order issued from ERP')}
          <div class="content">
            <p>Dear ${vendorName},</p>
            <p>Please supply the following items as per the details below:</p>

            ${customMessageHtml ? `
              <div class="info-box">
                <strong>Message:</strong><br>
                ${customMessageHtml}
              </div>
            ` : ''}
            
            <div class="info-box">
              <strong>PO Date:</strong> ${this.escapeHtml(poData?.po_date || '-')}<br>
              <strong>Expected Delivery:</strong> ${this.escapeHtml(poData?.delivery_date || '-')}<br>
            </div>
            
            <table class="table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Tax %</th>
                  <th>Payment Terms</th>
                  <th>Delivery Terms</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${poData.items.map((item: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${this.escapeHtml(item?.item_name || '-')}</td>
                    <td>${item.quantity}</td>
                    <td>₹${item.unit_price.toFixed(2)}</td>
                    <td>${item.tax_percent}%</td>
                    <td>${this.escapeHtml(item?.payment_terms || item?.paymentTerms || '-')}</td>
                    <td>${this.escapeHtml(item?.delivery_terms || item?.deliveryTerms || '-')}</td>
                    <td>₹${item.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            ${poData.customs_duty ? `<p><strong>Customs Duty:</strong> ₹${poData.customs_duty.toFixed(2)}</p>` : ''}
            ${poData.other_charges ? `<p><strong>Other Charges:</strong> ₹${poData.other_charges.toFixed(2)}</p>` : ''}
            <p class="total">Total Amount: ₹${poData.total_amount.toFixed(2)}</p>
            
            ${deliveryAddress ? `
              <div class="info-box">
                <strong>Delivery Address:</strong><br>
                ${deliveryAddress}
              </div>
            ` : ''}
            
            ${remarks ? `<p><strong>Remarks:</strong> ${remarks}</p>` : ''}
            
            <p>Please acknowledge receipt of this PO and confirm the delivery schedule.</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>This is an automated email. For queries, please contact our purchase department.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  private generateTrackingReminderTemplate(poData: any, branding: DocumentBranding): string {
    const daysOverdue = Math.floor((new Date().getTime() - new Date(poData.delivery_date).getTime()) / (1000 * 60 * 60 * 24));
    
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#FFA500', '#FFF8E7')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Tracking Information Request', this.escapeHtml(`PO: ${poData.po_number || ''}`), branding, '#FFA500', 'Follow-up on vendor shipment tracking')}
          <div class="content">
            <p>Dear ${poData.vendor_name},</p>
            
            <div class="alert-box">
              ${daysOverdue > 0 
                ? `<strong>⚠️ URGENT:</strong> This order is ${daysOverdue} days overdue.` 
                : '<strong>📦 Reminder:</strong> Please provide tracking information for this order.'}
            </div>
            
            <p>We request you to provide the following tracking details:</p>
            <ul>
              <li>Tracking Number</li>
              <li>Carrier/Courier Name</li>
              <li>Shipped Date</li>
              <li>Expected Delivery Date</li>
              <li>Tracking URL (if available)</li>
            </ul>
            
            <p><strong>PO Details:</strong></p>
            <ul>
              <li>PO Number: ${poData.po_number}</li>
              <li>PO Date: ${poData.po_date}</li>
              <li>Expected Delivery: ${poData.delivery_date}</li>
              <li>Total Items: ${poData.items?.length || 0}</li>
            </ul>
            
            <p>Please update us at your earliest convenience.</p>
            <p>Thank you for your cooperation.</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>This is an automated reminder. Please provide tracking information to avoid delays.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  private generateSOTemplate(soData: any, branding: DocumentBranding): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#28a745', '#f1fbf4')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Sales Order Confirmation', this.escapeHtml(soData.so_number || ''), branding, '#28a745', 'Sales order confirmation from ERP')}
          <div class="content">
            <p>Dear ${soData.customer_name},</p>
            <p>Thank you for your order! We are pleased to confirm the following:</p>
            
            <div class="info-box">
              <strong>Order Date:</strong> ${soData.order_date}<br>
              <strong>Expected Delivery:</strong> ${soData.delivery_date || 'To be confirmed'}<br>
              <strong>Payment Terms:</strong> ${soData.payment_terms || '-'}
            </div>
            
            <table class="table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${soData.items.map((item: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${item.item_name}</td>
                    <td>${item.quantity}</td>
                    <td>₹${item.unit_price.toFixed(2)}</td>
                    <td>₹${item.amount.toFixed(2)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <p class="total">Total Amount: ₹${soData.total_amount.toFixed(2)}</p>
            
            ${soData.shipping_address ? `
              <div class="info-box">
                <strong>Shipping Address:</strong><br>
                ${soData.shipping_address}
              </div>
            ` : ''}
            
            <p>We will notify you once your order is dispatched.</p>
            <p>Thank you for your business!</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>For any queries, please contact our sales team.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  private generateDispatchTemplate(dispatchData: any, branding: DocumentBranding): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#007bff', '#eef6ff')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Dispatch Note', this.escapeHtml(dispatchData.dispatch_number || ''), branding, '#007bff', 'Dispatch confirmation from ERP')}
          <div class="content">
            <p>Dear ${dispatchData.customer_name},</p>
            <p>Your order has been dispatched!</p>
            
            <div class="info-box">
              <strong>Dispatch Date:</strong> ${dispatchData.dispatch_date}<br>
              <strong>Expected Delivery:</strong> ${dispatchData.expected_delivery}<br>
              ${dispatchData.tracking_number ? `<strong>Tracking Number:</strong> ${dispatchData.tracking_number}<br>` : ''}
              ${dispatchData.carrier_name ? `<strong>Carrier:</strong> ${dispatchData.carrier_name}<br>` : ''}
              ${dispatchData.tracking_url ? `<strong>Track Shipment:</strong> <a href="${dispatchData.tracking_url}">Click here</a>` : ''}
            </div>
            
            <table class="table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Item</th>
                  <th>Quantity</th>
                  <th>UID Numbers</th>
                </tr>
              </thead>
              <tbody>
                ${dispatchData.items.map((item: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${item.item_name}</td>
                    <td>${item.quantity}</td>
                    <td>${item.uid_numbers?.join(', ') || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            ${dispatchData.remarks ? `<p><strong>Remarks:</strong> ${dispatchData.remarks}</p>` : ''}
            
            <p>Please inspect the goods upon delivery and report any discrepancies immediately.</p>
            <p>Thank you for your business!</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>For support, please contact our customer service team.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  private generateCertificateTemplate(certificateData: any, branding: DocumentBranding): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#6f4e37', '#f8f4ef')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Issue Certificate', this.escapeHtml(certificateData.certificate_number || ''), branding, '#6f4e37', 'Certificate issued from ERP')}
          <div class="content">
            <p>Dear ${certificateData.customer_name},</p>
            <p>This certifies that the following products have been issued and delivered:</p>
            
            <div class="certificate-box">
              <p><strong>Issue Date:</strong> ${certificateData.issue_date}</p>
              <p><strong>Sales Order:</strong> ${certificateData.so_number}</p>
              <p><strong>Dispatch Number:</strong> ${certificateData.dispatch_number}</p>
            </div>
            
            <table class="table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Product</th>
                  <th>UID Number</th>
                  <th>Serial Number</th>
                  <th>Warranty Period</th>
                </tr>
              </thead>
              <tbody>
                ${certificateData.items.map((item: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${item.product_name}</td>
                    <td>${item.uid_number}</td>
                    <td>${item.serial_number || '-'}</td>
                    <td>${item.warranty_period || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <p><strong>Quality Assurance:</strong> All products have undergone quality inspection and meet our quality standards.</p>
            <p><strong>Warranty Information:</strong> ${certificateData.warranty_info || 'Standard warranty terms apply as per sales agreement.'}</p>
            
            <p>Please retain this certificate for warranty claims and service requests.</p>
            <p>Best regards,<br>${this.escapeHtml(branding.companyName)}</p>
          </div>
          <div class="footer">
            <p>This is an official certificate. Please keep it safe for future reference.</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }

  // Generic email sending method
  async sendEmail(options: { 
    to: string; 
    subject: string; 
    html: string; 
    attachments?: any[];
    from?: 'admin' | 'sales' | 'support' | 'technical' | 'purchase' | 'hr' | 'noreply';
    tenantId?: string;
  }) {
    const branding = await this.resolveBranding({ tenant_id: options.tenantId });
    let mailOptions: nodemailer.SendMailOptions = {
      to: options.to,
      subject: options.subject,
      html: options.html + this.getEmailSignature(branding),
      attachments: options.attachments || [],
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, options.from || 'noreply', branding.companyName);

    return this.sendMail(mailOptions);
  }

  async sendLowStockAlert(to: string, lowStockItems: any[], tenantId?: string) {
    const branding = await this.resolveBranding({ tenant_id: tenantId });
    let mailOptions: nodemailer.SendMailOptions = {
      to,
      subject: `⚠️ Low Stock Alert - ${lowStockItems.length} Items Need Attention`,
      html: this.generateLowStockTemplate(lowStockItems, branding) + this.getEmailSignature(branding),
    };

    mailOptions = await this.applyFromAndReplyTo(mailOptions, 'noreply', branding.companyName);
    return this.sendMail(mailOptions);
  }

  private generateLowStockTemplate(lowStockItems: any[], branding: DocumentBranding): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            ${this.getEmailStyles('#DC2626', '#FEF2F2')}
          </style>
        </head>
        <body>
          <div class="mail-wrap">
          ${this.renderEmailHeader('Low Stock Alert', this.escapeHtml(`${lowStockItems.length} items require attention`), branding, '#DC2626', 'Automated inventory alert from ERP')}
          <div class="content">
            <div class="alert-box">
              <strong>Action Required:</strong> The following items have reached or fallen below their reorder levels. Please take immediate action to replenish stock.
            </div>
            
            <table class="table">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Warehouse</th>
                  <th>Current Stock</th>
                  <th>Reorder Level</th>
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                ${lowStockItems.map((item: any) => `
                  <tr class="${item.severity === 'CRITICAL' ? 'critical' : item.severity === 'HIGH' ? 'high' : ''}">
                    <td>${item.items?.item_code || '-'}</td>
                    <td>${item.items?.item_name || '-'}</td>
                    <td>${item.warehouses?.warehouse_name || '-'}</td>
                    <td>${item.current_quantity || 0}</td>
                    <td>${item.threshold_quantity || 0}</td>
                    <td>${item.severity}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <p><strong>Recommended Actions:</strong></p>
            <ul>
              <li>Review Purchase Requisitions for these items</li>
              <li>Check pending Purchase Orders</li>
              <li>Contact vendors for urgent requirements</li>
              <li>Consider alternative suppliers if needed</li>
            </ul>
            
            <p>Access the ERP system to view detailed information and take action.</p>
          </div>
          <div class="footer">
            <p>This is an automated alert from ${this.escapeHtml(branding.companyName)} ERP System</p>
            <p>Generated at ${new Date().toLocaleString()}</p>
          </div>
          </div>
        </body>
      </html>
    `;
  }
}
