import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
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
  // PO Header
  poNumber: string;
  poDate: string;
  revision?: number;
  quotationRef?: string;
  prNumber?: string;
  
  // Vendor Details
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
  
  // Buyer/Company Details
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
  
  // Delivery Details
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryState?: string;
  deliveryPincode?: string;
  deliveryContactPerson?: string;
  deliveryPhone?: string;
  
  // Items
  items: POItem[];
  
  // Financial Summary
  subtotal: number;
  totalDiscount?: number;
  taxableAmount: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  tcsAmount?: number;
  roundOff?: number;
  grandTotal: number;
  
  // Terms & Conditions
  paymentTerms?: string;
  deliveryDate?: string;
  terms?: POTerms;
  specialInstructions?: string;
  remarks?: string;
  
  // Authorization
  preparedBy?: string;
  reviewedBy?: string;
  approvedBy?: string;
  
  // Additional
  currency?: string;
  incoterms?: string;
  projectName?: string;
}

@Injectable()
export class WorldClassPoPdfService {
  private readonly COLORS = {
    primary: rgb(0.0, 0.25, 0.50), // #004080 legacy navy-blue document colour
    secondary: rgb(0.0, 0.30, 0.55), // #004D8C
    accent: rgb(0.0, 0.40, 0.70), // #0066B3 (matches logo header banner)
    gray: rgb(0.4, 0.4, 0.4),
    lightGray: rgb(0.9, 0.9, 0.9),
    white: rgb(1, 1, 1),
    black: rgb(0, 0, 0),
    success: rgb(0.0, 0.25, 0.50), // Same as primary
    border: rgb(0.8, 0.8, 0.8),
  };

