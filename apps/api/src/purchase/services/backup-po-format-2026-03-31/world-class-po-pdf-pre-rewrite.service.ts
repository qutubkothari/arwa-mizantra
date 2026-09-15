import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, PDFImage } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface POItem {
  sl_no?: number;
  item_code: string;
  item_name: string;
  description?: string;
  hsn_code?: string;
  quantity: number;
  uom: string;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  taxable_amount: number;
  cgst_rate?: number;
  cgst_amount?: number;
  sgst_rate?: number;
  sgst_amount?: number;
  igst_rate?: number;
  igst_amount?: number;
  total_price: number;
  specifications?: string;
  delivery_date?: string;
  payment_terms?: string;
  delivery_terms?: string;
}

interface POTerms {
  payment_terms?: string;
  delivery_terms?: string;
  freight_terms?: string;
  insurance_terms?: string;
  validity_days?: number;
  warranty_terms?: string;
  inspection_terms?: string;
  packaging_terms?: string;
}

interface POPdfData {
  poNumber: string;
  poDate: string;
  revision?: number;
  quotationRef?: string;
  prNumber?: string;
  vendorName: string;
  vendorCode?: string;
  vendorAddress?: string;
  vendorCity?: string;
  vendorState?: string;
  vendorPincode?: string;
  vendorCountry?: string;
  vendorGSTIN?: string;
  vendorPAN?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  vendorContactPerson?: string;
  companyName: string;
  companyAddress: string;
  companyCity?: string;
  companyState?: string;
  companyPincode?: string;
  companyGSTIN?: string;
  companyPAN?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryPincode?: string;
  deliveryContactPerson?: string;
  deliveryPhone?: string;
  items: POItem[];
  subtotal: number;
  totalDiscount?: number;
  taxableAmount: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  tcsAmount?: number;
  roundOff?: number;
  grandTotal: number;
  paymentTerms?: string;
  deliveryDate?: string;
  terms?: POTerms;
  specialInstructions?: string;
  remarks?: string;
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
  currency?: string;
  incoterms?: string;
  projectName?: string;
}

type PageState = {
  page: PDFPage;
  pageNumber: number;
  y: number;
};

@Injectable()
export class WorldClassPoPdfService {
  private readonly pageWidth = 595;
  private readonly pageHeight = 842;
  private readonly marginX = 26;
  private readonly topMargin = 26;
  private readonly bottomMargin = 26;
  private readonly brandBlue = rgb(0.184, 0.329, 0.588);
  private readonly brandBlueDark = rgb(0.12, 0.24, 0.44);
  private readonly brandBlueLight = rgb(0.91, 0.95, 0.99);
  private readonly gray = rgb(0.35, 0.35, 0.35);
  private readonly lightGray = rgb(0.86, 0.88, 0.9);
  private readonly border = rgb(0.72, 0.76, 0.82);
  private readonly white = rgb(1, 1, 1);

  async generatePOPdf(data: POPdfData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`PO ${data.poNumber}`);
    pdfDoc.setSubject(`Purchase Order ${data.poNumber}`);
    pdfDoc.setCreator('SAK Solutions - Manufacturing ERP');
    pdfDoc.setProducer('SAK Solutions - Manufacturing ERP');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const logos = await this.loadLogos(pdfDoc);
    const pages: PDFPage[] = [];
    let state = this.addPage(pdfDoc, pages);

    state = await this.drawHeader(pdfDoc, state, data, font, fontBold, logos, pages);
    state = this.drawAddressBlocks(state, data, font, fontBold);
    state = this.drawIntroBlock(state, data, font, fontBold);
    state = await this.drawItemsTable(pdfDoc, pages, state, data, font, fontBold, logos);
    state = await this.drawSummaryAndTerms(pdfDoc, pages, state, data, font, fontBold, fontItalic, logos);
    this.drawPageFooters(pages, font);

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  generateFilename(poNumber: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `PO_${poNumber}_${timestamp}.pdf`;
  }

