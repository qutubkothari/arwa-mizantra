import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PDFFont, PDFDocument, PDFImage, PDFPage, rgb } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

export interface DocumentBranding {
  companyName: string;
  legalName?: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoUrl: string;
  headerImageUrl?: string;
  footerImageUrl?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  footerText?: string;
  footerContactLine?: string;
  showLogo?: boolean;
  showTaxId?: boolean;
  showContact?: boolean;
  initials: string;
  addressLines: string[];
  contactLine: string;
}

export const DOCUMENT_BRAND_COLORS = {
  primary: rgb(0.149, 0.271, 0.553),
  accent: rgb(0.894, 0.655, 0.153),
  light: rgb(0.929, 0.949, 0.988),
  text: rgb(0.12, 0.12, 0.14),
  muted: rgb(0.4, 0.43, 0.5),
  border: rgb(0.78, 0.81, 0.86),
  white: rgb(1, 1, 1),
};

type BrandingOverrides = Partial<
  Pick<DocumentBranding, 'companyName' | 'legalName' | 'address' | 'phone' | 'email' | 'website' | 'taxId' | 'logoUrl'>
>;

type StandardPdfHeaderOptions = {
  page: PDFPage;
  topY: number;
  marginX: number;
  width: number;
  title: string;
  reference?: string;
  branding: DocumentBranding;
  font: PDFFont;
  fontBold: PDFFont;
  assets?: PdfBrandingAssets;
};

export type PdfBrandingAssets = {
  scriptLogo?: PDFImage;
  markLogo?: PDFImage;
  headerImage?: PDFImage;
  footerImage?: PDFImage;
};

@Injectable()
export class DocumentBrandingService {
  private readonly logger = new Logger(DocumentBrandingService.name);
  private readonly supabase?: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  async getBranding(tenantId?: string, overrides?: BrandingOverrides): Promise<DocumentBranding> {
    const tenant = await this.fetchTenantBranding(tenantId);
    const fallback = this.getFallbackBranding();
    const useTenantBranding = this.hasStructuredBranding(tenant);

    const letterhead = this.getLetterheadSettings(tenant);
    const companyName = this.normalizeCompanyName(this.getFirstNonEmptyValue(
      letterhead.companyName,
      useTenantBranding ? tenant?.name : '',
      overrides?.companyName,
      fallback.companyName,
    ));
    const legalName = this.getFirstNonEmptyValue(letterhead.legalName, overrides?.legalName, companyName);
    const address = this.getFirstNonEmptyValue(
      letterhead.address,
      useTenantBranding ? tenant?.address : '',
      overrides?.address,
      fallback.address,
    );
    const phone = this.getFirstNonEmptyValue(
      letterhead.phone,
      useTenantBranding ? tenant?.phone : '',
      overrides?.phone,
      fallback.phone,
    );
    const email = this.getFirstNonEmptyValue(
      letterhead.email,
      useTenantBranding ? tenant?.email : '',
      overrides?.email,
      fallback.email,
    );
    const website = this.normalizeWebsite(
      this.getFirstNonEmptyValue(
        letterhead.website,
        useTenantBranding ? tenant?.domain : '',
        overrides?.website,
        fallback.website,
      ),
    );
    const taxId = this.getFirstNonEmptyValue(
      letterhead.taxId,
      useTenantBranding ? tenant?.tax_id : '',
      overrides?.taxId,
      fallback.taxId,
    );
    const logoUrl = this.getFirstNonEmptyValue(
      letterhead.logoUrl,
      useTenantBranding ? tenant?.logo_url : '',
      overrides?.logoUrl,
      fallback.logoUrl,
    );
    const headerImageUrl = this.getFirstNonEmptyValue(letterhead.headerImageUrl);
    const footerImageUrl = this.getFirstNonEmptyValue(letterhead.footerImageUrl);
    const addressLines = this.toAddressLines(address);
    const showContact = letterhead.showContact !== false;
    const showTaxId = letterhead.showTaxId !== false;
    const showLogo = letterhead.showLogo !== false;
    const contactLine = showContact ? [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : '', website ? website : '']
      .filter(Boolean)
      .join('  |  ') : '';

    return {
      companyName,
      legalName,
      address,
      phone,
      email,
      website,
      taxId,
      logoUrl,
      headerImageUrl,
      footerImageUrl,
      headerTitle: this.getFirstNonEmptyValue(letterhead.headerTitle, companyName),
      headerSubtitle: this.getFirstNonEmptyValue(letterhead.headerSubtitle),
      footerText: this.getFirstNonEmptyValue(letterhead.footerText, `Computer-generated document from ${companyName}.`),
      footerContactLine: this.getFirstNonEmptyValue(letterhead.footerContactLine, contactLine),
      showLogo,
      showTaxId,
      showContact,
      initials: this.getInitials(companyName),
      addressLines,
      contactLine,
    };
  }