  async generatePOPdf(data: POPdfData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    
    // Try to incorporate letterhead if available
    const letterheadPath = path.join(process.cwd(), 'assets', 'letterhead.pdf');
    let page: PDFPage;
    
    try {
      if (fs.existsSync(letterheadPath)) {
        const letterheadBytes = fs.readFileSync(letterheadPath);
        const letterheadPdf = await PDFDocument.load(letterheadBytes);
        const [letterheadPage] = await pdfDoc.copyPages(letterheadPdf, [0]);
        page = pdfDoc.addPage(letterheadPage);
      } else {
        page = pdfDoc.addPage([595, 842]); // A4 size
      }
    } catch (error) {
      page = pdfDoc.addPage([595, 842]); // Fallback to blank A4
    }

    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let yPosition = height - 50;

    // If no letterhead, draw company header
    if (!fs.existsSync(letterheadPath)) {
      yPosition = await this.drawHeader(page, data, font, fontBold, yPosition, width);
    } else {
      yPosition = height - 115; // Start right below letterhead grey line
    }

    // Draw PO Title and Reference Info
    yPosition = this.drawPOTitle(page, data, font, fontBold, yPosition, width);

    // Draw Vendor and Delivery Information
    yPosition = this.drawVendorDeliveryInfo(page, data, font, fontBold, yPosition, width);

    // Draw Items Table
    const itemsResult = await this.drawItemsTable(page, pdfDoc, data, font, fontBold, yPosition, width, height);
    page = itemsResult.page; // Update page reference (items may have added new pages)
    yPosition = itemsResult.yPosition;

    // Draw Financial Summary and Terms — ensure enough space
    if (yPosition < 300) {
      page = pdfDoc.addPage([595, 842]);
      yPosition = height - 50;
    }
    
    // Draw Financial Summary on the right
    this.drawFinancialSummary(page, data, font, fontBold, yPosition - 10, width);
    
    // Draw Terms and Conditions on the left at the same vertical position
    yPosition = this.drawTermsAndConditions(page, data, font, fontBold, fontItalic, yPosition - 10, width);

    // Draw Signature Section
    if (yPosition < 200) {
      page = pdfDoc.addPage([595, 842]);
      yPosition = height - 50;
    }
    this.drawSignatureSection(page, data, font, fontBold, yPosition, width);

    // Draw Footer on pages (skip letterhead page which has its own footer)
    const pages = pdfDoc.getPages();
    const hasLetterhead = fs.existsSync(letterheadPath);
    pages.forEach((p, index) => {
      if (hasLetterhead && index === 0) return; // Skip footer on letterhead page
      this.drawFooter(p, font, data, index + 1, pages.length);
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  private async drawHeader(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
  ): Promise<number> {
    // Company Name with decorative underline
    page.drawText(data.companyName.toUpperCase(), {
      x: 50,
      y: yPosition,
      size: 22,
      font: fontBold,
      color: this.COLORS.primary,
    });

    yPosition -= 5;
    page.drawLine({
      start: { x: 50, y: yPosition },
      end: { x: 350, y: yPosition },
      thickness: 3,
      color: this.COLORS.accent,
    });

    // Company Details
    yPosition -= 20;
    const companyDetails = [
      data.companyAddress,
      `${data.companyCity || ''}, ${data.companyState || ''} - ${data.companyPincode || ''}`,
      data.companyGSTIN ? `GSTIN: ${data.companyGSTIN}` : null,
      data.companyPAN ? `PAN: ${data.companyPAN}` : null,
      data.companyEmail ? `Email: ${data.companyEmail}` : null,
      data.companyPhone ? `Phone: ${data.companyPhone}` : null,
      data.companyWebsite ? `Website: ${data.companyWebsite}` : null,
    ].filter(Boolean);

    companyDetails.forEach((detail) => {
      page.drawText(detail!, {
        x: 50,
        y: yPosition,
        size: 9,
        font,
        color: this.COLORS.gray,
      });
      yPosition -= 12;
    });

    return yPosition - 10;
  }

  private drawPOTitle(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
  ): number {
    // Decorative box for title
    page.drawRectangle({
      x: 40,
      y: yPosition - 35,
      width: width - 80,
      height: 40,
      color: this.COLORS.primary,
    });

    page.drawText('PURCHASE ORDER', {
      x: 50,
      y: yPosition - 15,
      size: 20,
      font: fontBold,
      color: this.COLORS.white,
    });

    // PO Number (right aligned in box)
    const poText = `PO No: ${data.poNumber}${data.revision ? ` (Rev ${data.revision})` : ''}`;
    page.drawText(poText, {
      x: width - 250,
      y: yPosition - 15,
      size: 12,
      font: fontBold,
      color: this.COLORS.white,
    });

    yPosition -= 50;

    // Reference Information
    const leftCol = 50;
    const rightCol = width / 2 + 20;

    page.drawText(`PO Date:`, {
      x: leftCol,
      y: yPosition,
      size: 10,
      font: fontBold,
    });
    page.drawText(new Date(data.poDate).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }), {
      x: leftCol + 80,
      y: yPosition,
      size: 10,
      font,
    });

    if (data.quotationRef) {
      page.drawText(`Quote Ref:`, {
        x: rightCol,
        y: yPosition,
        size: 10,
        font: fontBold,
      });
      page.drawText(data.quotationRef, {
        x: rightCol + 80,
        y: yPosition,
        size: 10,
        font,
      });
    }

    yPosition -= 15;

    if (data.prNumber) {
      page.drawText(`PR Number:`, {
        x: leftCol,
        y: yPosition,
        size: 10,
        font: fontBold,
      });
      page.drawText(data.prNumber, {
        x: leftCol + 80,
        y: yPosition,
        size: 10,
        font,
      });
    }

    if (data.deliveryDate) {
      page.drawText(`Delivery:`, {
        x: rightCol,
        y: yPosition,
        size: 10,
        font: fontBold,
      });
      page.drawText(new Date(data.deliveryDate).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }), {
        x: rightCol + 80,
        y: yPosition,
        size: 10,
        font,
      });
    }

