import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DOCUMENT_BRAND_COLORS, DocumentBrandingService } from '../../common/services/document-branding.service';

export type QuoteItemInput = {
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
};

export type QuoteCompanyInfo = {
  name: string;
  legal_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
};

export type QuoteCustomerInfo = {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type QuotePdfInput = {
  quote_number: string;
  quote_date_iso: string;
  title: string;
  document_label?: string;
  company: QuoteCompanyInfo;
  customer: QuoteCustomerInfo;
  items: QuoteItemInput[];
  currency?: string;
  tax_rate?: number; // ex: 0.18 for 18%
  discount?: number;
  notes?: string;
  terms?: string;
  show_totals?: boolean;
};

export type AccountStatementRowInput = {
  date: string;
  source: string;
  document_type: string;
  document_number: string;
  reference?: string;
  remarks?: string;
  debit: number;
  credit: number;
  balance: number;
};

export type AccountStatementPdfInput = {
  statement_date_iso: string;
  period_from: string;
  period_to: string;
  company: QuoteCompanyInfo;
  customer: QuoteCustomerInfo & { code?: string };
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  current_outstanding: number;
  ageing: Array<{ bucket: string; amount: number }>;
  transactions: AccountStatementRowInput[];
  currency?: string;
};

@Injectable()
export class QuotePdfService {
  constructor(private readonly documentBrandingService: DocumentBrandingService) {}

  async renderQuotePdf(tenantId: string, input: QuotePdfInput): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // A4 size in points (72 dpi)
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;

    const brand = {
      dark: DOCUMENT_BRAND_COLORS.primary,
      accent: DOCUMENT_BRAND_COLORS.accent,
      light: DOCUMENT_BRAND_COLORS.light,
      text: DOCUMENT_BRAND_COLORS.text,
      muted: DOCUMENT_BRAND_COLORS.muted,
      border: DOCUMENT_BRAND_COLORS.border,
    };
    const branding = await this.documentBrandingService.getBranding(tenantId, {
      companyName: input.company?.name,
      address: input.company?.address,
      phone: input.company?.phone,
      email: input.company?.email,
      website: input.company?.website,
    });
    const assets = await this.documentBrandingService.preparePdfBrandingAssets(pdfDoc, branding);

    const currency = (input.currency || 'INR').toUpperCase();
    const documentLabel = String(input.document_label || 'QUOTATION').trim().toUpperCase();
    const taxRate = typeof input.tax_rate === 'number' ? input.tax_rate : 0;
    const discount = typeof input.discount === 'number' ? input.discount : 0;

    const items = (input.items || []).map((it) => ({
      description: String(it.description || '').trim(),
      quantity: Number(it.quantity || 0),
      unit: (it.unit || '').trim(),
      unit_price: Number(it.unit_price || 0),
      line_total: Number(it.quantity || 0) * Number(it.unit_price || 0),
    }));

    const subtotal = items.reduce((sum, it) => sum + it.line_total, 0);
    const tax = subtotal * taxRate;
    const total = subtotal + tax - discount;

    const money = (n: number) => {
      const safe = Number.isFinite(n) ? n : 0;
      const formatted = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(safe);
      return `${currency} ${formatted}`;
    };

    const wrapText = (text: string, maxWidth: number, size: number) => {
      const words = String(text || '').split(/\s+/).filter(Boolean);
      if (words.length === 0) return [''];

      const lines: string[] = [];
      let current = words[0];

      for (let index = 1; index < words.length; index++) {
        const next = `${current} ${words[index]}`;
        if (font.widthOfTextAtSize(next, size) <= maxWidth) {
          current = next;
        } else {
          lines.push(current);
          current = words[index];
        }
      }

      lines.push(current);
      return lines;
    };

    const drawFooter = (page: any, pageIndex: number, pageCount: number) => {
      const text = `Page ${pageIndex + 1} of ${pageCount}`;
      if (assets.footerImage) {
        page.drawImage(assets.footerImage, {
          x: 40,
          y: 22,
          width: PAGE_W - 80,
          height: 30,
        });
        page.drawText(text, {
          x: 40,
          y: 58,
          size: 8,
          font,
          color: brand.muted,
        });
        return;
      }
      page.drawLine({
        start: { x: 40, y: 50 },
        end: { x: PAGE_W - 40, y: 50 },
        thickness: 1,
        color: brand.border,
      });
      page.drawText(text, {
        x: 40,
        y: 32,
        size: 9,
        font,
        color: brand.muted,
      });
      const footerRef = branding.footerText || `${branding.companyName} - ${input.quote_number}`;
      page.drawText(footerRef, {
        x: PAGE_W - 40 - font.widthOfTextAtSize(footerRef, 9),
        y: 32,
        size: 9,
        font,
        color: brand.muted,
      });
    };

    const pages: any[] = [];
    const addBodyPage = async () => {
      const page = await this.documentBrandingService.createBrandedPage(pdfDoc, assets, [PAGE_W, PAGE_H]);
      pages.push(page);
      return page;
    };

    const drawHeader = (page: any) => {
      const headerBottom = this.documentBrandingService.drawStandardHeader({
        page,
        topY: PAGE_H - 30,
        marginX: 40,
        width: PAGE_W - 80,
        title: documentLabel,
        reference: input.quote_number,
        branding,
        font,
        fontBold,
        assets,
      });

      page.drawText(input.title || documentLabel, {
        x: 40,
        y: headerBottom - 18,
        size: 16,
        font: fontBold,
        color: brand.text,
      });

      const dateLabel = `Date: ${input.quote_date_iso.slice(0, 10)}`;
      page.drawText(dateLabel, {
        x: PAGE_W - 40 - font.widthOfTextAtSize(dateLabel, 10),
        y: headerBottom - 16,
        size: 10,
        font,
        color: brand.muted,
      });

      const topY = headerBottom - 54;
      page.drawRectangle({
        x: 40,
        y: topY - 52,
        width: PAGE_W - 80,
        height: 58,
        color: brand.light,
        borderColor: brand.border,
        borderWidth: 1,
      });

      page.drawText('Bill To', {
        x: 50,
        y: topY - 12,
        size: 10,
        font: fontBold,
        color: brand.muted,
      });
      page.drawText(input.customer.name, {
        x: 50,
        y: topY - 28,
        size: 12,
        font: fontBold,
        color: brand.text,
      });

      const customerLines = [
        input.customer.address || '',
        [input.customer.phone ? `Phone: ${input.customer.phone}` : '', input.customer.email ? `Email: ${input.customer.email}` : '']
          .filter(Boolean)
          .join('  |  '),
      ].filter(Boolean);

      let customerY = topY - 42;
      customerLines.forEach((line) => {
        wrapText(line, PAGE_W - 100, 9,).forEach((part) => {
          page.drawText(part, {
            x: 50,
            y: customerY,
            size: 9,
            font,
            color: brand.text,
          });
          customerY -= 10;
        });
      });

      return topY - 74;
    };

    const drawTableHeader = (page: any, y: number) => {
      const x0 = 40;
      const w = PAGE_W - 80;
      page.drawRectangle({ x: x0, y: y - 20, width: w, height: 24, color: rgb(0.93, 0.93, 0.95) });
      page.drawLine({ start: { x: x0, y: y - 20 }, end: { x: x0 + w, y: y - 20 }, thickness: 1, color: brand.border });
      const cols = [
        { label: '#', x: x0 + 8 },
        { label: 'Description', x: x0 + 40 },
        { label: 'Qty', x: x0 + w - 225 },
        { label: 'Unit Price', x: x0 + w - 160 },
        { label: 'Amount', x: x0 + w - 64 },
      ];
      for (const col of cols) {
        page.drawText(col.label, { x: col.x, y: y - 12, size: 10, font: fontBold, color: brand.text });
      }
    };

    const rowHeight = 18;
    let page = await addBodyPage();
    let y = drawHeader(page);

    drawTableHeader(page, y);
    y -= 36;

    const x0 = 40;
    const w = PAGE_W - 80;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const descriptionLines = wrapText(it.description || '-', w - 280, 10).slice(0, 3);
      const itemRowHeight = Math.max(rowHeight, descriptionLines.length * 12);

      if (y < 170 + itemRowHeight) {
        page = await addBodyPage();
        y = drawHeader(page);
        drawTableHeader(page, y);
        y -= 36;
      }

      page.drawLine({ start: { x: x0, y: y - 4 }, end: { x: x0 + w, y: y - 4 }, thickness: 1, color: brand.border });

      page.drawText(String(i + 1), { x: x0 + 8, y, size: 10, font, color: brand.text });
      descriptionLines.forEach((line, lineIndex) => {
        page.drawText(line, { x: x0 + 40, y: y - lineIndex * 12, size: 10, font, color: brand.text });
      });

      const qtyText = it.unit ? `${it.quantity} ${it.unit}` : String(it.quantity);
      page.drawText(qtyText, {
        x: x0 + w - 225 - font.widthOfTextAtSize(qtyText, 10),
        y,
        size: 10,
        font,
        color: brand.text,
      });

      const unitPriceText = money(it.unit_price);
      page.drawText(unitPriceText, {
        x: x0 + w - 100 - font.widthOfTextAtSize(unitPriceText, 10),
        y,
        size: 10,
        font,
        color: brand.text,
      });

      const amountText = money(it.line_total);
      page.drawText(amountText, {
        x: x0 + w - 10 - font.widthOfTextAtSize(amountText, 10),
        y,
        size: 10,
        font,
        color: brand.text,
      });

      y -= itemRowHeight;
    }

    // Totals block (place on last page)
    if (input.show_totals !== false && y < 230) {
      page = await addBodyPage();
      y = drawHeader(page);
    }

    const totalsY = Math.max(y - 10, 170);
    page.drawLine({ start: { x: x0, y: totalsY }, end: { x: x0 + w, y: totalsY }, thickness: 1, color: brand.border });

    const rightX = x0 + w;
    const drawKV = (label: string, value: string, line: number, bold = false) => {
      const yy = totalsY - 26 - line * 16;
      page.drawText(label, { x: rightX - 260, y: yy, size: 10, font: bold ? fontBold : font, color: brand.text });
      page.drawText(value, {
        x: rightX - 40 - font.widthOfTextAtSize(value, 10),
        y: yy,
        size: 10,
        font: bold ? fontBold : font,
        color: brand.text,
      });
    };

    if (input.show_totals !== false) {
      drawKV('Subtotal', money(subtotal), 0);
      drawKV(`Tax (${(taxRate * 100).toFixed(0)}%)`, money(tax), 1);
      if (discount > 0) drawKV('Discount', `- ${money(discount)}`, 2);
      drawKV('Total', money(total), discount > 0 ? 3 : 2, true);
    }

    let notesTop = totalsY - 110;
    if (input.notes) {
      page.drawText('Notes', { x: x0, y: notesTop, size: 10, font: fontBold, color: brand.muted });
      wrapText(input.notes, w, 10).forEach((line, index) => {
        page.drawText(line, {
          x: x0,
          y: notesTop - 16 - index * 12,
          size: 10,
          font,
          color: brand.text,
        });
      });
      notesTop -= 16 + wrapText(input.notes, w, 10).length * 12;
    }

    const termsTop = input.notes ? notesTop - 18 : totalsY - 110;
    if (input.terms) {
      page.drawText('Terms', { x: x0, y: termsTop, size: 10, font: fontBold, color: brand.muted });
      wrapText(input.terms, w, 10).forEach((line, index) => {
        page.drawText(line, {
          x: x0,
          y: termsTop - 16 - index * 12,
          size: 10,
          font,
          color: brand.text,
        });
      });
    }

    const all = pdfDoc.getPages();
    const pageCount = all.length;
    for (let i = 0; i < pageCount; i++) {
      drawFooter(all[i], i, pageCount);
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }

  async renderAccountStatementPdf(tenantId: string, input: AccountStatementPdfInput): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const PAGE_W = 841.89;
    const PAGE_H = 595.28;
    const MARGIN = 32;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const currency = String(input.currency || 'INR').toUpperCase();
    const brand = {
      light: DOCUMENT_BRAND_COLORS.light,
      text: DOCUMENT_BRAND_COLORS.text,
      muted: DOCUMENT_BRAND_COLORS.muted,
      border: DOCUMENT_BRAND_COLORS.border,
    };
    const branding = await this.documentBrandingService.getBranding(tenantId, {
      companyName: input.company?.name,
      address: input.company?.address,
      phone: input.company?.phone,
      email: input.company?.email,
      website: input.company?.website,
    });
    const assets = await this.documentBrandingService.preparePdfBrandingAssets(pdfDoc, branding);
    const clean = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    const money = (value: unknown) => `${currency} ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const shortDate = (value: unknown) => {
      const raw = String(value || '').slice(0, 10);
      const [year, month, day] = raw.split('-');
      return year && month && day ? `${day}-${month}-${year}` : '-';
    };
    const wrap = (value: unknown, maxWidth: number, size: number, maxLines = 2) => {
      const words = clean(value).split(/\s+/).filter(Boolean);
      if (!words.length) return ['-'];
      const lines: string[] = [];
      let current = words[0];
      for (let index = 1; index < words.length; index += 1) {
        const candidate = `${current} ${words[index]}`;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
        else {
          lines.push(current);
          current = words[index];
          if (lines.length === maxLines - 1) break;
        }
      }
      if (lines.length < maxLines) lines.push(current);
      return lines.slice(0, maxLines);
    };
    const pages: any[] = [];
    const columns = [
      { key: 'date', label: 'Date', width: 62, align: 'left' },
      { key: 'source', label: 'Source', width: 55, align: 'left' },
      { key: 'document_type', label: 'Document Type', width: 90, align: 'left' },
      { key: 'document_number', label: 'Document No.', width: 95, align: 'left' },
      { key: 'reference', label: 'Reference / Remarks', width: 205, align: 'left' },
      { key: 'debit', label: 'Debit', width: 90, align: 'right' },
      { key: 'credit', label: 'Credit', width: 90, align: 'right' },
      { key: 'balance', label: 'Balance', width: 90, align: 'right' },
    ];
    const drawRight = (page: any, value: string, rightX: number, y: number, size = 8, bold = false) => {
      const selectedFont = bold ? fontBold : font;
      page.drawText(value, { x: rightX - selectedFont.widthOfTextAtSize(value, size), y, size, font: selectedFont, color: brand.text });
    };
    const drawTableHeader = (page: any, y: number) => {
      page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 22, color: rgb(0.93, 0.91, 0.87), borderColor: brand.border, borderWidth: 0.5 });
      let x = MARGIN;
      for (const column of columns) {
        const labelWidth = fontBold.widthOfTextAtSize(column.label, 7.5);
        page.drawText(column.label, { x: column.align === 'right' ? x + column.width - labelWidth - 4 : x + 4, y: y - 10, size: 7.5, font: fontBold, color: brand.text });
        x += column.width;
      }
    };
    const addPage = async () => {
      const page = await this.documentBrandingService.createBrandedPage(pdfDoc, assets, [PAGE_W, PAGE_H]);
      pages.push(page);
      const headerBottom = this.documentBrandingService.drawStandardHeader({
        page,
        topY: PAGE_H - 24,
        marginX: MARGIN,
        width: CONTENT_W,
        title: 'CUSTOMER ACCOUNT STATEMENT',
        reference: `${shortDate(input.period_from)} to ${shortDate(input.period_to)}`,
        branding,
        font,
        fontBold,
        assets,
      });
      const customerY = headerBottom - 18;
      page.drawText(clean(input.customer.name || 'Customer'), { x: MARGIN, y: customerY, size: 12, font: fontBold, color: brand.text });
      page.drawText(`Customer Code: ${clean(input.customer.code || '-')}`, { x: MARGIN, y: customerY - 14, size: 8.5, font, color: brand.muted });
      const address = clean(input.customer.address || '');
      if (address) page.drawText(wrap(address, 390, 8.5, 1)[0], { x: MARGIN, y: customerY - 27, size: 8.5, font, color: brand.text });
      drawRight(page, `Statement date: ${shortDate(input.statement_date_iso)}`, PAGE_W - MARGIN, customerY, 8.5);
      drawRight(page, `Period: ${shortDate(input.period_from)} to ${shortDate(input.period_to)}`, PAGE_W - MARGIN, customerY - 14, 8.5);
      const summaryY = customerY - 54;
      const summaries = [
        ['Opening', input.opening_balance],
        ['Period Debit', input.total_debit],
        ['Period Credit', input.total_credit],
        ['Closing', input.closing_balance],
        ['Outstanding', input.current_outstanding],
      ];
      const boxWidth = CONTENT_W / summaries.length;
      summaries.forEach(([label, value], index) => {
        const x = MARGIN + index * boxWidth;
        page.drawRectangle({ x, y: summaryY - 32, width: boxWidth, height: 36, color: brand.light, borderColor: brand.border, borderWidth: 0.5 });
        page.drawText(String(label).toUpperCase(), { x: x + 7, y: summaryY - 9, size: 7, font: fontBold, color: brand.muted });
        page.drawText(money(value), { x: x + 7, y: summaryY - 24, size: 9, font: fontBold, color: brand.text });
      });
      const ageingY = summaryY - 48;
      const ageingText = (input.ageing || []).map(entry => `${entry.bucket === 'CURRENT' ? 'Current' : `${entry.bucket} days`}: ${money(entry.amount)}`).join('   |   ');
      page.drawText(`AGEING  ${clean(ageingText) || '-'}`, { x: MARGIN, y: ageingY, size: 7.5, font: fontBold, color: brand.muted });
      const tableY = ageingY - 18;
      drawTableHeader(page, tableY);
      return { page, y: tableY - 32 };
    };

    let { page, y } = await addPage();
    const transactions = input.transactions || [];
    if (!transactions.length) {
      page.drawText('No customer transactions were recorded in this statement period.', { x: MARGIN + 8, y, size: 9, font, color: brand.muted });
      y -= 22;
    }
    for (const row of transactions) {
      const reference = row.reference || row.remarks || '-';
      const referenceLines = wrap(reference, 195, 7.5, 2);
      const rowHeight = Math.max(21, referenceLines.length * 10 + 5);
      if (y - rowHeight < 48) ({ page, y } = await addPage());
      page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: PAGE_W - MARGIN, y: y - 5 }, thickness: 0.5, color: brand.border });
      let x = MARGIN;
      const values: Record<string, string> = {
        date: shortDate(row.date),
        source: clean(row.source || '-'),
        document_type: clean(row.document_type || '-'),
        document_number: clean(row.document_number || '-'),
      };
      for (const column of columns.slice(0, 4)) {
        page.drawText(values[column.key], { x: x + 4, y, size: 7.5, font, color: brand.text });
        x += column.width;
      }
      referenceLines.forEach((line, index) => page.drawText(line, { x: x + 4, y: y - index * 10, size: 7.5, font, color: brand.text }));
      x += columns[4].width;
      drawRight(page, Number(row.debit || 0) ? money(row.debit) : '-', x + columns[5].width - 4, y, 7.5);
      x += columns[5].width;
      drawRight(page, Number(row.credit || 0) ? money(row.credit) : '-', x + columns[6].width - 4, y, 7.5);
      x += columns[6].width;
      drawRight(page, money(row.balance), x + columns[7].width - 4, y, 7.5, true);
      y -= rowHeight;
    }

    const allPages = pdfDoc.getPages();
    allPages.forEach((currentPage, index) => {
      currentPage.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_W - MARGIN, y: 34 }, thickness: 0.5, color: brand.border });
      currentPage.drawText(`System-generated customer ledger | Page ${index + 1} of ${allPages.length}`, { x: MARGIN, y: 20, size: 7.5, font, color: brand.muted });
      const footer = clean(branding.footerText || branding.companyName || '');
      if (footer) drawRight(currentPage, footer, PAGE_W - MARGIN, 20, 7.5);
    });
    return Buffer.from(await pdfDoc.save());
  }
}