  private addPage(pdfDoc: PDFDocument, pages: PDFPage[]): PageState {
    const page = pdfDoc.addPage([this.pageWidth, this.pageHeight]);
    pages.push(page);
    return {
      page,
      pageNumber: pages.length,
      y: this.pageHeight - this.topMargin,
    };
  }

  private async loadLogos(pdfDoc: PDFDocument): Promise<{ script?: PDFImage; mark?: PDFImage }> {
    const assetsDir = path.join(process.cwd(), 'assets');
    const scriptPath = path.join(assetsDir, 'po-logo-script.jpg');
    const markPath = path.join(assetsDir, 'po-logo-mark.jpg');
    const logos: { script?: PDFImage; mark?: PDFImage } = {};

    if (fs.existsSync(scriptPath)) {
      logos.script = await pdfDoc.embedJpg(fs.readFileSync(scriptPath));
    }

    if (fs.existsSync(markPath)) {
      logos.mark = await pdfDoc.embedJpg(fs.readFileSync(markPath));
    }

    return logos;
  }

  private async drawHeader(
    pdfDoc: PDFDocument,
    state: PageState,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    logos: { script?: PDFImage; mark?: PDFImage },
    pages: PDFPage[],
  ): Promise<PageState> {
    const { page } = state;
    const usableWidth = this.pageWidth - this.marginX * 2;
    const logoAreaWidth = 126;
    const headerHeight = 78;
    const titleBarHeight = 24;
    const companyTextX = this.marginX + logoAreaWidth + 14;
    const companyTextWidth = usableWidth - logoAreaWidth - 26;
    const companyLines = [
      (data.companyName || 'SAK SOLUTIONS').trim(),
      [data.companyAddress, [data.companyCity, data.companyState].filter(Boolean).join(', '), data.companyPincode].filter(Boolean).join(', '),
      data.companyGSTIN ? `GSTIN: ${data.companyGSTIN}` : '',
      [data.companyEmail ? `Email: ${data.companyEmail}` : '', data.companyPhone ? `Phone: ${data.companyPhone}` : ''].filter(Boolean).join('    '),
    ].filter(Boolean);
    const wrappedCompanyLines = companyLines.flatMap((line, index) => this.wrapText(line, companyTextWidth, index === 0 ? 11 : 8.5, index === 0 ? fontBold : font));

    page.drawRectangle({
      x: this.marginX,
      y: state.y - headerHeight,
      width: usableWidth,
      height: headerHeight,
      color: this.white,
      borderColor: this.border,
      borderWidth: 1,
    });

    if (logos.script) {
      page.drawImage(logos.script, {
        x: this.marginX + 6,
        y: state.y - 56,
        width: 118,
        height: 43,
      });
    }

    if (logos.mark) {
      page.drawImage(logos.mark, {
        x: this.marginX + 102,
        y: state.y - 68,
        width: 18,
        height: 28,
      });
    }

    let companyY = state.y - 18;
    wrappedCompanyLines.slice(0, 5).forEach((line, index) => {
      const isTitleLine = index === 0;
      page.drawText(line, {
        x: companyTextX,
        y: companyY,
        size: isTitleLine ? 11 : 8.5,
        font: isTitleLine ? fontBold : font,
        color: this.gray,
      });
      companyY -= isTitleLine ? 15 : 11;
    });

    page.drawRectangle({
      x: this.marginX,
      y: state.y - (headerHeight + titleBarHeight + 8),
      width: usableWidth,
      height: titleBarHeight,
      color: this.brandBlue,
    });

    page.drawText('PURCHASE ORDER', {
      x: this.marginX + 12,
      y: state.y - (headerHeight + 17),
      size: 15,
      font: fontBold,
      color: this.white,
    });

    const poCaption = this.fitTextToWidth(
      `Purchase Order : ${data.poNumber}${data.revision ? ` (Rev ${data.revision})` : ''}`,
      usableWidth - 180,
      fontBold,
      10,
    );
    const captionWidth = fontBold.widthOfTextAtSize(poCaption, 10);
    page.drawText(poCaption, {
      x: this.pageWidth - this.marginX - captionWidth - 12,
      y: state.y - (headerHeight + 15),
      size: 10,
      font: fontBold,
      color: this.white,
    });

    return {
      ...state,
      y: state.y - (headerHeight + titleBarHeight + 12),
    };
  }