  async preparePdfBrandingAssets(pdfDoc: PDFDocument, branding?: DocumentBranding): Promise<PdfBrandingAssets> {
    const assets: PdfBrandingAssets = {};

    const markLogoPath = this.resolveExistingAsset(['sak-solutions-mark.png']);
    if (markLogoPath) {
      try {
        assets.markLogo = await pdfDoc.embedPng(fs.readFileSync(markLogoPath));
      } catch (error) {
        this.logger.warn(`Failed to embed SAK Solutions logo: ${String((error as any)?.message || error)}`);
      }
    }

    if (branding?.headerImageUrl) {
      assets.headerImage = await this.tryEmbedImage(pdfDoc, branding.headerImageUrl, 'header letterhead');
    }

    if (branding?.footerImageUrl) {
      assets.footerImage = await this.tryEmbedImage(pdfDoc, branding.footerImageUrl, 'footer letterhead');
    }

    return assets;
  }

  async createBrandedPage(pdfDoc: PDFDocument, assets?: PdfBrandingAssets, size: [number, number] = [595, 842]): Promise<PDFPage> {
    return pdfDoc.addPage(size);
  }

  drawStandardHeader(options: StandardPdfHeaderOptions): number {
    const { page, topY, marginX, width, title, reference, branding, font, fontBold, assets } = options;
    const headerHeight = 88;
    const titleBarHeight = 22;
    const headerY = topY - headerHeight;
    const titleBarY = headerY - 8 - titleBarHeight;
    const rightBlockWidth = 235;
    const rightBlockX = marginX + width - rightBlockWidth - 6;
    const addressLines = branding.addressLines.length > 3
      ? [branding.addressLines.slice(0, 3).join(', '), branding.addressLines.slice(3).join(', ')]
      : branding.addressLines;
    const markScale = assets?.markLogo
      ? Math.min(58 / assets.markLogo.width, 58 / assets.markLogo.height)
      : 1;
    const markDims = assets?.markLogo ? assets.markLogo.scale(markScale) : null;
    const scriptScale = assets?.scriptLogo ? Math.min(210 / assets.scriptLogo.width, 60 / assets.scriptLogo.height) : 1;
    const scriptDims = assets?.scriptLogo ? assets.scriptLogo.scale(scriptScale) : null;
    const logoBlockCenterY = headerY + 46;

    page.drawRectangle({
      x: marginX,
      y: headerY,
      width,
      height: headerHeight,
      color: DOCUMENT_BRAND_COLORS.white,
    });

    if (assets?.headerImage) {
      page.drawImage(assets.headerImage, {
        x: marginX,
        y: headerY,
        width,
        height: headerHeight,
      });
    } else {

    if (branding.showLogo !== false && assets?.markLogo && markDims) {
      page.drawImage(assets.markLogo, {
        x: marginX + 12,
        y: logoBlockCenterY - markDims.height / 2,
        width: markDims.width,
        height: markDims.height,
      });
    }

    if (branding.showLogo !== false && assets?.scriptLogo && scriptDims) {
      page.drawImage(assets.scriptLogo, {
        x: marginX + 12,
        y: logoBlockCenterY - scriptDims.height / 2,
        width: scriptDims.width,
        height: scriptDims.height,
      });
    } else {
      page.drawText(branding.companyName, {
        x: assets?.markLogo ? marginX + 80 : marginX + 12,
        y: headerY + 36,
        size: 18,
        font: fontBold,
        color: DOCUMENT_BRAND_COLORS.text,
      });
    }

    if (branding.headerSubtitle) {
      const subtitle = this.wrapText(branding.headerSubtitle, 250, 8, font).slice(0, 1)[0];
      page.drawText(subtitle, {
        x: marginX + 12,
        y: headerY + 24,
        size: 8,
        font,
        color: DOCUMENT_BRAND_COLORS.muted,
      });
    }
    }

    if (!assets?.headerImage) {
      const companyNameSize = 12;
      const companyNameWidth = fontBold.widthOfTextAtSize(branding.companyName, companyNameSize);
      page.drawText(branding.companyName, {
        x: rightBlockX + rightBlockWidth - companyNameWidth,
        y: headerY + 62,
        size: companyNameSize,
        font: fontBold,
        color: DOCUMENT_BRAND_COLORS.text,
      });

      let infoY = headerY + 48;
      addressLines.filter(Boolean).forEach((line) => {
        const wrapped = this.wrapText(line, rightBlockWidth, 8, font);
        wrapped.forEach((part) => {
          const textWidth = font.widthOfTextAtSize(part, 8);
          page.drawText(part, {
            x: rightBlockX + rightBlockWidth - textWidth,
            y: infoY,
            size: 8,
            font,
            color: DOCUMENT_BRAND_COLORS.text,
          });
          infoY -= 9;
        });
      });

      if (branding.showContact !== false && branding.email) {
        const emailLine = `Email : ${branding.email}`;
        const emailWidth = font.widthOfTextAtSize(emailLine, 8);
        page.drawText(emailLine, {
          x: rightBlockX + rightBlockWidth - emailWidth,
          y: infoY - 1,
          size: 8,
          font,
          color: DOCUMENT_BRAND_COLORS.text,
        });
        infoY -= 10;
      }

      if (branding.showTaxId !== false && branding.taxId) {
        const gstLine = `GSTIN : ${branding.taxId}`;
        const gstWidth = font.widthOfTextAtSize(gstLine, 8);
        page.drawText(gstLine, {
          x: rightBlockX + rightBlockWidth - gstWidth,
          y: infoY - 1,
          size: 8,
          font,
          color: DOCUMENT_BRAND_COLORS.text,
        });
      }
    }

    page.drawLine({
      start: { x: marginX + 8, y: headerY + 3 },
      end: { x: marginX + width, y: headerY + 3 },
      thickness: 1,
      color: DOCUMENT_BRAND_COLORS.primary,
    });

    page.drawRectangle({
      x: marginX,
      y: titleBarY,
      width,
      height: titleBarHeight,
      color: DOCUMENT_BRAND_COLORS.primary,
    });

    const titleTextWidth = fontBold.widthOfTextAtSize(title, 12);
    page.drawText(title, {
      x: marginX + (width - titleTextWidth) / 2,
      y: titleBarY + 6,
      size: 12,
      font: fontBold,
      color: DOCUMENT_BRAND_COLORS.white,
    });

    // PO reference number is shown in the Reference block below — not repeated here

    return titleBarY - 12;
  }

