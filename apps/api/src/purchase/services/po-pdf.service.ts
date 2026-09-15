import { Injectable } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { DocumentBrandingService } from '../../common/services/document-branding.service';

function formatShortDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(2);
  return `${day}/${month}/${year}`;
}

interface POItem {
  item_code: string;
  item_name: string;
  description?: string;
  quantity: number;
  uom: string;
  unit_price: number;
  total_price: number;
  tax_amount?: number;
  specifications?: string;
  payment_terms?: string;
  delivery_terms?: string;
}

interface POPdfData {
  poNumber: string;
  poDate: string;
  vendorName: string;
  vendorAddress?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  items: POItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  paymentTerms?: string;
  deliveryTerms?: string;
  deliveryDate?: string;
  remarks?: string;
  companyName?: string;
  companyAddress?: string;
}

const formatInr = (value: number): string => `INR ${Number(value || 0).toFixed(2)}`;

@Injectable()
export class PoPdfService {
  constructor(private readonly documentBrandingService: DocumentBrandingService) {}

  async generatePOPdf(tenantId: string, data: POPdfData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const branding = await this.documentBrandingService.getBranding(tenantId, {
      companyName: data.companyName,
      address: data.companyAddress,
      taxId: '',
    });
    const assets = await this.documentBrandingService.preparePdfBrandingAssets(pdfDoc, branding);
    const page = await this.documentBrandingService.createBrandedPage(pdfDoc, assets, [595, 842]); // A4 size
    const { width, height } = page.getSize();

    let yPosition = this.documentBrandingService.drawStandardHeader({
      page,
      topY: height - 36,
      marginX: 50,
      width: width - 100,
      title: 'PURCHASE ORDER',
      reference: data.poNumber,
      branding,
      font,
      fontBold,
      assets,
    });

    // PO Number and Date
    yPosition -= 26;
    page.drawText(`PO Number: ${data.poNumber}`, {
      x: 50,
      y: yPosition,
      size: 11,
      font: fontBold,
    });

    page.drawText(`Date: ${formatShortDate(data.poDate)}`, {
      x: width - 200,
      y: yPosition,
      size: 11,
      font,
    });

    // Vendor Details Box
    yPosition -= 30;
    page.drawRectangle({
      x: 50,
      y: yPosition - 70,
      width: 250,
      height: 75,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });

    page.drawText('VENDOR:', {
      x: 60,
      y: yPosition - 15,
      size: 10,
      font: fontBold,
    });

    page.drawText(data.vendorName, {
      x: 60,
      y: yPosition - 30,
      size: 10,
      font,
    });

    if (data.vendorAddress) {
      page.drawText(data.vendorAddress.substring(0, 35), {
        x: 60,
        y: yPosition - 45,
        size: 9,
        font,
      });
    }

    if (data.vendorEmail) {
      page.drawText(data.vendorEmail, {
        x: 60,
        y: yPosition - 60,
        size: 9,
        font,
      });
    }

    // Delivery & Terms
    if (data.deliveryDate || data.paymentTerms || data.deliveryTerms) {
      page.drawRectangle({
        x: 320,
        y: yPosition - 70,
        width: 225,
        height: 75,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
      });

      let termsY = yPosition - 15;
      if (data.deliveryDate) {
        page.drawText(`Delivery Date: ${formatShortDate(data.deliveryDate)}`, {
          x: 330,
          y: termsY,
          size: 9,
          font,
        });
        termsY -= 15;
      }

      if (data.paymentTerms) {
        page.drawText(`Payment Terms: ${data.paymentTerms}`, {
          x: 330,
          y: termsY,
          size: 9,
          font,
        });
        termsY -= 15;
      }

      if (data.deliveryTerms) {
        page.drawText(`Delivery Terms: ${data.deliveryTerms}`, {
          x: 330,
          y: termsY,
          size: 9,
          font,
        });
      }
    }

    // Items Table
    yPosition -= 100;
    
    // Table Header
    const tableStartY = yPosition;
    const colX = {
      sno: 50,
      code: 75,
      name: 150,
      desc: 260,
      qty: 360,
      uom: 400,
      price: 440,
      total: 490,
    };

    page.drawRectangle({
      x: 50,
      y: tableStartY - 15,
      width: 495,
      height: 20,
      color: rgb(0.573, 0.251, 0.024), // Amber-900
    });

    page.drawText('S.No', { x: colX.sno, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Code', { x: colX.code, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Item Name', { x: colX.name, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Description', { x: colX.desc, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Qty', { x: colX.qty, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('UOM', { x: colX.uom, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Price', { x: colX.price, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Total', { x: colX.total, y: tableStartY - 10, size: 9, font: fontBold, color: rgb(1, 1, 1) });

    // Table Rows
    yPosition -= 25;
    data.items.forEach((item, index) => {
      page.drawText(String(index + 1), { x: colX.sno, y: yPosition, size: 8, font });
      page.drawText(item.item_code.substring(0, 12), { x: colX.code, y: yPosition, size: 8, font });
      page.drawText(item.item_name.substring(0, 18), { x: colX.name, y: yPosition, size: 8, font });
      page.drawText((item.description || item.specifications || '').substring(0, 18), { x: colX.desc, y: yPosition, size: 8, font });
      page.drawText(String(item.quantity), { x: colX.qty, y: yPosition, size: 8, font });
      page.drawText(item.uom.substring(0, 6), { x: colX.uom, y: yPosition, size: 8, font });
      page.drawText(formatInr(item.unit_price), { x: colX.price, y: yPosition, size: 8, font });
      page.drawText(formatInr(item.total_price), { x: colX.total, y: yPosition, size: 8, font });

      yPosition -= 15;

      // Add new page if needed
      if (yPosition < 150 && index < data.items.length - 1) {
        const newPage = pdfDoc.addPage([595, 842]);
        yPosition = height - 50;
      }
    });

    // Totals Section
    yPosition -= 20;
    const totalsX = width - 200;

    page.drawLine({
      start: { x: totalsX - 50, y: yPosition + 5 },
      end: { x: width - 50, y: yPosition + 5 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    page.drawText('Subtotal:', { x: totalsX, y: yPosition, size: 10, font });
    page.drawText(formatInr(data.subtotal), { x: totalsX + 80, y: yPosition, size: 10, font });

    yPosition -= 15;
    page.drawText('Tax:', { x: totalsX, y: yPosition, size: 10, font });
    page.drawText(formatInr(data.taxTotal), { x: totalsX + 80, y: yPosition, size: 10, font });

    yPosition -= 15;
    page.drawLine({
      start: { x: totalsX - 50, y: yPosition + 5 },
      end: { x: width - 50, y: yPosition + 5 },
      thickness: 2,
      color: rgb(0, 0, 0),
    });

    page.drawText('Grand Total:', { x: totalsX, y: yPosition - 5, size: 11, font: fontBold });
    page.drawText(formatInr(data.grandTotal), { x: totalsX + 80, y: yPosition - 5, size: 11, font: fontBold });

    // Remarks
    if (data.remarks) {
      yPosition -= 40;
      page.drawText('Remarks:', { x: 50, y: yPosition, size: 10, font: fontBold });
      page.drawText(data.remarks.substring(0, 80), { x: 50, y: yPosition - 15, size: 9, font });
    }

    // Footer
    const footerY = 50;
    page.drawText('This is a computer-generated document and does not require a signature.', {
      x: 50,
      y: footerY,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  generateFilename(poNumber: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `PO_${poNumber}_${timestamp}.pdf`;
  }
}