  private drawAddressBlocks(state: PageState, data: POPdfData, font: PDFFont, fontBold: PDFFont): PageState {
    const { page } = state;
    const leftX = this.marginX;
    const rightX = this.pageWidth / 2 + 4;
    const blockWidth = this.pageWidth / 2 - this.marginX - 8;

    const vendorLines = [
      data.vendorName,
      data.vendorAddress || '',
      [data.vendorCity, data.vendorState, data.vendorPincode].filter(Boolean).join(', '),
      data.vendorGSTIN ? `GST No. : ${data.vendorGSTIN}` : '',
      data.vendorEmail ? `Email : ${data.vendorEmail}` : '',
      data.vendorPhone ? `Phone No. : ${data.vendorPhone}` : '',
    ].filter(Boolean);

    const referenceLines = [
      `Dated : ${this.formatDate(data.poDate)}`,
      data.prNumber ? `PR No. : ${data.prNumber}` : '',
      data.quotationRef ? `Quotation Ref : ${data.quotationRef}` : '',
      data.projectName ? `Project : ${data.projectName}` : '',
      data.deliveryDate ? `Delivery Date : ${this.formatDate(data.deliveryDate)}` : '',
      data.preparedBy ? `Prepared By : ${data.preparedBy}` : '',
      data.approvedBy ? `Approved By : ${data.approvedBy}` : '',
    ].filter(Boolean);
    const vendorLineCount = this.countWrappedLines(vendorLines, blockWidth - 16, 9, font);
    const referenceLineCount = this.countWrappedLines(referenceLines, blockWidth - 16, 9, font);
    const blockHeight = Math.max(112, 30 + Math.max(vendorLineCount, referenceLineCount) * 11 + 12);

    this.drawLabeledBlock(page, leftX, state.y - blockHeight, blockWidth, blockHeight, 'TO', fontBold);
    this.drawLabeledBlock(page, rightX, state.y - blockHeight, blockWidth, blockHeight, 'REFERENCE', fontBold);
    this.drawWrappedLines(page, vendorLines, leftX + 8, state.y - 28, blockWidth - 16, 9, font, 11);
    this.drawWrappedLines(page, referenceLines, rightX + 8, state.y - 28, blockWidth - 16, 9, font, 11);

    return {
      ...state,
      y: state.y - blockHeight - 12,
    };
  }

  private drawIntroBlock(state: PageState, data: POPdfData, font: PDFFont, fontBold: PDFFont): PageState {
    const { page } = state;
    const deliveryLabelX = this.marginX + 278;
    const deliveryContentX = deliveryLabelX;
    const deliveryContentWidth = this.pageWidth - deliveryContentX - this.marginX - 8;
    const leftLines = [
      data.quotationRef ? `Quotation Ref : ${data.quotationRef}` : '',
      data.vendorContactPerson ? `Contact Person : ${data.vendorContactPerson}` : '',
    ].filter(Boolean);

    const deliveryLine = [
      data.deliveryAddress || data.companyAddress,
      [data.deliveryCity || data.companyCity, data.deliveryState || data.companyState, data.deliveryPincode || data.companyPincode].filter(Boolean).join(', '),
    ].filter(Boolean).join(', ');
    const leftLineCount = this.countWrappedLines(leftLines, 245, 8.5, font);
    const deliveryLineCount = this.wrapText(deliveryLine || 'Same as above', deliveryContentWidth, 8.5, font).length;
    const introHeight = Math.max(72, 28 + Math.max(leftLineCount * 10, 12 + deliveryLineCount * 10) + 10);

    page.drawRectangle({
      x: this.marginX,
      y: state.y - introHeight,
      width: this.pageWidth - this.marginX * 2,
      height: introHeight,
      borderColor: this.border,
      borderWidth: 1,
    });

    this.drawWrappedLines(page, leftLines, this.marginX + 8, state.y - 16, 245, 8.5, font, 10);

    page.drawText('Delivery Address :', {
      x: deliveryLabelX,
      y: state.y - 16,
      size: 8.5,
      font: fontBold,
      color: this.gray,
    });
    this.drawWrappedText(page, deliveryLine || 'Same as above', deliveryContentX, state.y - 27, deliveryContentWidth, 8.5, font, 10);

    return {
      ...state,
      y: state.y - introHeight - 10,
    };
  }