  private async fetchTenantBranding(tenantId?: string) {
    if (!tenantId || !this.supabase) {
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from('tenants')
        // The canonical tenant table stores branding inside settings.  Keep
        // this projection compatible with both current and legacy schemas.
        .select('name, domain, settings')
        .eq('id', tenantId)
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.warn(`Failed to load tenant branding for tenant ${tenantId}: ${String((error as any)?.message || error)}`);
      return null;
    }
  }

  private getFallbackBranding(): DocumentBranding {
    const companyName =
      this.cleanText(this.configService.get<string>('COMPANY_NAME')) ||
      'SAK Solutions';
    const address =
      this.cleanText(this.configService.get<string>('COMPANY_ADDRESS')) ||
      '1st Floor, Sunrise Incubation Hub, Hill No. 3, Rushikonda, Visakhapatnam - 530045';
    const phone = this.cleanText(this.configService.get<string>('COMPANY_PHONE')) || '0891-6662153';
    const email = this.cleanText(this.configService.get<string>('COMPANY_EMAIL')) || 'info@mizantra.ae';
    const website = this.normalizeWebsite(this.configService.get<string>('COMPANY_WEBSITE'));
    const taxId = this.cleanText(this.configService.get<string>('COMPANY_TAX_ID')) || '37ADSFS6370G1ZG';
    const logoUrl = this.cleanText(this.configService.get<string>('COMPANY_LOGO_URL')) || '';

    return {
      companyName,
      legalName: companyName,
      address,
      phone,
      email,
      website,
      taxId,
      logoUrl,
      headerImageUrl: '',
      footerImageUrl: '',
      headerTitle: companyName,
      headerSubtitle: '',
      footerText: `Computer-generated document from ${companyName}.`,
      footerContactLine: [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : '', website ? website : '']
        .filter(Boolean)
        .join('  |  '),
      showLogo: true,
      showTaxId: true,
      showContact: true,
      initials: this.getInitials(companyName),
      addressLines: this.toAddressLines(address),
      contactLine: [phone ? `Phone: ${phone}` : '', email ? `Email: ${email}` : '', website ? website : '']
        .filter(Boolean)
        .join('  |  '),
    };
  }