    return yPosition - 25;
  }

  private drawVendorDeliveryInfo(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
  ): number {
    const boxHeight = 110;
    const leftBox = 50;
    const rightBox = width / 2 + 10;
    const boxWidth = (width / 2) - 60;

    // Vendor Details Box
    page.drawRectangle({
      x: leftBox,
      y: yPosition - boxHeight,
      width: boxWidth,
      height: boxHeight,
      borderColor: this.COLORS.border,
      borderWidth: 1.5,
    });

    // Header
    page.drawRectangle({
      x: leftBox,
      y: yPosition - 20,
      width: boxWidth,
      height: 20,
      color: this.COLORS.lightGray,
    });

    page.drawText('VENDOR DETAILS', {
      x: leftBox + 5,
      y: yPosition - 15,
      size: 10,
      font: fontBold,
      color: this.COLORS.primary,
    });

    let vendorY = yPosition - 35;
    const vendorDetails = [
      { label: '', value: data.vendorName, bold: true },
      { label: '', value: data.vendorCode ? `Code: ${data.vendorCode}` : null },
      { label: '', value: data.vendorAddress },
      { label: '', value: `${data.vendorCity || ''}, ${data.vendorState || ''} - ${data.vendorPincode || ''}` },
      { label: 'GSTIN:', value: data.vendorGSTIN },
      { label: 'Contact:', value: data.vendorContactPerson },
      { label: 'Email:', value: data.vendorEmail },
      { label: 'Phone:', value: data.vendorPhone },
    ].filter(d => d.value);

    vendorDetails.forEach((detail) => {
      const text = detail.label ? `${detail.label} ${detail.value}` : detail.value;
      const truncatedText = this.truncate(text!, 45); // Constrain to vendor box width
      page.drawText(truncatedText, {
        x: leftBox + 5,
        y: vendorY,
        size: detail.bold ? 10 : 9,
        font: detail.bold ? fontBold : font,
      });
      vendorY -= 11;
    });

    // Delivery Address Box
    page.drawRectangle({
      x: rightBox,
      y: yPosition - boxHeight,
      width: boxWidth,
      height: boxHeight,
      borderColor: this.COLORS.border,
      borderWidth: 1.5,
    });

    page.drawRectangle({
      x: rightBox,
      y: yPosition - 20,
      width: boxWidth,
      height: 20,
      color: this.COLORS.lightGray,
    });

    page.drawText('DELIVERY ADDRESS', {
      x: rightBox + 5,
      y: yPosition - 15,
      size: 10,
      font: fontBold,
      color: this.COLORS.primary,
    });

    let deliveryY = yPosition - 35;
    const deliveryDetails = [
      { text: data.companyName, bold: true },
      { text: data.deliveryAddress || data.companyAddress, bold: false },
      { text: `${data.deliveryCity || data.companyCity || ''}, ${data.deliveryState || data.companyState || ''} - ${data.deliveryPincode || data.companyPincode || ''}`, bold: false },
      data.companyGSTIN ? { text: `GSTIN: ${data.companyGSTIN}`, bold: false } : null,
      data.deliveryContactPerson ? { text: `Contact: ${data.deliveryContactPerson}`, bold: false } : null,
      data.deliveryPhone ? { text: `Phone: ${data.deliveryPhone}`, bold: false } : null,
    ].filter(Boolean);

    deliveryDetails.forEach((detail) => {
      const wrappedLines = this.wrapText(detail!.text, 45);
      wrappedLines.forEach((line) => {
        page.drawText(line, {
          x: rightBox + 5,
          y: deliveryY,
          size: detail!.bold ? 10 : 9,
          font: detail!.bold ? fontBold : font,
        });
        deliveryY -= 11;
      });
    });

    return yPosition - boxHeight - 20;
  }

  private async drawItemsTable(
    page: PDFPage,
    pdfDoc: PDFDocument,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
    height: number,
  ): Promise<{ page: PDFPage; yPosition: number }> {
    const margin = 40;
    const tableWidth = width - (margin * 2);
    
    // Column definitions for GST-compliant PO
    const cols = {
      sno: { x: margin, width: 25, label: 'S.No' },
      code: { x: margin + 25, width: 60, label: 'Item Code' },
      desc: { x: margin + 85, width: 135, label: 'Description' },
      hsn: { x: margin + 220, width: 50, label: 'HSN' },
      qty: { x: margin + 270, width: 35, label: 'Qty' },
      uom: { x: margin + 305, width: 35, label: 'UOM' },
      rate: { x: margin + 340, width: 50, label: 'Rate' },
      disc: { x: margin + 390, width: 40, label: 'Disc%' },
      tax: { x: margin + 430, width: 40, label: 'Tax%' },
      amount: { x: margin + 470, width: 85, label: 'Amount' },
    };

    // Table Header
    page.drawRectangle({
      x: margin,
      y: yPosition - 18,
      width: tableWidth,
      height: 18,
      color: this.COLORS.primary,
    });

    Object.values(cols).forEach((col) => {
      page.drawText(col.label, {
        x: col.x + 2,
        y: yPosition - 13,
        size: 8,
        font: fontBold,
        color: this.COLORS.white,
      });
    });

    yPosition -= 23;

    // Table Rows
    let currentPage = page;
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];

      // Check if we need a new page (120 leaves room for letterhead footer)
      if (yPosition < 120) {
        currentPage = pdfDoc.addPage([595, 842]);
        yPosition = height - 50;
        
        // Redraw header on new page
        currentPage.drawRectangle({
          x: margin,
          y: yPosition - 18,
          width: tableWidth,
          height: 18,
          color: this.COLORS.primary,
        });

        Object.values(cols).forEach((col) => {
          currentPage.drawText(col.label, {
            x: col.x + 2,
            y: yPosition - 13,
            size: 8,
            font: fontBold,
            color: this.COLORS.white,
          });
        });

        yPosition -= 23;
      }

      // Alternate row colors
      if (i % 2 === 0) {
        currentPage.drawRectangle({
          x: margin,
          y: yPosition - 12,
          width: tableWidth,
          height: 14,
          color: rgb(0.97, 0.97, 0.97),
        });
      }

      const taxRate = item.cgst_rate && item.sgst_rate 
        ? (item.cgst_rate + item.sgst_rate)
        : (item.igst_rate || 0);

      // Draw row data
      currentPage.drawText(String(item.sl_no || i + 1), {
        x: cols.sno.x + 2,
        y: yPosition - 8,
        size: 8,
        font,
      });

      currentPage.drawText(this.truncate(item.item_code, 10), {
        x: cols.code.x + 2,
        y: yPosition - 8,
        size: 7,
        font,
      });

      currentPage.drawText(this.truncate(item.item_name, 22), {
        x: cols.desc.x + 2,
        y: yPosition - 8,
        size: 7,
        font,
      });

      if (item.hsn_code) {
        currentPage.drawText(item.hsn_code, {
          x: cols.hsn.x + 2,
          y: yPosition - 8,
          size: 7,
          font,
        });
      }

      currentPage.drawText(String(item.quantity), {
        x: cols.qty.x + 2,
        y: yPosition - 8,
        size: 8,
        font,
      });

      currentPage.drawText(this.truncate(item.uom, 6), {
        x: cols.uom.x + 2,
        y: yPosition - 8,
        size: 7,
        font,
      });

      currentPage.drawText(this.formatCurrency(item.unit_price, data.currency), {
        x: cols.rate.x + 2,
        y: yPosition - 8,
        size: 7,
        font,
      });

      if (item.discount_percent) {
        currentPage.drawText(`${item.discount_percent}%`, {
          x: cols.disc.x + 2,
          y: yPosition - 8,
          size: 7,
          font,
        });
      }

      currentPage.drawText(`${taxRate}%`, {
        x: cols.tax.x + 2,
        y: yPosition - 8,
        size: 7,
        font,
      });

      currentPage.drawText(this.formatCurrency(item.total_price, data.currency), {
        x: cols.amount.x + 2,
        y: yPosition - 8,
        size: 8,
        font,
      });

      yPosition -= 14;
    }

    // Bottom border
    currentPage.drawLine({
      start: { x: margin, y: yPosition + 2 },
      end: { x: margin + tableWidth, y: yPosition + 2 },
      thickness: 1,
      color: this.COLORS.border,
    });

    return { page: currentPage, yPosition: yPosition - 10 };
  }

  private drawFinancialSummary(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
  ): number {
    const summaryX = width - 250;
    const labelX = summaryX + 10;
    const valueX = summaryX + 150;

    const taxTotal = (data.cgstTotal || 0) + (data.sgstTotal || 0) + (data.igstTotal || 0);

    const summaryItems = [
      { label: 'Subtotal:', value: data.subtotal },
      data.totalDiscount ? { label: 'Discount:', value: -data.totalDiscount } : null,
      { label: 'Taxable Amount:', value: data.taxableAmount },
      taxTotal ? { label: 'Tax Amount:', value: taxTotal } : null,
      data.cgstTotal ? { label: `CGST:`, value: data.cgstTotal } : null,
      data.sgstTotal ? { label: `SGST:`, value: data.sgstTotal } : null,
      data.igstTotal ? { label: `IGST:`, value: data.igstTotal } : null,
      data.tcsAmount ? { label: 'TCS:', value: data.tcsAmount } : null,
      data.roundOff ? { label: 'Round Off:', value: data.roundOff } : null,
    ].filter(Boolean);

    // Summary Box (auto height)
    const lineHeight = 14;
    const topPadding = 15;
    const bottomPadding = 10;
    const grandTotalBlockHeight = 30;
    const boxHeight = topPadding + (summaryItems.length * lineHeight) + bottomPadding + grandTotalBlockHeight;

    page.drawRectangle({
      x: summaryX,
      y: yPosition - boxHeight,
      width: 210,
      height: boxHeight,
      borderColor: this.COLORS.border,
      borderWidth: 1.5,
    });

    yPosition -= topPadding;

    summaryItems.forEach((item) => {
      page.drawText(item!.label, {
        x: labelX,
        y: yPosition,
        size: 9,
        font,
      });

      page.drawText(this.formatCurrency(item!.value, data.currency), {
        x: valueX,
        y: yPosition,
        size: 9,
        font,
      });

      yPosition -= 14;
    });

    // Grand Total
    yPosition -= 5;
    page.drawRectangle({
      x: summaryX,
      y: yPosition - 15,
      width: 210,
      height: 20,
      color: this.COLORS.success,
    });

    page.drawText('GRAND TOTAL:', {
      x: labelX,
      y: yPosition - 8,
      size: 11,
      font: fontBold,
      color: this.COLORS.white,
    });

    page.drawText(this.formatCurrency(data.grandTotal, data.currency), {
      x: valueX,
      y: yPosition - 8,
      size: 11,
      font: fontBold,
      color: this.COLORS.white,
    });

    // Amount in words - removed to avoid overlap with terms section
    // Will be shown in footer or special instructions if needed

    return yPosition - 15;
  }

  private drawTermsAndConditions(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    fontItalic: PDFFont,
    yPosition: number,
    width: number,
  ): number {
    // Terms section starts BELOW the financial summary box (which is ~170px tall)
    yPosition -= 170;
    
    page.drawText('TERMS & CONDITIONS', {
      x: 50,
      y: yPosition,
      size: 11,
      font: fontBold,
      color: this.COLORS.primary,
    });

    page.drawLine({
      start: { x: 50, y: yPosition - 5 },
      end: { x: 250, y: yPosition - 5 },
      thickness: 2,
      color: this.COLORS.accent,
    });

    yPosition -= 20;

    // Requested layout: show Payment Terms and Delivery Terms as separate headers/blocks.
    // Source of truth is line-item terms; fall back to header terms only if line items don't have values.
    const uniq = (values: any[]) => Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
    const itemPaymentTerms = uniq((data.items || []).map((it: any) => it?.payment_terms ?? it?.paymentTerms));
    const itemDeliveryTerms = uniq((data.items || []).map((it: any) => it?.delivery_terms ?? it?.deliveryTerms));

    const paymentTermsValue =
      (itemPaymentTerms.length > 0 ? itemPaymentTerms.join(', ') : (data.paymentTerms || data.terms?.payment_terms)) || 'NET 30';
    const deliveryTermsValue =
      (itemDeliveryTerms.length > 0 ? itemDeliveryTerms.join(', ') : data.terms?.delivery_terms) || 'As per delivery schedule';

    const drawTermBlock = (title: string, value: string) => {
      page.drawText(title.toUpperCase(), {
        x: 50,
        y: yPosition,
        size: 9,
        font: fontBold,
        color: this.COLORS.primary,
      });
      yPosition -= 12;
      page.drawText(this.truncate(value, 78), {
        x: 50,
        y: yPosition,
        size: 8,
        font,
        color: this.COLORS.black,
      });
      yPosition -= 16;
    };

    drawTermBlock('Payment Terms', paymentTermsValue);
    drawTermBlock('Delivery Terms', deliveryTermsValue);

    const otherTerms = [
      { label: 'Freight', value: data.terms?.freight_terms || 'FOB Destination' },
      { label: 'Insurance', value: data.terms?.insurance_terms || 'As applicable' },
      { label: 'Warranty', value: data.terms?.warranty_terms || 'As per manufacturer warranty' },
      { label: 'Inspection', value: data.terms?.inspection_terms || 'Subject to inspection at destination' },
      { label: 'Packaging', value: data.terms?.packaging_terms || 'Proper export packaging required' },
      { label: 'Validity', value: data.terms?.validity_days ? `${data.terms.validity_days} days` : '30 days' },
    ];

    otherTerms.forEach((term) => {
      page.drawText(`${term.label}:`, {
        x: 50,
        y: yPosition,
        size: 8,
        font: fontBold,
      });

      page.drawText(this.truncate(term.value, 50), {
        x: 140,
        y: yPosition,
        size: 8,
        font,
      });

      yPosition -= 13;
    });

    // Standard Terms
    yPosition -= 10;
    page.drawText('GENERAL CONDITIONS:', {
      x: 50,
      y: yPosition,
      size: 9,
      font: fontBold,
    });

    yPosition -= 15;
    const standardTerms = [
      '1. Supplier must comply with all applicable laws.',
      '2. Material must conform to our specifications.',
      '3. Supplier must provide test certificates.',
      '4. Deviations must be pre-approved in writing.',
      '5. Buyer reserves right to reject material.',
      '6. Late delivery may result in penalty.',
      '7. Disputes subject to [City] jurisdiction.',
    ];

    standardTerms.forEach((term) => {
      if (yPosition < 100) return; // Skip if not enough space
      page.drawText(term, {
        x: 55,
        y: yPosition,
        size: 7,
        font,
        maxWidth: 280, // Constrain to left column width
        color: this.COLORS.gray,
      });
      yPosition -= 11;
    });

    if (data.specialInstructions || data.remarks) {
      yPosition -= 10;
      page.drawText('SPECIAL INSTRUCTIONS:', {
        x: 50,
        y: yPosition,
        size: 9,
        font: fontBold,
      });

      yPosition -= 12;
      const instructions = (data.specialInstructions || data.remarks || '').split('\n');
      instructions.forEach((line) => {
        if (yPosition < 100) return;
        const truncatedLine = this.truncate(line, 60); // Limit to left column
        page.drawText(truncatedLine, {
          x: 55,
          y: yPosition,
          size: 8,
          font: fontItalic,
        });
        yPosition -= 11;
      });
    }

    return yPosition;
  }

  private drawSignatureSection(
    page: PDFPage,
    data: POPdfData,
    font: PDFFont,
    fontBold: PDFFont,
    yPosition: number,
    width: number,
  ): void {
    const signatureY = 150;
    const col1 = 50;
    const col2 = 230;
    const col3 = 410;

    // Signature boxes
    [
      { x: col1, label: 'Prepared By', name: data.preparedBy },
      { x: col2, label: 'Reviewed By', name: data.reviewedBy },
      { x: col3, label: 'Approved By', name: data.approvedBy },
    ].forEach((sig) => {
      page.drawRectangle({
        x: sig.x,
        y: signatureY - 60,
        width: 140,
        height: 65,
        borderColor: this.COLORS.border,
        borderWidth: 1,
      });

      page.drawText(sig.label, {
        x: sig.x + 5,
        y: signatureY - 10,
        size: 8,
        font: fontBold,
      });

      if (sig.name) {
        page.drawText(sig.name, {
          x: sig.x + 5,
          y: signatureY - 50,
          size: 8,
          font,
        });
      }

      page.drawLine({
        start: { x: sig.x + 5, y: signatureY - 45 },
        end: { x: sig.x + 135, y: signatureY - 45 },
        thickness: 0.5,
        color: this.COLORS.gray,
      });

      page.drawText('Signature', {
        x: sig.x + 45,
        y: signatureY - 55,
        size: 7,
        font,
        color: this.COLORS.gray,
      });
    });

    // Company seal placeholder
    page.drawText('Company Seal', {
      x: width - 150,
      y: signatureY - 30,
      size: 8,
      font: fontBold,
      color: this.COLORS.gray,
    });

    page.drawCircle({
      x: width - 90,
      y: signatureY - 25,
      size: 30,
      borderColor: this.COLORS.border,
      borderWidth: 1.5,
    });
  }

  private drawFooter(
    page: PDFPage,
    font: PDFFont,
    data: POPdfData,
    pageNum: number,
    totalPages: number,
  ): void {
    const footerY = 25;

    page.drawLine({
      start: { x: 50, y: footerY + 10 },
      end: { x: page.getWidth() - 50, y: footerY + 10 },
      thickness: 0.5,
      color: this.COLORS.border,
    });

    page.drawText('This is a computer-generated document. Digital signature is valid.', {
      x: 50,
      y: footerY,
      size: 7,
      font,
      color: this.COLORS.gray,
    });

    page.drawText(`Page ${pageNum} of ${totalPages}`, {
      x: page.getWidth() - 130,
      y: footerY,
      size: 7,
      font,
      color: this.COLORS.gray,
    });

    page.drawText(`PO: ${data.poNumber}`, {
      x: (page.getWidth() / 2) - 40,
      y: footerY,
      size: 7,
      font,
      color: this.COLORS.gray,
    });
  }

  private formatCurrency(amount: number, currency: string = 'INR'): string {
    const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : 'Rs. ';
    const value = amount ?? 0; // Handle null/undefined
    return `${symbol}${value.toFixed(2)}`;
  }

  private truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? text.substring(0, maxLength - 2) + '..' : text;
  }

  private wrapText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length <= maxLength) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    return lines;
  }

  private numberToWords(num: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero';

    const crores = Math.floor(num / 10000000);
    const lakhs = Math.floor((num % 10000000) / 100000);
    const thousands = Math.floor((num % 100000) / 1000);
    const hundreds = Math.floor((num % 1000) / 100);
    const remainder = num % 100;

    let words = '';

    if (crores > 0) words += this.convertHundreds(crores) + ' Crore ';
    if (lakhs > 0) words += this.convertHundreds(lakhs) + ' Lakh ';
    if (thousands > 0) words += this.convertHundreds(thousands) + ' Thousand ';
    if (hundreds > 0) words += ones[hundreds] + ' Hundred ';

    if (remainder > 0) {
      if (remainder < 10) words += ones[remainder];
      else if (remainder < 20) words += teens[remainder - 10];
      else {
        words += tens[Math.floor(remainder / 10)];
        if (remainder % 10 > 0) words += ' ' + ones[remainder % 10];
      }
    }

    return words.trim() + ' Only';
  }

  private convertHundreds(num: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    const hundreds = Math.floor(num / 100);
    const remainder = num % 100;

    let words = '';
    if (hundreds > 0) words += ones[hundreds] + ' Hundred ';

    if (remainder > 0) {
      if (remainder < 10) words += ones[remainder];
      else if (remainder < 20) words += teens[remainder - 10];
      else {
        words += tens[Math.floor(remainder / 10)];
        if (remainder % 10 > 0) words += ' ' + ones[remainder % 10];
      }
    }

    return words.trim();
  }

  generateFilename(poNumber: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `PO_${poNumber}_${timestamp}.pdf`;
  }
}