  private async drawItemsTable(
    pdfDoc: PDFDocument,
    pages: PDFPage[],
    state: PageState,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    logos: { script?: PDFImage; mark?: PDFImage },
  ): Promise<PageState> {
    const columns = [
      { key: 'sl', title: 'Sl. No.', width: 34, align: 'center' as const },
      { key: 'code', title: 'Item Code', width: 78, align: 'left' as const },
      { key: 'description', title: 'Description', width: 142, align: 'left' as const },
      { key: 'hsn', title: 'HSN', width: 45, align: 'center' as const },
      { key: 'qty', title: 'Qty', width: 34, align: 'right' as const },
      { key: 'uom', title: 'UOM', width: 40, align: 'center' as const },
      { key: 'rate', title: 'Rate', width: 48, align: 'right' as const },
      { key: 'discount', title: 'Discount %', width: 55, align: 'right' as const },
      { key: 'gst', title: 'GST %', width: 45, align: 'right' as const },
      { key: 'amount', title: 'Amount', width: 72, align: 'right' as const },
    ];
    const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);

    state = await this.ensureSpace(pdfDoc, pages, state, 34, data, font, fontBold, logos);
    state = this.drawTableHeader(state, columns, tableWidth, fontBold);

    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index];
      const description = this.composeDescription(item);
      const descriptionLines = this.wrapText(description, columns[2].width - 6, 7.5, font);
      const rowHeight = Math.max(20, descriptionLines.length * 9 + 4);

      state = await this.ensureSpace(pdfDoc, pages, state, rowHeight + 2, data, font, fontBold, logos, columns, tableWidth);

      const rowY = state.y;
      state.page.drawRectangle({
        x: this.marginX,
        y: rowY - rowHeight,
        width: tableWidth,
        height: rowHeight,
        borderColor: this.border,
        borderWidth: 0.6,
      });

      let x = this.marginX;
      for (const col of columns) {
        state.page.drawLine({
          start: { x, y: rowY },
          end: { x, y: rowY - rowHeight },
          thickness: 0.6,
          color: this.border,
        });
        x += col.width;
      }
      state.page.drawLine({
        start: { x, y: rowY },
        end: { x, y: rowY - rowHeight },
        thickness: 0.6,
        color: this.border,
      });

      const values = {
        sl: String(item.sl_no || index + 1),
        code: item.item_code || '',
        description,
        hsn: item.hsn_code || '',
        qty: this.formatNumber(item.quantity),
        uom: item.uom || '',
        rate: this.formatCurrency(item.unit_price, false),
        discount: this.formatNumber(item.discount_percent || 0),
        gst: this.formatNumber(this.resolveGstRate(item)),
        amount: this.formatCurrency(item.total_price, false),
      };

      let cellX = this.marginX;
      for (const col of columns) {
        const value = values[col.key as keyof typeof values] || '';
        if (col.key === 'description') {
          this.drawWrappedLines(state.page, descriptionLines, cellX + 3, rowY - 10, col.width - 6, 7.5, font, 9);
        } else {
          this.drawCellText(state.page, value, cellX, rowY - 13, col.width, col.align, font, col.key === 'sl' ? 7 : 8);
        }
        cellX += col.width;
      }

      state.y -= rowHeight;
    }

    state = await this.ensureSpace(pdfDoc, pages, state, 24, data, font, fontBold, logos);
    state.page.drawRectangle({
      x: this.marginX,
      y: state.y - 20,
      width: tableWidth,
      height: 20,
      borderColor: this.border,
      borderWidth: 0.8,
      color: this.brandBlueLight,
    });
    state.page.drawText('Total / Balance C/d', {
      x: this.marginX + 110,
      y: state.y - 13,
      size: 8.5,
      font: fontBold,
      color: this.brandBlueDark,
    });
    state.page.drawText(this.formatCurrency(data.grandTotal, false), {
      x: this.marginX + tableWidth - 58,
      y: state.y - 13,
      size: 8.5,
      font: fontBold,
      color: this.brandBlueDark,
    });

    return {
      ...state,
      y: state.y - 28,
    };
  }

  private async ensureSpace(
    pdfDoc: PDFDocument,
    pages: PDFPage[],
    state: PageState,
    neededHeight: number,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    logos: { script?: PDFImage; mark?: PDFImage },
    columns?: Array<{ title: string; width: number; align: 'left' | 'right' | 'center'; key: string }>,
    tableWidth?: number,
  ): Promise<PageState> {
    if (state.y - neededHeight >= this.bottomMargin + 34) {
      return state;
    }

    let nextState = this.addPage(pdfDoc, pages);
    nextState = await this.drawHeader(pdfDoc, nextState, data, font, fontBold, logos, pages);
    if (columns && tableWidth) {
      nextState = this.drawTableHeader(nextState, columns, tableWidth, fontBold);
    }
    return nextState;
  }

  private drawTableHeader(
    state: PageState,
    columns: Array<{ title: string; width: number; align: 'left' | 'right' | 'center'; key: string }>,
    tableWidth: number,
    fontBold: PDFFont,
  ): PageState {
    state.page.drawRectangle({
      x: this.marginX,
      y: state.y - 18,
      width: tableWidth,
      height: 18,
      color: this.brandBlue,
    });

    let x = this.marginX;
    for (const col of columns) {
      state.page.drawLine({
        start: { x, y: state.y },
        end: { x, y: state.y - 18 },
        thickness: 0.8,
        color: this.white,
      });
      this.drawCellText(state.page, col.title, x, state.y - 12, col.width, 'center', fontBold, 7.5, this.white);
      x += col.width;
    }
    state.page.drawLine({
      start: { x, y: state.y },
      end: { x, y: state.y - 18 },
      thickness: 0.8,
      color: this.white,
    });

    return {
      ...state,
      y: state.y - 18,
    };
  }

  private async drawSummaryAndTerms(
    pdfDoc: PDFDocument,
    pages: PDFPage[],
    state: PageState,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    fontItalic: PDFFont,
    logos: { script?: PDFImage; mark?: PDFImage },
  ): Promise<PageState> {
    const specialRemarkText = data.specialInstructions || data.remarks || 'As per approved quotation, drawings, and technical specifications.';
    const specialRemarkLineCount = this.wrapText(specialRemarkText, 322, 8, font).length;
    const summaryLines = [
      ['Subtotal', data.subtotal],
      ['Discount', data.totalDiscount || 0],
      ['Taxable', data.taxableAmount],
      ['CGST', data.cgstTotal || 0],
      ['SGST', data.sgstTotal || 0],
      ['IGST', data.igstTotal || 0],
      ['Round Off', data.roundOff || 0],
      ['Grand Total', data.grandTotal],
    ];
    const remarksBoxHeight = Math.max(76, 28 + specialRemarkLineCount * 10 + 10);
    const summaryBoxHeight = Math.max(76, 18 + summaryLines.length * 8 + 8);
    const topBoxHeight = Math.max(remarksBoxHeight, summaryBoxHeight);

    state = await this.ensureSpace(pdfDoc, pages, state, topBoxHeight + 144, data, font, fontBold, logos);

    const leftWidth = 338;
    const rightWidth = 177;
    const boxTop = state.y;

    state.page.drawRectangle({
      x: this.marginX,
      y: boxTop - topBoxHeight,
      width: leftWidth,
      height: topBoxHeight,
      borderColor: this.border,
      borderWidth: 1,
    });
    state.page.drawText('Special Remark :', {
      x: this.marginX + 8,
      y: boxTop - 14,
      size: 9,
      font: fontBold,
      color: this.gray,
    });
    this.drawWrappedText(
      state.page,
      specialRemarkText,
      this.marginX + 8,
      boxTop - 28,
      leftWidth - 16,
      8,
      font,
      10,
    );

    state.page.drawRectangle({
      x: this.marginX + leftWidth + 8,
      y: boxTop - topBoxHeight,
      width: rightWidth,
      height: topBoxHeight,
      borderColor: this.border,
      borderWidth: 1,
    });

    let summaryY = boxTop - 14;
    for (const [label, value] of summaryLines) {
      const isGrand = label === 'Grand Total';
      state.page.drawText(`${label}`, {
        x: this.marginX + leftWidth + 16,
        y: summaryY,
        size: isGrand ? 8.8 : 8,
        font: isGrand ? fontBold : font,
        color: isGrand ? this.brandBlueDark : this.gray,
      });
      const amountText = this.formatCurrency(value as number, false);
      const amountWidth = (isGrand ? fontBold : font).widthOfTextAtSize(amountText, isGrand ? 8.8 : 8);
      state.page.drawText(amountText, {
        x: this.marginX + leftWidth + rightWidth - amountWidth,
        y: summaryY,
        size: isGrand ? 8.8 : 8,
        font: isGrand ? fontBold : font,
        color: isGrand ? this.brandBlueDark : this.gray,
      });
      summaryY -= 8;
    }

    state.y = boxTop - topBoxHeight - 12;

    const statutoryTitleY = state.y;
    state.page.drawText('Statutory Details', {
      x: this.marginX,
      y: statutoryTitleY,
      size: 9.5,
      font: fontBold,
      color: this.brandBlueDark,
    });
    const statutoryLines = [
      `GST No : ${data.companyGSTIN || '-'}`,
      `State Name : ${data.companyState || 'Andhra Pradesh'}, 37`,
      `Freight : ${data.terms?.freight_terms || '-'}`,
    ];
    this.drawWrappedLines(state.page, statutoryLines, this.marginX, statutoryTitleY - 12, 220, 8, font, 10);

    state.page.drawText('Terms & Conditions', {
      x: this.marginX + 240,
      y: statutoryTitleY,
      size: 9.5,
      font: fontBold,
      color: this.brandBlueDark,
    });
    const shortTerms = [
      `Payment : ${data.paymentTerms || data.terms?.payment_terms || '-'}`,
      `Delivery : ${data.terms?.delivery_terms || data.deliveryDate || '-'}`,
      `Freight : ${data.terms?.freight_terms || '-'}`,
    ];
    this.drawWrappedLines(state.page, shortTerms, this.marginX + 240, statutoryTitleY - 12, 270, 8, font, 10);

    state.y = statutoryTitleY - 50;
    const legalHeading = `For ${data.companyName}`;
    state.page.drawText(legalHeading, {
      x: this.marginX,
      y: state.y,
      size: 10,
      font: fontBold,
      color: this.brandBlueDark,
    });
    state.y -= 14;
    state.page.drawText('General Terms and Conditions', {
      x: this.marginX,
      y: state.y,
      size: 9.5,
      font: fontBold,
      color: this.gray,
    });
    state.y -= 14;

    const legalLines = this.getGeneralTerms(data.companyName || 'SAK Solutions');
    for (const paragraph of legalLines) {
      const wrapped = this.wrapText(paragraph, this.pageWidth - this.marginX * 2, 7.7, font);
      const needed = wrapped.length * 9 + 8;
      state = await this.ensureSpace(pdfDoc, pages, state, needed + 40, data, font, fontBold, logos);
      this.drawWrappedLines(state.page, wrapped, this.marginX, state.y, this.pageWidth - this.marginX * 2, 7.7, font, 9);
      state.y -= wrapped.length * 9 + 6;
    }

    state = await this.ensureSpace(pdfDoc, pages, state, 70, data, font, fontBold, logos);
    const signTop = state.y;
    const signWidth = 168;
    const gap = 12;
    const signLabels = [
      ['Prepared By', data.preparedBy || '-'],
      ['Reviewed By', data.reviewedBy || '-'],
      ['Approved By', data.approvedBy || '-'],
    ];
    signLabels.forEach(([label, value], index) => {
      const x = this.marginX + index * (signWidth + gap);
      state.page.drawRectangle({
        x,
        y: signTop - 52,
        width: signWidth,
        height: 52,
        borderColor: this.border,
        borderWidth: 1,
      });
      state.page.drawText(String(label), {
        x: x + 8,
        y: signTop - 14,
        size: 8.5,
        font: fontBold,
        color: this.gray,
      });
      state.page.drawText(String(value), {
        x: x + 8,
        y: signTop - 40,
        size: 8,
        font: fontItalic,
        color: this.gray,
      });
    });

    return {
      ...state,
      y: signTop - 62,
    };
  }

  private drawPageFooters(pages: PDFPage[], font: PDFFont) {
    pages.forEach((page, index) => {
      const footer = `Page ${index + 1} of ${pages.length}  |  This is a computer-generated Purchase Order.`;
      const width = font.widthOfTextAtSize(footer, 7);
      page.drawLine({
        start: { x: this.marginX, y: this.bottomMargin + 10 },
        end: { x: this.pageWidth - this.marginX, y: this.bottomMargin + 10 },
        thickness: 0.7,
        color: this.border,
      });
      page.drawText(footer, {
        x: this.pageWidth - this.marginX - width,
        y: this.bottomMargin,
        size: 7,
        font,
        color: this.gray,
      });
    });
  }

  private drawLabeledBlock(page: PDFPage, x: number, y: number, width: number, height: number, label: string, fontBold: PDFFont) {
    page.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor: this.border,
      borderWidth: 1,
    });
    page.drawRectangle({
      x,
      y: y + height - 18,
      width,
      height: 18,
      color: this.brandBlueLight,
    });
    page.drawText(label, {
      x: x + 8,
      y: y + height - 13,
      size: 9,
      font: fontBold,
      color: this.brandBlueDark,
    });
  }

  private drawWrappedLines(
    page: PDFPage,
    lines: string[],
    x: number,
    y: number,
    width: number,
    fontSize: number,
    font: PDFFont,
    lineHeight: number,
  ) {
    let currentY = y;
    for (const line of lines) {
      const wrapped = this.wrapText(line, width, fontSize, font);
      for (const part of wrapped) {
        page.drawText(part, {
          x,
          y: currentY,
          size: fontSize,
          font,
          color: this.gray,
        });
        currentY -= lineHeight;
      }
    }
  }

  private drawWrappedText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    font: PDFFont,
    lineHeight: number,
  ) {
    this.drawWrappedLines(page, this.wrapText(text, width, fontSize, font), x, y, width, fontSize, font, lineHeight);
  }

  private countWrappedLines(lines: string[], width: number, fontSize: number, font: PDFFont): number {
    return lines.reduce((total, line) => total + this.wrapText(line, width, fontSize, font).length, 0);
  }

  private drawCellText(
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    width: number,
    align: 'left' | 'right' | 'center',
    font: PDFFont,
    fontSize: number,
    color = this.gray,
  ) {
    const safeText = this.fitTextToWidth(String(text || ''), Math.max(width - 6, 0), font, fontSize);
    const textWidth = font.widthOfTextAtSize(safeText, fontSize);
    const drawX = align === 'right'
      ? x + width - textWidth - 3
      : align === 'center'
        ? x + (width - textWidth) / 2
        : x + 3;
    page.drawText(safeText, {
      x: drawX,
      y,
      size: fontSize,
      font,
      color,
    });
  }

  private wrapText(text: string, width: number, fontSize: number, font: PDFFont): string[] {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return [''];
    }

    const words = normalized.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= width) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }

      if (font.widthOfTextAtSize(word, fontSize) <= width) {
        current = word;
        continue;
      }

      let segment = '';
      for (const char of word.split('')) {
        const next = `${segment}${char}`;
        if (font.widthOfTextAtSize(next, fontSize) <= width) {
          segment = next;
        } else {
          if (segment) {
            lines.push(segment);
          }
          segment = char;
        }
      }
      current = segment;
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  private composeDescription(item: POItem): string {
    const parts = [item.item_name, item.description, item.specifications]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    return parts.filter((part, index) => {
      const normalized = part.toLowerCase();
      return parts.findIndex((candidate) => candidate.toLowerCase() === normalized) === index;
    }).join(' | ');
  }

  private fitTextToWidth(text: string, width: number, font: PDFFont, fontSize: number): string {
    const safeText = String(text || '').trim();
    if (!safeText || width <= 0) {
      return '';
    }

    if (font.widthOfTextAtSize(safeText, fontSize) <= width) {
      return safeText;
    }

    const ellipsis = '...';
    const ellipsisWidth = font.widthOfTextAtSize(ellipsis, fontSize);
    if (ellipsisWidth >= width) {
      return '';
    }

    let truncated = '';
    for (const char of safeText) {
      const next = `${truncated}${char}`;
      if (font.widthOfTextAtSize(next, fontSize) + ellipsisWidth > width) {
        break;
      }
      truncated = next;
    }

    return truncated ? `${truncated}${ellipsis}` : '';
  }

  private resolveGstRate(item: POItem): number {
    return Number(item.igst_rate || 0) || Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0);
  }

  private formatDate(value?: string): string {
    if (!value) {
      return '-';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatNumber(value: number): string {
    const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
    return normalized % 1 === 0 ? String(normalized) : normalized.toFixed(2);
  }

  private formatCurrency(value: number, withSymbol = true): string {
    const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `${withSymbol ? 'INR ' : ''}${normalized.toFixed(2)}`;
  }

  private getGeneralTerms(companyName: string): string[] {
    return [
      'Acceptance of Order: The supplier must confirm acceptance of this Purchase Order (PO) via email within 7 days of issuance. Failure to respond within this period shall be deemed as unconditional acceptance of all terms and conditions stated herein.',
      `Confidentiality & Ownership: All drawings, designs, and documents shared with this PO are the exclusive and confidential property of ${companyName}. Any unauthorized use, reproduction, or disclosure to third parties will constitute a breach of contract and may result in legal action.`,
      'Scope, Specifications & Compliance: Materials must strictly conform to the specifications, drawings, quality standards, and requirements mentioned in the PO. Any deviation must be approved in writing by the buyer prior to execution.',
      'Inspection & Rejection: The buyer reserves the right to inspect the materials upon receipt. Any material not meeting specifications or quality standards may be rejected, and the supplier shall be responsible for replacement or removal at their own cost.',
      'Delivery Schedule & Liquidated Damages: Delivery must be completed as per the agreed schedule. In case of delay, liquidated damages will be charged at 0.5% per day, subject to a maximum of 10% of the total order value.',
      'Invoicing Requirements: All invoices must clearly mention the PO number, product name, and serial number exactly as per the PO. Non-compliance may result in delays in GRN processing and payment.',
      'Packaging & Transit Responsibility: The supplier shall ensure adequate packaging to prevent damage during transit. Any loss or damage in transit shall be borne by the supplier.',
      'Payment Terms: Payment shall be processed as per the terms specified in the PO, subject to successful delivery, inspection, acceptance of materials, and submission of compliant invoices.',
      'Taxes & Statutory Compliance: The supplier shall comply with all applicable laws, taxes, duties, and statutory requirements in force.',
      'Jurisdiction & Dispute Resolution: Any disputes arising out of this PO shall be subject to the jurisdiction of the buyer’s registered location.',
    ];
  }
}