  private getFirstNonEmptyValue(...values: unknown[]): string {
    for (const value of values) {
      const normalized = this.cleanText(value);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private hasStructuredBranding(tenant?: Record<string, unknown> | null): boolean {
    const letterhead = this.getLetterheadSettings(tenant);
    return Boolean(
      this.getFirstNonEmptyValue(
        tenant?.name,
        tenant?.domain,
        tenant?.address,
        tenant?.phone,
        tenant?.email,
        tenant?.tax_id,
        tenant?.logo_url,
        letterhead.companyName,
        letterhead.address,
        letterhead.logoUrl,
      ),
    );
  }

  private getLetterheadSettings(tenant?: Record<string, unknown> | null): Record<string, any> {
    const settings = tenant?.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return {};
    }

    const letterhead = (settings as any).letterhead;
    if (!letterhead || typeof letterhead !== 'object' || Array.isArray(letterhead)) {
      return {};
    }

    return letterhead;
  }

  private async tryEmbedImage(pdfDoc: PDFDocument, imageUrl: string, label: string): Promise<PDFImage | undefined> {
    try {
      const bytes = await this.loadImageBytes(imageUrl);
      if (!bytes) return undefined;
      const lower = imageUrl.toLowerCase();
      if (lower.includes('.png') || lower.includes('image/png')) {
        return await pdfDoc.embedPng(bytes);
      }
      return await pdfDoc.embedJpg(bytes);
    } catch (error) {
      this.logger.warn(`Failed to embed ${label}: ${String((error as any)?.message || error)}`);
      return undefined;
    }
  }

  private async loadImageBytes(imageUrl: string): Promise<Uint8Array | undefined> {
    const cleanUrl = this.cleanText(imageUrl);
    if (!cleanUrl) return undefined;

    if (cleanUrl.startsWith('/uploads/')) {
      const uploadsRoot =
        this.configService.get<string>('UPLOAD_ROOT_DIR') ||
        path.resolve(process.cwd(), '..', '..', 'uploads');
      const relative = cleanUrl.replace(/^\/uploads\//, '');
      const candidate = path.resolve(uploadsRoot, relative);
      if (!candidate.startsWith(path.resolve(uploadsRoot)) || !fs.existsSync(candidate)) {
        return undefined;
      }
      return fs.readFileSync(candidate);
    }

    if (/^https?:\/\//i.test(cleanUrl)) {
      const response = await fetch(cleanUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }

    if (fs.existsSync(cleanUrl)) {
      return fs.readFileSync(cleanUrl);
    }

    return undefined;
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').trim();
  }

  /** If a company name is stored in ALL CAPS, convert to Title Case. Leaves mixed-case names alone. */
  private normalizeCompanyName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;
    const alpha = trimmed.replace(/[^a-zA-Z]/g, '');
    if (alpha.length === 0) return trimmed;
    const upperCount = (alpha.match(/[A-Z]/g) || []).length;
    if (upperCount / alpha.length > 0.7) {
      return trimmed
        .toLowerCase()
        .replace(/(?:^|\s|-)([a-z])/g, (m: string, ch: string) => m.slice(0, -1) + ch.toUpperCase());
    }
    return trimmed;
  }

  private normalizeWebsite(value: unknown): string {
    const raw = this.cleanText(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.includes('.') && !raw.includes(' ')) return `https://${raw}`;
    return raw;
  }

  private toAddressLines(address: string): string[] {
    if (!address) return [];

    const lines = address
      .split(/\r?\n|,(?=\s*[A-Za-z0-9])/)
      .map((part) => part.trim())
      .filter(Boolean);

    return lines.length > 0 ? lines : [address];
  }

  private getInitials(companyName: string): string {
    const letters = companyName
      .split(/\s+/)
      .map((part) => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return letters || 'CO';
  }

  private getAssetSearchDirs(): string[] {
    return [
      path.join(process.cwd(), 'assets'),
      path.join(process.cwd(), 'apps', 'api', 'assets'),
      path.resolve(__dirname, '..', '..', '..', 'assets'),
      path.resolve(__dirname, '..', '..', 'assets'),
    ];
  }

  private resolveExistingAsset(fileNames: string[]): string | undefined {
    for (const dir of this.getAssetSearchDirs()) {
      for (const fileName of fileNames) {
        const candidate = path.join(dir, fileName);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return undefined;
  }

  private wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return [''];

    const lines: string[] = [];
    let current = words[0];

    for (let index = 1; index < words.length; index++) {
      const next = `${current} ${words[index]}`;
      if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) {
        current = next;
      } else {
        lines.push(current);
        current = words[index];
      }
    }

    lines.push(current);
    return lines;
  }
}
