import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';
import { PDFDocument, degrees, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
import { DocumentBranding, DocumentBrandingService, PdfBrandingAssets } from '../../common/services/document-branding.service';

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
  vendorStreet?: string;
  vendorCity?: string;
  vendorState?: string;
  vendorPincode?: string;
  vendorCountry?: string;
  vendorGSTIN?: string;
  vendorPAN?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  vendorSalutation?: string;
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
  placeOfSupply?: string;
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
  freightAmount?: number;
  freightGstApplicable?: boolean;
  freightGstPercent?: number;
  freightGstAmount?: number;
  additionalExpenses?: number;
  customsDuty?: number;
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
  isServiceOrder?: boolean;
}

export function resolveVendorContactSalutation(vendor: any): string {
  const metadata = vendor?.metadata && typeof vendor.metadata === 'object' && !Array.isArray(vendor.metadata)
    ? vendor.metadata
    : {};
  const contacts = Array.isArray(metadata.contacts) ? metadata.contacts : [];
  const contactName = String(vendor?.contact_person || '').trim().toLocaleLowerCase();
  const matchingContact = contacts.find((contact: any) =>
    contactName && String(contact?.name || '').trim().toLocaleLowerCase() === contactName,
  );
  const defaultContact = contacts.find((contact: any) => contact?.isDefault === true || contact?.is_default === true);
  return String(matchingContact?.salutation || defaultContact?.salutation || metadata.salutation || '').trim();
}

export function formatVendorContactName(salutation?: string, contactName?: string): string {
  const name = String(contactName || '').trim();
  const title = String(salutation || '').trim();
  if (!name || !title) return name;

  const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, ' ');
  const normalizedTitle = title.toLocaleLowerCase().replace(/\s+/g, ' ');
  return normalizedName === normalizedTitle || normalizedName.startsWith(`${normalizedTitle} `)
    ? name
    : `${title} ${name}`;
}

type PageState = { page: PDFPage; pageNumber: number; y: number };

// ─── Layout constants ────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const MX = 36;
const MY_TOP = 30;
const MY_BOT = 36;
const USABLE = PAGE_W - MX * 2; // 523

// ─── Colours ─────────────────────────────────────────────────────────────────
const BRAND       = rgb(0.149, 0.271, 0.553);
const BRAND_LIGHT = rgb(0.929, 0.949, 0.988);
const DARK        = rgb(0.13, 0.13, 0.13);
const GRAY        = rgb(0.30, 0.30, 0.30);
const MID_GRAY    = rgb(0.55, 0.55, 0.55);
const BORDER      = rgb(0.75, 0.78, 0.82);
const WHITE       = rgb(1, 1, 1);
const ROW_ALT     = rgb(0.960, 0.965, 0.975);

const DEFAULT_PO_ISSUER = {
  companyName: 'SAK Solutions',
  address: '1st Floor, Sunrise Incubation Hub, Hill No. 3, Rushikonda, Visakhapatnam - 530045',
  phone: '0891-6662153',
  email: 'info@mizantra.ae',
  taxId: '37ADSFS6370G1ZG',
};

@Injectable()
export class WorldClassPoPdfService {
  constructor(private readonly documentBrandingService: DocumentBrandingService) {}

  /* ═══════════════════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════════════════*/

  async generatePOPdf(tenantId: string, data: POPdfData): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const orderTypeStr = data.isServiceOrder ? 'Service Order' : 'Purchase Order';
    pdfDoc.setTitle(data.poNumber || orderTypeStr);
    pdfDoc.setSubject(`${orderTypeStr} ${data.poNumber}`);

    const font       = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pages: PDFPage[] = [];
    const branding = await this.documentBrandingService.getBranding(tenantId || undefined, DEFAULT_PO_ISSUER);
    const assets     = await this.documentBrandingService.preparePdfBrandingAssets(pdfDoc, branding);
    const normalizedData = this.withRoundedGrandTotal({
      ...data,
      companyName: branding.companyName,
      companyAddress: branding.address || data.companyAddress,
      companyEmail: branding.email || data.companyEmail,
      companyPhone: branding.phone || data.companyPhone,
      companyWebsite: branding.website || data.companyWebsite,
      companyGSTIN: branding.taxId || data.companyGSTIN,
    });
    pdfDoc.setAuthor(branding.companyName);
    pdfDoc.setCreator('SAK ERP');
    pdfDoc.setProducer('SAK ERP');
    const ctx = { pdfDoc, pages, font, fontBold, fontItalic, assets, data: normalizedData, branding };

    let s = await this.newPage(ctx);
    s = await this.drawReferenceStylePurchaseOrder(s, ctx);
    s = await this.drawGeneralTermsPage(ctx);
    this.drawFooters(pages, font, branding, assets);

    return Buffer.from(await pdfDoc.save());
  }

  generateFilename(poNumber: string, supplierName?: string, isDraft = false): string {
    const safePart = (value: unknown, fallback: string) => {
      const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return normalized || fallback;
    };

    const supplier = safePart(supplierName, 'Supplier');
    const po = safePart(poNumber, 'PO');
    return `${supplier}_${po}${isDraft ? '_DRAFT' : ''}.pdf`;
  }

  async applyDraftWatermark(pdfBuffer: Buffer): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    for (const page of pdfDoc.getPages()) {
      const { width, height } = page.getSize();
      const size = Math.max(54, Math.min(width, height) * 0.16);
      const text = 'DRAFT';
      const textWidth = font.widthOfTextAtSize(text, size);

      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2 - size / 3,
        size,
        font,
        color: rgb(0.72, 0.08, 0.08),
        opacity: 0.18,
        rotate: degrees(45),
      });
    }

    return Buffer.from(await pdfDoc.save());
  }

  /**
   * Append item drawings (PDF or image files) as extra pages after the main PO pages.
   * Each drawing is fetched via its URL and merged into the main PDF document.
   */
  async loadFileBuffer(fileUrl: string): Promise<Buffer> {
    const cleanUrl = String(fileUrl || '').trim();
    if (!cleanUrl) throw new Error('Missing file URL');

    if (cleanUrl.startsWith('data:')) {
      const commaIndex = cleanUrl.indexOf(',');
      if (commaIndex === -1) throw new Error('Invalid data URL');
      return Buffer.from(cleanUrl.slice(commaIndex + 1), cleanUrl.slice(0, commaIndex).includes(';base64') ? 'base64' : 'utf8');
    }

    if (/^https?:\/\//i.test(cleanUrl)) {
      const response = await fetch(cleanUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }

    const uploadsRoot = process.env.UPLOAD_ROOT_DIR || resolve(process.cwd(), '..', '..', 'uploads');
    const resolvedUploadsRoot = resolve(uploadsRoot);
    const relativeUploadPath = cleanUrl
      .replace(/^file:\/\//i, '')
      .replace(/^\/?uploads[\\/]/i, '')
      .replace(/^[/\\]+/, '');

    const localCandidates = [
      isAbsolute(cleanUrl) ? cleanUrl : '',
      resolve(resolvedUploadsRoot, relativeUploadPath),
      resolve(process.cwd(), cleanUrl.replace(/^[/\\]+/, '')),
    ].filter(Boolean);

    const localPath = localCandidates.find((candidate) => {
      const resolvedCandidate = resolve(candidate);
      return (
        existsSync(resolvedCandidate) &&
        (resolvedCandidate.startsWith(resolvedUploadsRoot) || isAbsolute(cleanUrl))
      );
    });

    if (!localPath) throw new Error(`Local file not found: ${cleanUrl}`);
    return readFile(localPath);
  }

  private repairPdfCatalogAndXrefForPdfLib(pdfBuffer: Buffer): Buffer {
    const source = pdfBuffer.toString('latin1');
    const xrefIndex = source.lastIndexOf('\nxref');
    if (xrefIndex < 0) return pdfBuffer;

    const trailerSection = source.slice(xrefIndex);
    const rootMatch = trailerSection.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
    if (!rootMatch) return pdfBuffer;

    const rootObjNo = Number(rootMatch[1]);
    const rootGenNo = Number(rootMatch[2] || 0);
    let body = source.slice(0, xrefIndex + 1);

    const rootObjectPattern = new RegExp(`${rootObjNo}\\s+${rootGenNo}\\s+obj\\s*<<([\\s\\S]*?)>>`);
    const rootDict = (body.match(rootObjectPattern) || [])[1] || '';
    const pagesMatch = rootDict.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
    const pagesObjNo = pagesMatch ? Number(pagesMatch[1]) : null;

    // Some CAD exports (e.g. SpaceClaim) create PDFs Acrobat can open but omit
    // required /Type markers on Catalog/Page tree/Page dictionaries. pdf-lib is
    // stricter and refuses to traverse those documents, so normalize them before
    // embedding as PO drawing appendices.
    body = body.replace(
      /(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>\s*(stream|endobj)/g,
      (full, objNoText, genNoText, dict, terminator) => {
        const objNo = Number(objNoText);
        let nextDict = String(dict || '');
        const isRoot = objNo === rootObjNo;
        const isPages = pagesObjNo !== null && objNo === pagesObjNo;
        const isPage = /\/MediaBox\s*\[/.test(nextDict) && /\/Parent\s+\d+\s+\d+\s+R/.test(nextDict);

        if (isRoot && !/\/Type\s*\/Catalog\b/.test(nextDict)) {
          nextDict = `/Type /Catalog ${nextDict}`;
        }
        if (isPages && !/\/Type\s*\/Pages\b/.test(nextDict)) {
          nextDict = `/Type /Pages ${nextDict}`;
        }
        if (isPage && !/\/Type\s*\/Page\b/.test(nextDict)) {
          nextDict = `/Type /Page ${nextDict}`;
        }

        return `${objNoText} ${genNoText} obj <<${nextDict}>> ${terminator}`;
      },
    );

    const offsets: number[] = [];
    const objectRegex = /(^|\n)(\d+)\s+(\d+)\s+obj\b/g;
    let objectMatch: RegExpExecArray | null;
    while ((objectMatch = objectRegex.exec(body)) !== null) {
      const objectNo = Number(objectMatch[2]);
      offsets[objectNo] = objectMatch.index + (objectMatch[1] ? 1 : 0);
    }

    const maxObjectNo = Math.max(0, ...Object.keys(offsets).map((value) => Number(value)));
    let xref = `xref\n0 ${maxObjectNo + 1}\n`;
    for (let index = 0; index <= maxObjectNo; index += 1) {
      xref += index === 0 || offsets[index] === undefined
        ? '0000000000 65535 f \n'
        : `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }

    const infoMatch = trailerSection.match(/\/Info\s+(\d+)\s+(\d+)\s+R/);
    const idMatch = trailerSection.match(/\/ID\s*\[[\s\S]*?\]/);
    let trailer = `<</Root ${rootObjNo} ${rootGenNo} R /Size ${maxObjectNo + 1}`;
    if (infoMatch) trailer += ` /Info ${infoMatch[1]} ${infoMatch[2]} R`;
    if (idMatch) trailer += ` ${idMatch[0]}`;
    trailer += '>>';

    const startXref = Buffer.byteLength(body, 'latin1');
    return Buffer.from(
      `${body}${xref}trailer ${trailer}\nstartxref\n${startXref}\n%%EOF\n`,
      'latin1',
    );
  }

  private async loadPdfDocumentForAppend(pdfBuffer: Buffer): Promise<PDFDocument> {
    try {
      const loaded = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true } as any);
      // pdf-lib can defer structural failures until page traversal.
      loaded.getPageCount();
      return loaded;
    } catch (originalError: any) {
      const repaired = this.repairPdfCatalogAndXrefForPdfLib(pdfBuffer);
      if (repaired === pdfBuffer) throw originalError;
      try {
        const loaded = await PDFDocument.load(repaired, { ignoreEncryption: true } as any);
        loaded.getPageCount();
        return loaded;
      } catch {
        throw originalError;
      }
    }
  }

  async appendDrawings(
    mainPdfBuffer: Buffer,
    drawings: Array<{ file_url: string; file_name?: string; file_type?: string }>,
  ): Promise<Buffer> {
    if (!drawings || drawings.length === 0) return mainPdfBuffer;

    const mainDoc = await PDFDocument.load(mainPdfBuffer);
    const A4W = 595, A4H = 842;

    for (const drawing of drawings) {
      if (!drawing.file_url) continue;
      try {
        const fileBuffer = await this.loadFileBuffer(drawing.file_url);
        const fileType = (drawing.file_type || '').toLowerCase();
        const fileName = (drawing.file_name || '').toLowerCase();

        const isPdf = fileType.includes('pdf') || fileName.endsWith('.pdf');
        const isPng = fileType.includes('png') || fileName.endsWith('.png');
        const isJpeg = !isPdf && !isPng && (
          fileType.includes('jpeg') || fileType.includes('jpg') ||
          fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')
        );

        if (isPdf) {
          const drawingDoc = await this.loadPdfDocumentForAppend(fileBuffer);
          const indices = Array.from({ length: drawingDoc.getPageCount() }, (_, i) => i);
          const copiedPages = await mainDoc.copyPages(drawingDoc, indices);
          for (const pg of copiedPages) mainDoc.addPage(pg);
        } else if (isPng || isJpeg) {
          const image = isPng
            ? await mainDoc.embedPng(fileBuffer)
            : await mainDoc.embedJpg(fileBuffer);
          const { width, height } = image.scale(1);
          const scale = Math.min(A4W / width, A4H / height, 1);
          const imgW = width * scale;
          const imgH = height * scale;
          const page = mainDoc.addPage([A4W, A4H]);
          page.drawImage(image, {
            x: (A4W - imgW) / 2,
            y: (A4H - imgH) / 2,
            width: imgW,
            height: imgH,
          });
        } else {
          console.warn(`[PoPdf] Unsupported drawing type: ${drawing.file_type} (${drawing.file_name})`);
        }
      } catch (err: any) {
        console.warn(`[PoPdf] Failed to embed drawing "${drawing.file_name}":`, err?.message || err);
      }
    }

    return Buffer.from(await mainDoc.save());
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PAGE MANAGEMENT
     ═══════════════════════════════════════════════════════════════════════════*/

  /** Pre-computes the vertical space consumed by drawSummaryBlock + drawShortTerms.
   *  Used to pin those blocks to the bottom of the page. */
  private estimateSummaryAndTermsH(ctx: any): number {
    const { font, fontBold, data } = ctx;
    const leftW = Math.round(USABLE * 0.60);

    // --- Summary block (mirrors drawSummaryBlock logic) ---
    const rowCount = 5  // Subtotal, Discount, Taxable, CGST, SGST
      + (data.igstTotal ? 1 : 0)
      + (data.roundOff  ? 1 : 0)
      + 1; // Grand Total
    const remarkText  = data.specialInstructions || data.remarks || '-';
    const remarkLines = this.wrapMultiline(remarkText, leftW - 16, 7.5, font);
    const boxH        = Math.max(26 + rowCount * 12 + 8, 28 + remarkLines.length * 10 + 8);
    const words       = `Amount in Words: INR ${this.amountInWords(data.grandTotal)} Only`;
    const wordLines   = this.wrapText(words, USABLE - 16, 7.5, fontBold);
    const wordBarH    = wordLines.length * 10 + 8;
    const summaryConsumed = boxH + wordBarH + 12; // matches: top - boxH - 4 - wordBarH - 8

    // --- Short terms (mirrors drawShortTerms logic) ---
    const colW      = (USABLE - 10) / 2;
    const statLines = [
      `GST No : ${data.companyGSTIN || '-'}`,
    ];
    const termLines = [
      `Payment : ${data.paymentTerms || data.terms?.payment_terms || '-'}`,
      `Delivery : ${data.terms?.delivery_terms || (data.deliveryDate ? this.fmtDate(data.deliveryDate) : '-')}`,
      `Freight : ${data.terms?.freight_terms || '-'}`,
    ];
    const lc   = this.countWrapped(statLines, colW - 12, 7.5, font);
    const rc   = this.countWrapped(termLines, colW - 12, 7.5, font);
    const barH = Math.max(36, 16 + Math.max(lc, rc) * 10 + 6);
    const shortTermsConsumed = barH + 8; // matches: top - barH - 8

    return summaryConsumed + shortTermsConsumed + 10; // +10 safety buffer
  }

  private async newPage(ctx: any): Promise<PageState> {
    const page = await this.documentBrandingService.createBrandedPage(ctx.pdfDoc, ctx.assets, [PAGE_W, PAGE_H]);
    ctx.pages.push(page);
    return { page, pageNumber: ctx.pages.length, y: PAGE_H - MY_TOP };
  }

  private async drawReferenceStylePurchaseOrder(state: PageState, ctx: any): Promise<PageState> {
    state = this.drawHeader(state, ctx);
    state = this.drawReferenceMeta(state, ctx);
    state = this.drawReferencePartyBlocks(state, ctx);
    state = await this.drawReferenceItemsTable(state, ctx);
    state = await this.pinReferenceBottomBlocks(state, ctx);
    state = await this.drawReferenceAmountSummary(state, ctx);
    state = await this.drawReferenceTermsAndSignature(state, ctx);
    return state;
  }

  private async drawGeneralTermsPage(ctx: any): Promise<PageState> {
    let state = await this.newPage(ctx);
    state = this.drawHeader(state, ctx);
    state = await this.drawGeneralTerms(state, ctx);
    return this.drawSignatureBlock(state, ctx);
  }

  private drawReferenceHeader(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, branding, data } = ctx;
    const centerX = PAGE_W / 2;
    let y = state.y;

    const title = branding.companyName || data.companyName || 'SAK Solutions';
    const titleSize = title.length > 42 ? 13 : 15;
    page.drawText(title, {
      x: centerX - fontBold.widthOfTextAtSize(title, titleSize) / 2,
      y,
      size: titleSize,
      font: fontBold,
      color: DARK,
    });
    y -= 14;

    const addressLines = (branding.addressLines?.length ? branding.addressLines : this.wrapText(data.companyAddress || '', USABLE, 8, font)).slice(0, 3);
    for (const line of addressLines) {
      const safe = this.fitText(line, USABLE, font, 8);
      page.drawText(safe, { x: centerX - font.widthOfTextAtSize(safe, 8) / 2, y, size: 8, font, color: GRAY });
      y -= 10;
    }

    const contactParts = [
      data.companyEmail ? `Email : ${data.companyEmail}` : '',
      data.companyGSTIN ? `GSTIN : ${data.companyGSTIN}` : '',
      data.companyPhone ? `Contact : ${data.companyPhone}` : '',
    ].filter(Boolean);
    if (contactParts.length) {
      for (const part of contactParts) {
        page.drawText(part, { x: centerX - font.widthOfTextAtSize(part, 7.5) / 2, y, size: 7.5, font, color: DARK });
        y -= 11;
      }
      y -= 3;
    }

    page.drawLine({ start: { x: MX, y }, end: { x: PAGE_W - MX, y }, thickness: 0.7, color: BORDER });
    y -= 18;

    const poTitle = data.isServiceOrder ? 'Service Order' : 'Purchase Order';
    page.drawText(poTitle, {
      x: centerX - fontBold.widthOfTextAtSize(poTitle, 13) / 2,
      y,
      size: 13,
      font: fontBold,
      color: DARK,
    });
    return { ...state, y: y - 16 };
  }

  private drawReferenceMeta(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, data } = ctx;
    const rows = [
      [
        `Purchase PO No : ${data.poNumber || '-'}`,
        `PO Date : ${this.fmtDate(data.poDate)}`,
      ],
      [
        `Quotation Number : ${data.quotationRef || '-'}`,
        `Quotation Date : ${data.quotationRef ? this.fmtDate(data.poDate) : '-'}`,
      ],
      [
        `PR Number : ${data.prNumber || '-'}`,
        `Delivery Date : ${data.deliveryDate ? this.fmtDate(data.deliveryDate) : '-'}`,
      ],
    ];
    const rowH = 15;
    const leftW = Math.floor(USABLE / 2);
    const top = state.y;
    const h = rows.length * rowH;

    page.drawRectangle({ x: MX, y: top - h, width: USABLE, height: h, borderColor: BORDER, borderWidth: 0.5 });
    page.drawLine({ start: { x: MX + leftW, y: top }, end: { x: MX + leftW, y: top - h }, thickness: 0.4, color: BORDER });

    rows.forEach((row, index) => {
      const y = top - rowH * index - 10.5;
      if (index > 0) {
        page.drawLine({ start: { x: MX, y: top - rowH * index }, end: { x: PAGE_W - MX, y: top - rowH * index }, thickness: 0.35, color: BORDER });
      }
      page.drawText(this.fitText(row[0], leftW - 12, font, 7.5), { x: MX + 6, y, size: 7.5, font: row[0].includes(data.poNumber || '###') ? fontBold : font, color: DARK });
      page.drawText(this.fitText(row[1], USABLE - leftW - 12, font, 7.5), { x: MX + leftW + 6, y, size: 7.5, font, color: DARK });
    });

    return { ...state, y: top - h - 10 };
  }

  private drawReferencePartyBlocks(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, data, branding } = ctx;
    const gap = 10;
    const colW = (USABLE - gap) / 2;
    const leftLines = [
      `Name : ${data.vendorName || '-'}`,
      `Address : ${data.vendorAddress || data.vendorStreet || '-'}`,
      data.vendorStreet && data.vendorAddress ? data.vendorStreet : '',
      [data.vendorCity, data.vendorState, data.vendorPincode].filter(Boolean).join(', '),
      data.vendorPincode ? `PIN : ${data.vendorPincode}` : '',
      `GSTIN : ${data.vendorGSTIN || '-'}`,
      data.vendorPAN ? `PAN NO : ${data.vendorPAN}` : '',
      data.vendorContactPerson ? `Name : ${formatVendorContactName(data.vendorSalutation, data.vendorContactPerson)}` : '',
      data.vendorPhone ? `Contact : ${data.vendorPhone}` : '',
    ].filter(Boolean);

    const deliveryAddress = data.deliveryAddress || branding.address || data.companyAddress || '';
    const deliveryLocation = data.deliveryAddress
      ? ''
      : [data.deliveryCity || data.companyCity, data.deliveryState || data.companyState, data.deliveryPincode || data.companyPincode].filter(Boolean).join(', ');
    const rightLines = [
      `Name : ${branding.companyName || data.companyName || '-'}`,
      `Address : ${deliveryAddress || '-'}`,
      deliveryLocation,
      !branding.address && (data.deliveryPincode || data.companyPincode) ? `PIN : ${data.deliveryPincode || data.companyPincode}` : '',
      data.deliveryContactPerson ? `Name : ${data.deliveryContactPerson}` : '',
      (data.deliveryPhone || branding.phone) ? `Contact : ${data.deliveryPhone || branding.phone}` : '',
    ].filter(Boolean);

    const leftCount = this.countWrapped(leftLines, colW - 12, 7.5, font);
    const rightCount = this.countWrapped(rightLines, colW - 12, 7.5, font);
    const blockH = Math.max(92, 18 + Math.max(leftCount, rightCount) * 9 + 8);
    const top = state.y;

    this.drawReferenceBox(page, MX, top, colW, blockH, 'Details Of Supplier/Vendor :', fontBold);
    this.drawReferenceBox(page, MX + colW + gap, top, colW, blockH, 'Details Of Consignee/Shipped to :', fontBold);
    this.drawReferenceLines(page, leftLines, MX + 6, top - 26, colW - 12, font, fontBold);
    this.drawReferenceLines(page, rightLines, MX + colW + gap + 6, top - 26, colW - 12, font, fontBold);

    return { ...state, y: top - blockH - 10 };
  }

  private async drawReferenceItemsTable(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;
    const cols = [
      { key: 'sl', title: 'Sr.\nNo', width: 24, align: 'center' as const },
      { key: 'desc', title: 'Name Of Particulars', width: 165, align: 'left' as const },
      { key: 'hsn', title: 'HSN\nSAC', width: 48, align: 'center' as const },
      { key: 'qty', title: 'Qty', width: 42, align: 'right' as const },
      { key: 'rate', title: 'Rate', width: 56, align: 'right' as const },
      { key: 'disc', title: 'Disc %', width: 42, align: 'right' as const },
      { key: 'amount', title: 'Amount', width: 58, align: 'right' as const },
      { key: 'tax', title: 'GST', width: 47, align: 'center' as const },
      { key: 'total', title: 'Total', width: 45, align: 'right' as const },
    ];
    const tw = cols.reduce((sum, col) => sum + col.width, 0);
    state = await this.referenceEnsureSpace(state, 42, ctx);
    state = this.drawReferenceTableHeader(state, cols, tw, fontBold);

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const descLines = this.wrapMultiline(this.composeReferenceDescription(item), cols[1].width - 8, 7.1, font);
      const taxLines = this.referenceTaxLines(item);
      const rowH = Math.max(24, Math.max(descLines.length, taxLines.length) * 9 + 8);
      state = await this.referenceEnsureSpace(state, rowH + 4, ctx, cols, tw);

      const top = state.y;
      state.page.drawRectangle({ x: MX, y: top - rowH, width: tw, height: rowH, color: WHITE, borderColor: BORDER, borderWidth: 0.45 });
      let x = MX;
      for (const col of cols) {
        state.page.drawLine({ start: { x, y: top }, end: { x, y: top - rowH }, thickness: 0.35, color: BORDER });
        x += col.width;
      }
      state.page.drawLine({ start: { x, y: top }, end: { x, y: top - rowH }, thickness: 0.35, color: BORDER });

      const taxAmount = this.itemTaxAmount(item);
      const vals: Record<string, string> = {
        sl: String(item.sl_no || i + 1),
        hsn: item.hsn_code || '',
        qty: `${this.fmtNum(item.quantity)} ${item.uom || ''}`.trim(),
        rate: this.fmtCur(item.unit_price),
        disc: `${this.fmtNum(item.discount_percent || 0)}%`,
        amount: this.fmtCur(item.taxable_amount || 0),
        total: this.fmtCur(item.total_price || 0),
      };

      let cx = MX;
      for (const col of cols) {
        if (col.key === 'desc') {
          this.drawWrappedLines(state.page, descLines, cx + 4, top - 11, col.width - 8, 7.1, font, 9, DARK);
        } else if (col.key === 'tax') {
          const compactTax = [...taxLines, this.fmtCur(taxAmount)];
          this.drawWrappedLines(state.page, compactTax, cx + 3, top - 11, col.width - 6, 6.5, font, 8, DARK);
        } else {
          this.cellText(state.page, vals[col.key] || '', cx, top - 13, col.width, col.align, font, 7.1, DARK);
        }
        cx += col.width;
      }
      state.y = top - rowH;
    }

    state = await this.referenceEnsureSpace(state, 18, ctx, cols, tw);
    const totalsTop = state.y;
    state.page.drawRectangle({ x: MX, y: totalsTop - 16, width: tw, height: 16, color: BRAND_LIGHT, borderColor: BORDER, borderWidth: 0.45 });
    state.page.drawText('Total', { x: MX + 8, y: totalsTop - 11, size: 7.5, font: fontBold, color: DARK });
    this.cellText(state.page, this.fmtCur(data.grandTotal), MX + tw - 75, totalsTop - 11, 75, 'right', fontBold, 7.5, DARK);

    return { ...state, y: totalsTop - 24 };
  }

  private async drawReferenceAmountSummary(state: PageState, ctx: any): Promise<PageState> {
    const { page } = state;
    const { font, fontBold } = ctx;
    const rows = this.referenceAmountRows(ctx);

    const rowH = 18;
    const h = rows.length * rowH;
    state = await this.referenceEnsureSpace(state, h + 10, ctx);
    const top = state.y;
    const leftW = 345;
    const rightW = USABLE - leftW;
    page.drawRectangle({ x: MX, y: top - h, width: USABLE, height: h, borderColor: BORDER, borderWidth: 0.45 });
    page.drawLine({ start: { x: MX + leftW, y: top }, end: { x: MX + leftW, y: top - h }, thickness: 0.35, color: BORDER });
    rows.forEach((row, index) => {
      const y = top - rowH * index;
      if (index > 0) page.drawLine({ start: { x: MX, y }, end: { x: PAGE_W - MX, y }, thickness: 0.35, color: BORDER });
      const isTotal = index === rows.length - 1;
      const f = isTotal ? fontBold : font;
      this.drawWrappedLines(page, this.wrapText(row[0], leftW - 12, 7.2, f), MX + 6, y - 11, leftW - 12, 7.2, f, 8.5, DARK);
      this.cellText(page, row[1], MX + leftW, y - 11, rightW - 4, 'right', f, 7.2, DARK);
    });

    return { ...state, y: top - h - 10 };
  }

  private async drawReferenceTermsAndSignature(state: PageState, ctx: any): Promise<PageState> {
    const { page } = state;
    const { font, fontBold, data } = ctx;
    const termLines = this.referenceTermLines(ctx);
    const instructionLines = this.referenceInstructionLines(ctx);
    const h = this.referenceTermsHeight(ctx);
    state = await this.referenceEnsureSpace(state, h, ctx);
    const top = state.y;
    const gap = 12;
    const boxW = (USABLE - gap) / 2;

    const drawTextBox = (x: number, title: string, lines: string[]) => {
      page.drawRectangle({ x, y: top - h, width: boxW, height: h, borderColor: BORDER, borderWidth: 0.5 });
      page.drawText(title, { x: x + 6, y: top - 12, size: 7.5, font: fontBold, color: DARK });
      page.drawLine({ start: { x, y: top - 18 }, end: { x: x + boxW, y: top - 18 }, thickness: 0.35, color: BORDER });

      let y = top - 30;
      for (const line of lines) {
        page.drawText(line, { x: x + 6, y, size: 7.1, font, color: DARK });
        y -= 8.6;
        if (y < top - h + 8) break;
      }
    };

    drawTextBox(MX, 'Terms & Conditions', termLines);
    drawTextBox(MX + boxW + gap, 'Special Instructions', instructionLines);

    return { ...state, y: top - h - 8 };
  }

  private async pinReferenceBottomBlocks(state: PageState, ctx: any): Promise<PageState> {
    const blockH = this.referenceBottomBlocksHeight(ctx);
    const pinnedTop = MY_BOT + 20 + blockH;

    if (state.y < pinnedTop) {
      state = await this.newPage(ctx);
      state = this.drawHeader(state, ctx);
    }

    return { ...state, y: Math.min(state.y, pinnedTop) };
  }

  private referenceBottomBlocksHeight(ctx: any): number {
    return this.referenceAmountRows(ctx).length * 18 + 10 + this.referenceTermsHeight(ctx) + 8;
  }

  private referenceTermsHeight(ctx: any): number {
    const contentLines = Math.max(this.referenceTermLines(ctx).length, this.referenceInstructionLines(ctx).length);
    return Math.max(62, contentLines * 9 + 30);
  }

  private referenceAmountRows(ctx: any): string[][] {
    const { data } = ctx;
    const taxTotal = (Number(data.cgstTotal || 0) || 0) + (Number(data.sgstTotal || 0) || 0) + (Number(data.igstTotal || 0) || 0);
    const rows = [
      [`Value of Supply : ${this.amountInWords(data.taxableAmount || data.subtotal || 0)} Only`, `Value of Supply : ${this.fmtCur(data.taxableAmount || data.subtotal || 0)}`],
    ];
    const freightAmount = Number(data.freightAmount || 0) || 0;
    const freightGstAmount = Number(data.freightGstAmount || 0) || 0;
    const freightGstPercent = Number(data.freightGstPercent || 0) || 0;
    const customsDuty = Number(data.customsDuty || 0) || 0;
    const additionalExpenses = Number(data.additionalExpenses || 0) || 0;
    if (freightAmount > 0) rows.push([`Freight Value : ${this.amountInWords(freightAmount)} Only`, `Freight Value : ${this.fmtCur(freightAmount)}`]);
    if (freightGstAmount > 0) rows.push([`Freight GST @ ${this.fmtNum(freightGstPercent)}% : ${this.amountInWords(freightGstAmount)} Only`, `Freight GST : ${this.fmtCur(freightGstAmount)}`]);
    if (customsDuty > 0) rows.push([`Customs Duty : ${this.amountInWords(customsDuty)} Only`, `Customs Duty : ${this.fmtCur(customsDuty)}`]);
    if (additionalExpenses > 0) rows.push([`Additional Expenses : ${this.amountInWords(additionalExpenses)} Only`, `Additional Expenses : ${this.fmtCur(additionalExpenses)}`]);
    rows.push([`Total Tax Amount : ${this.amountInWords(taxTotal)} Only`, `Tax Amount : ${this.fmtCur(taxTotal)}`]);
    const roundOff = this.safeNumber(data.roundOff);
    if (Math.abs(roundOff) >= 0.01) rows.push([`Rounding : ${this.fmtCur(roundOff)}`, `Rounding : ${this.fmtCur(roundOff)}`]);
    rows.push([`Total Amount : ${this.amountInWords(data.grandTotal || 0)} Only`, `Total Amount (INR) : ${this.fmtCur(data.grandTotal || 0)}`]);
    return rows;
  }

  private referenceTermLines(ctx: any): string[] {
    const { font, data } = ctx;
    const terms = [
      data.paymentTerms || data.terms?.payment_terms ? `Payment Terms : ${data.paymentTerms || data.terms?.payment_terms}` : '',
      data.terms?.delivery_terms ? `Delivery Terms : ${data.terms.delivery_terms}` : '',
      data.terms?.freight_terms ? `Freight Terms : ${data.terms.freight_terms}` : '',
      Number(data.freightAmount || 0) > 0 ? `Freight Value : ${this.fmtCur(data.freightAmount)}` : '',
      data.freightGstApplicable ? `Freight GST : Applicable @ ${this.fmtNum(data.freightGstPercent || 0)}% (${this.fmtCur(data.freightGstAmount || 0)})` : '',
      Number(data.additionalExpenses || 0) > 0 ? `Additional Expenses : ${this.fmtCur(data.additionalExpenses)}` : '',
    ].filter(Boolean);
    return this.wrapMultiline(terms.length ? terms.join('\n') : '-', (USABLE - 12) / 2 - 12, 7.2, font);
  }

  private referenceInstructionLines(ctx: any): string[] {
    const { font, data } = ctx;
    const instructions = data.specialInstructions || data.remarks || '-';
    return this.wrapMultiline(instructions, (USABLE - 12) / 2 - 12, 7.2, font);
  }

  private async referenceEnsureSpace(state: PageState, needed: number, ctx: any, cols?: any[], tw?: number): Promise<PageState> {
    if (state.y - needed >= MY_BOT + 20) return state;
    let next = await this.newPage(ctx);
    next = this.drawHeader(next, ctx);
    if (cols && tw) next = this.drawReferenceTableHeader(next, cols, tw, ctx.fontBold);
    return next;
  }

  private drawReferenceTableHeader(state: PageState, cols: any[], tw: number, fontBold: PDFFont): PageState {
    const h = 22;
    state.page.drawRectangle({ x: MX, y: state.y - h, width: tw, height: h, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    let x = MX;
    for (const col of cols) {
      state.page.drawLine({ start: { x, y: state.y }, end: { x, y: state.y - h }, thickness: 0.35, color: BORDER });
      const lines = String(col.title).split('\n');
      lines.forEach((line: string, idx: number) => {
        this.cellText(state.page, line, x, state.y - 9 - idx * 8, col.width, 'center', fontBold, 6.8, DARK);
      });
      x += col.width;
    }
    state.page.drawLine({ start: { x, y: state.y }, end: { x, y: state.y - h }, thickness: 0.35, color: BORDER });
    return { ...state, y: state.y - h };
  }

  private drawReferenceBox(page: PDFPage, x: number, top: number, width: number, height: number, title: string, fontBold: PDFFont) {
    page.drawRectangle({ x, y: top - height, width, height, borderColor: BORDER, borderWidth: 0.5 });
    page.drawText(title, { x: x + 6, y: top - 12, size: 7.5, font: fontBold, color: DARK });
    page.drawLine({ start: { x, y: top - 18 }, end: { x: x + width, y: top - 18 }, thickness: 0.35, color: BORDER });
  }

  private drawReferenceLines(page: PDFPage, lines: string[], x: number, y: number, width: number, font: PDFFont, fontBold: PDFFont) {
    let cy = y;
    for (const line of lines) {
      const isName = line.startsWith('Name :');
      for (const part of this.wrapText(line, width, 7.3, isName ? fontBold : font)) {
        page.drawText(part, { x, y: cy, size: 7.3, font: isName ? fontBold : font, color: DARK });
        cy -= 9;
      }
    }
  }

  private composeReferenceDescription(item: POItem): string {
    const lines = [
      item.item_name || item.description || '-',
      item.item_code ? `SAS Part Number-${item.item_code}` : '',
      item.description && item.description !== item.item_name ? item.description : '',
      item.specifications || '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private itemTaxAmount(item: POItem): number {
    return (Number(item.cgst_amount || 0) || 0) + (Number(item.sgst_amount || 0) || 0) + (Number(item.igst_amount || 0) || 0);
  }

  private referenceTaxLines(item: POItem): string[] {
    const igst = Number(item.igst_rate || 0) || 0;
    if (igst > 0) return [`IGST`, `${this.fmtNum(igst)}%`];
    const cgst = Number(item.cgst_rate || 0) || 0;
    const sgst = Number(item.sgst_rate || 0) || 0;
    if (cgst || sgst) return [`CGST ${this.fmtNum(cgst)}%`, `SGST ${this.fmtNum(sgst)}%`];
    return ['-'];
  }

  private async ensureSpace(
    state: PageState, needed: number, ctx: any,
    repeatTableHdr = false, cols?: any[], tw?: number,
  ): Promise<PageState> {
    if (state.y - needed >= MY_BOT + 20) return state;
    let s = await this.newPage(ctx);
    s = this.drawHeader(s, ctx);
    if (repeatTableHdr && cols && tw) s = this.drawTableHeader(s, cols, tw, ctx.fontBold);
    return s;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     HEADER  (company info + logos + blue PURCHASE ORDER bar)
     ═══════════════════════════════════════════════════════════════════════════*/

  private drawHeader(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, branding, data } = ctx;
    const nextY = this.documentBrandingService.drawStandardHeader({
      page,
      topY: state.y,
      marginX: MX,
      width: USABLE,
      title: data.isServiceOrder ? 'SERVICE ORDER' : 'PURCHASE ORDER',
      reference: `${data.poNumber}${data.revision ? `  Rev.${data.revision}` : ''}`,
      branding,
      font,
      fontBold,
      assets: ctx.assets,
    });

    return { ...state, y: nextY };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ADDRESS BLOCKS  (Vendor + Reference side-by-side)
     ═══════════════════════════════════════════════════════════════════════════*/

  private drawAddressBlocks(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, data } = ctx;
    const gap = 10;
    const vendorColW = Math.floor((USABLE - gap) * 0.60); // ~313
    const refColW    = USABLE - gap - vendorColW;          // ~200

    const vLines = [
      data.vendorName,
      data.vendorAddress || '',
      data.vendorStreet || '',
      [data.vendorCity, data.vendorState, data.vendorPincode].filter(Boolean).join(', '),
      data.vendorGSTIN ? `GSTIN : ${data.vendorGSTIN}` : '',
      data.vendorEmail ? `Email : ${data.vendorEmail}` : '',
      data.vendorPhone ? `Phone : ${data.vendorPhone}` : '',
      data.vendorContactPerson ? `Contact : ${formatVendorContactName(data.vendorSalutation, data.vendorContactPerson)}` : '',
    ].filter(Boolean);

    const rLines = [
      `PO No. : ${data.poNumber}`,
      `Date : ${this.fmtDate(data.poDate)}`,
      data.deliveryDate ? `Delivery Date : ${this.fmtDate(data.deliveryDate)}` : '',
      `Quotation Ref No. : ${data.quotationRef || '-'}`,
      data.prNumber ? `PR No. : ${data.prNumber}` : '',
      `Project : ${data.projectName || '-'}`,
    ].filter(Boolean);

    const vCount = this.countWrapped(vLines, vendorColW - 16, 8, font);
    const rCount = this.countWrapped(rLines, refColW - 16, 8, font);
    const blockH = Math.max(100, 24 + Math.max(vCount, rCount) * 10 + 8);

    // Left — VENDOR
    const lx = MX;
    this.drawBlock(page, lx, state.y, vendorColW, blockH, 'VENDOR  (Ship From)', fontBold);
    let ly = state.y - 24;
    for (let i = 0; i < vLines.length; i++) {
      const sz = i === 0 ? 9 : 8;
      const f  = i === 0 ? fontBold : font;
      for (const part of this.wrapText(vLines[i], vendorColW - 16, sz, f)) {
        page.drawText(part, { x: lx + 8, y: ly, size: sz, font: f, color: i === 0 ? DARK : GRAY });
        ly -= 10;
      }
    }

    // Right — REFERENCE
    const rx = MX + vendorColW + gap;
    this.drawBlock(page, rx, state.y, refColW, blockH, 'REFERENCE', fontBold);
    let ry = state.y - 24;
    for (const line of rLines) {
      for (const part of this.wrapText(line, refColW - 16, 8, font)) {
        page.drawText(part, { x: rx + 8, y: ry, size: 8, font, color: GRAY });
        ry -= 10;
      }
    }

    return { ...state, y: state.y - blockH - 6 };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DELIVERY ADDRESS BAR
     ═══════════════════════════════════════════════════════════════════════════*/

  private drawDeliveryBar(state: PageState, ctx: any): PageState {
    const { page } = state;
    const { font, fontBold, data } = ctx;
    const delText = [
      data.deliveryAddress || data.companyAddress,
      [data.deliveryCity || data.companyCity, data.deliveryState || data.companyState, data.deliveryPincode || data.companyPincode].filter(Boolean).join(', '),
    ].filter(Boolean).join(', ');
    const wrapped = this.wrapText(delText || 'Same as company address', USABLE - 16, 7.5, font);
    const headerH = 16;
    const barH    = Math.max(28, headerH + wrapped.length * 10 + 10);

    page.drawRectangle({ x: MX, y: state.y - barH, width: USABLE, height: barH,
      color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x: MX, y: state.y - headerH, width: USABLE, height: headerH, color: BRAND });
    page.drawText('Delivery Address', { x: MX + 8, y: state.y - 11, size: 8, font: fontBold, color: WHITE });
    let dy = state.y - headerH - 12;
    for (const line of wrapped) {
      page.drawText(line, { x: MX + 8, y: dy, size: 7.5, font, color: DARK });
      dy -= 10;
    }

    return { ...state, y: state.y - barH - 6 };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ITEMS TABLE  (columns fit exactly within USABLE width)
     ═══════════════════════════════════════════════════════════════════════════*/

  private async drawItemsTable(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;

    // Column widths total exactly 523 = USABLE
    const cols = [
      { key: 'sl',     title: 'Sl.',           width: 18,  align: 'center' as const },
      { key: 'desc',   title: 'Description',   width: 114, align: 'left'   as const },
      { key: 'hsn',    title: 'HSN',           width: 54,  align: 'center' as const },
      { key: 'qty',    title: 'Qty',           width: 26,  align: 'right'  as const },
      { key: 'uom',    title: 'UOM',           width: 24,  align: 'center' as const },
      { key: 'rate',   title: 'Rate',          width: 48,  align: 'right'  as const },
      { key: 'disc',   title: 'Disc %',        width: 26,  align: 'right'  as const },
      { key: 'gst',    title: 'Tax Type',      width: 54,  align: 'center' as const },
      { key: 'taxAmt', title: 'Taxable Amt',   width: 56,  align: 'right'  as const },
      { key: 'gstAmt', title: 'GST Amt',       width: 50,  align: 'right'  as const },
      { key: 'amt',    title: 'Amount',        width: 53,  align: 'right'  as const },
    ];
    const tw = cols.reduce((s, c) => s + c.width, 0);

    state = await this.ensureSpace(state, 40, ctx);
    state = this.drawTableHeader(state, cols, tw, fontBold);

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const desc = this.composeDescription(item);
      const descCol = cols.find(c => c.key === 'desc')!;
      const descLines = this.wrapText(desc, descCol.width - 6, 7, font);
      const igstRate = Number(item.igst_rate || 0);
      const cgstRate = Number(item.cgst_rate || 0);
      const sgstRate = Number(item.sgst_rate || 0);
      const gstLines: string[] = igstRate > 0
        ? [`IGST`, `${this.fmtNum(igstRate)}%`]
        : [`CGST ${this.fmtNum(cgstRate)}%`, `SGST ${this.fmtNum(sgstRate)}%`];
      const rowH = Math.max(18, Math.max(descLines.length, gstLines.length) * 9 + 4);

      state = await this.ensureSpace(state, rowH + 2, ctx, true, cols, tw);
      const rowY = state.y;

      // Alternating row background
      state.page.drawRectangle({ x: MX, y: rowY - rowH, width: tw, height: rowH,
        color: i % 2 === 1 ? ROW_ALT : WHITE, borderColor: BORDER, borderWidth: 0.4 });

      // Vertical cell dividers
      let lx = MX;
      for (const c of cols) {
        state.page.drawLine({ start: { x: lx, y: rowY }, end: { x: lx, y: rowY - rowH }, thickness: 0.4, color: BORDER });
        lx += c.width;
      }
      state.page.drawLine({ start: { x: lx, y: rowY }, end: { x: lx, y: rowY - rowH }, thickness: 0.4, color: BORDER });

      // Cell values
      const itemGstAmt =
        (Number(item.cgst_amount || 0) || 0) +
        (Number(item.sgst_amount || 0) || 0) +
        (Number(item.igst_amount || 0) || 0);
      const vals: Record<string, string> = {
        sl: String(item.sl_no || i + 1),
        desc: '',
        hsn: item.hsn_code || '',
        qty: this.fmtNum(item.quantity),
        uom: item.uom || '',
        rate: this.fmtCur(item.unit_price),
        disc: this.fmtNum(item.discount_percent || 0),
        gst: this.fmtNum(this.resolveGst(item)),
        taxAmt: this.fmtCur(Number(item.taxable_amount || 0)),
        gstAmt: this.fmtCur(itemGstAmt),
        amt: this.fmtCur(item.total_price),
      };

      let cx = MX;
      for (const c of cols) {
        if (c.key === 'desc') {
          this.drawWrappedLines(state.page, descLines, cx + 3, rowY - 10, c.width - 6, 7, font, 9);
        } else if (c.key === 'gst') {
          this.drawWrappedLines(state.page, gstLines, cx + 3, rowY - 10, c.width - 6, 6.5, font, 9);
        } else {
          this.cellText(state.page, vals[c.key] || '', cx, rowY - 12, c.width, c.align, font, c.key === 'sl' ? 7 : 7.5);
        }
        cx += c.width;
      }
      state.y -= rowH;
    }

    // ── Totals row (bold white on navy) ──
    state = await this.ensureSpace(state, 22, ctx);
    state.page.drawRectangle({ x: MX, y: state.y - 20, width: tw, height: 20, color: BRAND });
    state.page.drawText('TOTAL', { x: MX + 10, y: state.y - 14, size: 9, font: fontBold, color: WHITE });
    const totalStr = this.fmtCur(data.grandTotal);
    const totalW   = fontBold.widthOfTextAtSize(totalStr, 9);
    state.page.drawText(totalStr, { x: MX + tw - totalW - 6, y: state.y - 14, size: 9, font: fontBold, color: WHITE });

    return { ...state, y: state.y - 26 };
  }

  private drawTableHeader(state: PageState, cols: any[], tw: number, fb: PDFFont): PageState {
    const h = 18;
    state.page.drawRectangle({ x: MX, y: state.y - h, width: tw, height: h, color: BRAND });
    let hx = MX;
    for (const c of cols) {
      this.cellText(state.page, c.title, hx, state.y - 12, c.width, 'center', fb, 7, WHITE);
      hx += c.width;
    }
    return { ...state, y: state.y - h };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SUMMARY BLOCK  (Remarks left + Amount Summary right + Amount in Words)
     ═══════════════════════════════════════════════════════════════════════════*/

  private async drawSummaryBlock(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;
    const gap    = 8;
    const leftW  = Math.round(USABLE * 0.60);
    const rightW = USABLE - leftW - gap;

    // Build summary rows
    const rows: [string, number][] = [
      ['Subtotal', data.subtotal],
      ['Discount', data.totalDiscount || 0],
      ['Taxable Amount', data.taxableAmount],
    ];
    const hasIgst = !!(data.igstTotal && data.igstTotal > 0);
    if (hasIgst) {
      rows.push(['IGST', data.igstTotal!]);
    } else {
      rows.push(['CGST', data.cgstTotal || 0]);
      rows.push(['SGST', data.sgstTotal || 0]);
    }
    if (data.freightAmount) rows.push(['Freight Value', data.freightAmount]);
    if (data.freightGstAmount) rows.push([`Freight GST @ ${this.fmtNum(data.freightGstPercent || 0)}%`, data.freightGstAmount]);
    if (data.customsDuty) rows.push(['Customs Duty', data.customsDuty]);
    if (data.additionalExpenses) rows.push(['Additional Expenses', data.additionalExpenses]);
    if (Math.abs(this.safeNumber(data.roundOff)) >= 0.01) rows.push(['Rounding', data.roundOff]);
    rows.push(['Grand Total', data.grandTotal]);

    const remarkText  = data.specialInstructions || data.remarks || '-';
    const remarkLines = this.wrapMultiline(remarkText, leftW - 16, 7.5, font);
    const boxH = Math.max(26 + rows.length * 12 + 8, 28 + remarkLines.length * 10 + 8);

    state = await this.ensureSpace(state, boxH + 30, ctx);
    const top = state.y;

    // Left — Remarks
    state.page.drawRectangle({ x: MX, y: top - boxH, width: leftW, height: boxH, borderColor: BORDER, borderWidth: 0.6 });
    state.page.drawRectangle({ x: MX, y: top - 16, width: leftW, height: 16, color: BRAND });
    state.page.drawText('Special Remark', { x: MX + 8, y: top - 12, size: 7.5, font: fontBold, color: WHITE });
    this.drawWrappedLines(state.page, remarkLines, MX + 8, top - 28, leftW - 16, 7.5, font, 10);

    // Right — Amount Summary
    const rx = MX + leftW + gap;
    state.page.drawRectangle({ x: rx, y: top - boxH, width: rightW, height: boxH, borderColor: BORDER, borderWidth: 0.6 });
    state.page.drawRectangle({ x: rx, y: top - 16, width: rightW, height: 16, color: BRAND });
    state.page.drawText('Amount Summary', { x: rx + 8, y: top - 12, size: 7.5, font: fontBold, color: WHITE });

    let sy = top - 30;
    for (const [label, value] of rows) {
      const isGrand = label === 'Grand Total';
      if (isGrand) state.page.drawRectangle({ x: rx + 2, y: sy - 4, width: rightW - 4, height: 14, color: BRAND });
      const f   = isGrand ? fontBold : font;
      const sz  = isGrand ? 8.5 : 7.5;
      const clr = isGrand ? WHITE : GRAY;
      state.page.drawText(label, { x: rx + 8, y: sy, size: sz, font: f, color: clr });
      const amtStr = this.fmtCur(value);
      const aw     = f.widthOfTextAtSize(amtStr, sz);
      state.page.drawText(amtStr, { x: rx + rightW - aw - 8, y: sy, size: sz, font: f, color: clr });
      sy -= 12;
    }

    // Amount in words bar
    state.y = top - boxH - 4;
    const words     = `Amount in Words: INR ${this.amountInWords(data.grandTotal)} Only`;
    const wordLines = this.wrapText(words, USABLE - 16, 7.5, fontBold);
    const wordBarH  = wordLines.length * 10 + 8;
    state.page.drawRectangle({ x: MX, y: state.y - wordBarH, width: USABLE, height: wordBarH,
      color: BRAND_LIGHT, borderColor: BORDER, borderWidth: 0.4 });
    this.drawWrappedLines(state.page, wordLines, MX + 8, state.y - 8, USABLE - 16, 7.5, fontBold, 10, BRAND);
    state.y -= wordBarH + 8;

    return state;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SHORT TERMS  (Statutory + Key Terms side-by-side)
     ═══════════════════════════════════════════════════════════════════════════*/

  private async drawShortTerms(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;
    const gap  = 10;
    const colW = (USABLE - gap) / 2;

    const statLines = [
      `GST No : ${data.companyGSTIN || '-'}`,
    ].filter(Boolean);

    const termLines = [
      `Payment : ${data.paymentTerms || data.terms?.payment_terms || '-'}`,
      `Delivery : ${data.terms?.delivery_terms || (data.deliveryDate ? this.fmtDate(data.deliveryDate) : '-')}`,
      `Freight : ${data.terms?.freight_terms || '-'}`,
    ].filter(Boolean);

    const lc   = this.countWrapped(statLines, colW - 12, 7.5, font);
    const rc   = this.countWrapped(termLines, colW - 12, 7.5, font);
    const barH = Math.max(36, 16 + Math.max(lc, rc) * 10 + 6);

    state = await this.ensureSpace(state, barH + 6, ctx);
    const top = state.y;

    // Left — Statutory
    state.page.drawRectangle({ x: MX, y: top - barH, width: colW, height: barH, borderColor: BORDER, borderWidth: 0.5 });
    state.page.drawRectangle({ x: MX, y: top - 14, width: colW, height: 14, color: BRAND });
    state.page.drawText('Statutory Details', { x: MX + 6, y: top - 11, size: 7, font: fontBold, color: WHITE });
    this.drawWrappedLines(state.page, statLines, MX + 6, top - 24, colW - 12, 7.5, font, 10);

    // Right — Key Terms
    const rx = MX + colW + gap;
    state.page.drawRectangle({ x: rx, y: top - barH, width: colW, height: barH, borderColor: BORDER, borderWidth: 0.5 });
    state.page.drawRectangle({ x: rx, y: top - 14, width: colW, height: 14, color: BRAND });
    state.page.drawText('Terms & Conditions', { x: rx + 6, y: top - 11, size: 7, font: fontBold, color: WHITE });
    this.drawWrappedLines(state.page, termLines, rx + 6, top - 24, colW - 12, 7.5, font, 10);

    return { ...state, y: top - barH - 8 };
  }

  private async drawGstSummary(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;
    const rows = this.buildGstSummaryRows(data.items);

    state = await this.newPage(ctx);
    state = this.drawHeader(state, ctx);

    if (rows.length === 0) {
      return state;
    }

    const cols = [
      { title: 'GST Rate', width: 100, align: 'left' as const },
      { title: 'Taxable Amount', width: 160, align: 'right' as const },
      { title: 'Tax', width: 120, align: 'right' as const },
    ];
    const tw = cols.reduce((sum, col) => sum + col.width, 0);
    const rowH = 16;

    state = await this.ensureSpace(state, 40 + rowH * (rows.length + 1), ctx);
    const top = state.y;

    state.page.drawRectangle({ x: MX, y: top - 16, width: tw, height: 16, color: BRAND });
    state.page.drawText('GST Summary', { x: MX + 8, y: top - 12, size: 7.5, font: fontBold, color: WHITE });

    let currentY = top - 16;
    let headerX = MX;
    state.page.drawRectangle({ x: MX, y: currentY - rowH, width: tw, height: rowH, color: BRAND_LIGHT, borderColor: BORDER, borderWidth: 0.4 });
    for (const col of cols) {
      this.cellText(state.page, col.title, headerX, currentY - 11, col.width, col.align, fontBold, 7, BRAND);
      state.page.drawLine({ start: { x: headerX, y: currentY }, end: { x: headerX, y: currentY - rowH }, thickness: 0.4, color: BORDER });
      headerX += col.width;
    }
    state.page.drawLine({ start: { x: headerX, y: currentY }, end: { x: headerX, y: currentY - rowH }, thickness: 0.4, color: BORDER });
    currentY -= rowH;

    for (const row of rows) {
      let cellX = MX;
      state.page.drawRectangle({ x: MX, y: currentY - rowH, width: tw, height: rowH, color: WHITE, borderColor: BORDER, borderWidth: 0.4 });
      const values = [row.rateLabel, this.fmtCur(row.taxableAmount), this.fmtCur(row.taxAmount)];
      cols.forEach((col, index) => {
        this.cellText(state.page, values[index], cellX, currentY - 11, col.width, col.align, font, 7.2, DARK);
        state.page.drawLine({ start: { x: cellX, y: currentY }, end: { x: cellX, y: currentY - rowH }, thickness: 0.4, color: BORDER });
        cellX += col.width;
      });
      state.page.drawLine({ start: { x: cellX, y: currentY }, end: { x: cellX, y: currentY - rowH }, thickness: 0.4, color: BORDER });
      currentY -= rowH;
    }

    state.page.drawLine({ start: { x: MX, y: currentY }, end: { x: MX + tw, y: currentY }, thickness: 0.4, color: BORDER });

    return { ...state, y: currentY - 10 };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     GENERAL TERMS & CONDITIONS  (numbered list, proper wrapping)
     ═══════════════════════════════════════════════════════════════════════════*/

  private async drawGeneralTerms(state: PageState, ctx: any): Promise<PageState> {
    const { font, fontBold, data } = ctx;
    const gap = 16;
    const colW = (USABLE - 24 - gap) / 2;
    const colXs = [MX + 12, MX + 12 + colW + gap];

    state = await this.ensureSpace(state, 50, ctx);
    // Section heading bar
    state.page.drawRectangle({ x: MX, y: state.y - 16, width: USABLE, height: 16, color: BRAND });
    const companyName = data.companyName || ctx.branding.companyName;
    const heading = this.fitText('General Terms and Conditions', USABLE - 20, fontBold, 7.5);
    state.page.drawText(heading, { x: MX + 8, y: state.y - 12, size: 7.5, font: fontBold, color: WHITE });
    state.y -= 24;

    const terms = this.getTerms(companyName);
    const splitAt = Math.ceil(terms.length / 2);
    const columns = [terms.slice(0, splitAt), terms.slice(splitAt)];
    const startY = state.y;

    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      let columnY = startY;
      const x = colXs[colIndex];
      const colTerms = columns[colIndex];

      for (let idx = 0; idx < colTerms.length; idx++) {
        const raw = colTerms[idx];
        const globalIndex = colIndex === 0 ? idx : splitAt + idx;
        const colonIdx = raw.indexOf(': ');
        const title = colonIdx > -1 ? raw.substring(0, colonIdx) : raw;
        const desc = colonIdx > -1 ? raw.substring(colonIdx + 2) : '';
        const titleLine = `${globalIndex + 1}. ${title}`;
        const descLines = desc ? this.wrapText(desc, colW - 10, 6.2, font) : [];

        state.page.drawText(titleLine, { x, y: columnY, size: 6.8, font: fontBold, color: DARK });
        columnY -= 8.2;
        if (descLines.length > 0) {
          this.drawJustifiedLines(state.page, descLines, x + 8, columnY, colW - 10, 6.2, font, 7.2, GRAY);
          columnY -= descLines.length * 7.2;
        }
        columnY -= 3.2;
      }

      state.y = Math.min(state.y, columnY);
    }

    state.y -= 4;
    return state;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SIGNATURE BLOCK
     ═══════════════════════════════════════════════════════════════════════════*/

  private async drawSignatureBlock(state: PageState, ctx: any): Promise<PageState> {
    const { fontBold, fontItalic, data } = ctx;
    const gap = 12;
    const boxW = Math.floor((USABLE - gap) / 2);
    const boxH = 42;

    state = await this.ensureSpace(state, boxH + 16, ctx);
    state.y -= 4;
    const top = state.y;

    const signers: [string, string][] = [
      ['Prepared By', data.preparedBy || '-'],
      ['Approved By', data.approvedBy || '-'],
    ];

    for (let i = 0; i < signers.length; i++) {
      const [label, value] = signers[i];
      const x = MX + i * (boxW + gap);
      state.page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, borderColor: BORDER, borderWidth: 0.6 });
      state.page.drawRectangle({ x, y: top - 14, width: boxW, height: 14, color: BRAND });
      state.page.drawText(label, { x: x + 8, y: top - 11, size: 7, font: fontBold, color: WHITE });
      state.page.drawText(this.fitText(value, boxW - 16, fontItalic, 7), { x: x + 8, y: top - boxH + 10, size: 7, font: fontItalic, color: GRAY });
    }

    return { ...state, y: top - boxH - 8 };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PAGE FOOTERS
     ═══════════════════════════════════════════════════════════════════════════*/

  private drawFooters(pages: PDFPage[], font: PDFFont, branding: DocumentBranding, assets?: PdfBrandingAssets) {
    for (let i = 0; i < pages.length; i++) {
      const page  = pages[i];
      const left  = `Page ${i + 1} of ${pages.length}`;
      const right = branding.footerText || 'Computer-generated PO - no physical signature required.';
      const contact = branding.footerContactLine || '';
      if (assets?.footerImage) {
        page.drawImage(assets.footerImage, {
          x: MX,
          y: MY_BOT - 2,
          width: PAGE_W - MX * 2,
          height: 28,
        });
        page.drawText(left, { x: MX, y: MY_BOT + 30, size: 6.5, font, color: MID_GRAY });
        continue;
      }
      page.drawLine({ start: { x: MX, y: MY_BOT + 10 }, end: { x: PAGE_W - MX, y: MY_BOT + 10 }, thickness: 0.5, color: BORDER });
      page.drawText(left, { x: MX, y: MY_BOT, size: 6.5, font, color: MID_GRAY });
      const fittedRight = this.fitText(contact ? `${right} | ${contact}` : right, PAGE_W - MX * 2 - 80, font, 6);
      const rw = font.widthOfTextAtSize(fittedRight, 6);
      page.drawText(fittedRight, { x: PAGE_W - MX - rw, y: MY_BOT, size: 6, font, color: MID_GRAY });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DRAWING HELPERS
     ═══════════════════════════════════════════════════════════════════════════*/

  private drawBlock(page: PDFPage, x: number, topY: number, w: number, h: number, label: string, fb: PDFFont) {
    page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: BORDER, borderWidth: 0.6 });
    page.drawRectangle({ x, y: topY - 16, width: w, height: 16, color: BRAND });
    page.drawText(label, { x: x + 8, y: topY - 12, size: 7.5, font: fb, color: WHITE });
  }

  private drawWrappedLines(page: PDFPage, lines: string[], x: number, y: number, _w: number, _fs: number, font: PDFFont, lh: number, color = GRAY) {
    let cy = y;
    for (const line of lines) { page.drawText(line, { x, y: cy, size: _fs, font, color }); cy -= lh; }
  }

  private drawJustifiedLines(page: PDFPage, lines: string[], x: number, y: number, maxW: number, fs: number, font: PDFFont, lh: number, color = GRAY) {
    let cy = y;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (isLast || line.trim() === '') {
        page.drawText(line, { x, y: cy, size: fs, font, color });
      } else {
        const words = line.split(' ').filter(w => w.length > 0);
        if (words.length <= 1) {
          page.drawText(line, { x, y: cy, size: fs, font, color });
        } else {
          const totalTextW = words.reduce((s, w) => s + font.widthOfTextAtSize(w, fs), 0);
          const gap = (maxW - totalTextW) / (words.length - 1);
          let cx = x;
          for (const word of words) {
            page.drawText(word, { x: cx, y: cy, size: fs, font, color });
            cx += font.widthOfTextAtSize(word, fs) + gap;
          }
        }
      }
      cy -= lh;
    }
  }

  private cellText(page: PDFPage, text: string, x: number, y: number, w: number, align: 'left' | 'right' | 'center', font: PDFFont, sz: number, color = GRAY) {
    const safe = this.fitText(text, Math.max(w - 6, 0), font, sz);
    const tw   = font.widthOfTextAtSize(safe, sz);
    const dx   = align === 'right' ? x + w - tw - 3 : align === 'center' ? x + (w - tw) / 2 : x + 3;
    page.drawText(safe, { x: dx, y, size: sz, font, color });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     TEXT UTILITIES
     ═══════════════════════════════════════════════════════════════════════════*/

  private wrapText(text: string, width: number, fontSize: number, font: PDFFont): string[] {
    const norm = String(text || '').replace(/\s+/g, ' ').trim();
    if (!norm) return [''];
    const words = norm.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(cand, fontSize) <= width) { cur = cand; continue; }
      if (cur) lines.push(cur);
      if (font.widthOfTextAtSize(w, fontSize) <= width) { cur = w; continue; }
      // Break long word
      let seg = '';
      for (const ch of w) {
        if (font.widthOfTextAtSize(seg + ch, fontSize) <= width) { seg += ch; } else { if (seg) lines.push(seg); seg = ch; }
      }
      cur = seg;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Like wrapText but preserves explicit newlines */
  private wrapMultiline(text: string, width: number, fontSize: number, font: PDFFont): string[] {
    const raw = String(text || '').trim();
    if (!raw) return [''];
    const result: string[] = [];
    for (const paragraph of raw.split(/\r?\n/)) {
      result.push(...this.wrapText(paragraph, width, fontSize, font));
    }
    return result;
  }

  private fitText(text: string, width: number, font: PDFFont, fontSize: number): string {
    const s = String(text || '').trim();
    if (!s || width <= 0) return '';
    if (font.widthOfTextAtSize(s, fontSize) <= width) return s;
    let t = '';
    for (const ch of s) { if (font.widthOfTextAtSize(t + ch + '...', fontSize) > width) break; t += ch; }
    return t ? t + '...' : '';
  }

  private countWrapped(lines: string[], w: number, fs: number, font: PDFFont): number {
    return lines.reduce((n, l) => n + this.wrapText(l, w, fs, font).length, 0);
  }

  private buildGstSummaryRows(items: POItem[]): Array<{ rateLabel: string; taxableAmount: number; taxAmount: number }> {
    const summary = new Map<string, { rate: number; taxableAmount: number; taxAmount: number }>();

    for (const item of items || []) {
      const rate = Number(this.resolveGst(item)) || 0;
      const taxableAmount = Number(item.taxable_amount || 0) || 0;
      const taxAmount =
        (Number(item.cgst_amount || 0) || 0) +
        (Number(item.sgst_amount || 0) || 0) +
        (Number(item.igst_amount || 0) || 0);
      const key = `${rate.toFixed(2)}`;
      const existing = summary.get(key) || { rate, taxableAmount: 0, taxAmount: 0 };
      existing.taxableAmount += taxableAmount;
      existing.taxAmount += taxAmount;
      summary.set(key, existing);
    }

    return Array.from(summary.values())
      .sort((left, right) => left.rate - right.rate)
      .map((row) => ({
        rateLabel: `${this.fmtNum(row.rate)}%`,
        taxableAmount: row.taxableAmount,
        taxAmount: row.taxAmount,
      }));
  }

  private composeDescription(item: POItem): string {
    const code = String(item.item_code || '').trim();
    const parts = [item.item_name, item.description, item.specifications]
      .map(v => String(v || '').trim()).filter(Boolean);
    const deduped = parts.filter((p, i) => parts.findIndex(c => c.toLowerCase() === p.toLowerCase()) === i).join(' | ');
    return code ? `[${code}] ${deduped}` : deduped;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     NUMBER FORMATTING  (Indian comma system: 12,34,567.89)
     ═══════════════════════════════════════════════════════════════════════════*/

  private fmtCur(value: number): string {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return this.indianFormat(n);
  }

  private safeNumber(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private withRoundedGrandTotal(data: POPdfData): POPdfData {
    const exactGrandTotal = this.safeNumber(data.grandTotal);
    const suppliedRoundOff = this.safeNumber(data.roundOff);
    const roundedGrandTotal = Math.round(exactGrandTotal);
    const roundOff = Math.abs(suppliedRoundOff) >= 0.01
      ? Number(suppliedRoundOff.toFixed(2))
      : Number((roundedGrandTotal - exactGrandTotal).toFixed(2));

    return {
      ...data,
      roundOff: Math.abs(roundOff) >= 0.01 ? roundOff : 0,
      grandTotal: roundedGrandTotal,
    };
  }

  private fmtNum(value: number): string {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }

  /** Format number with Indian comma grouping: 12,34,567.89 */
  private indianFormat(num: number): string {
    const neg = num < 0;
    const [intPart, dec] = Math.abs(num).toFixed(2).split('.');
    if (intPart.length <= 3) return `${neg ? '-' : ''}${intPart}.${dec}`;
    const last3 = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    const groups: string[] = [];
    while (rest.length > 2) { groups.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) groups.unshift(rest);
    return `${neg ? '-' : ''}${groups.join(',')},${last3}.${dec}`;
  }

  private fmtDate(value?: string): string {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    // Use UTC to avoid timezone shifting on YYYY-MM-DD date strings
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(2);
    return `${dd}/${mm}/${yy}`;
  }

  private resolveGst(item: POItem): number {
    return Number(item.igst_rate || 0) || Number(item.cgst_rate || 0) + Number(item.sgst_rate || 0);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     AMOUNT IN WORDS  (Indian Crore-Lakh system)
     ═══════════════════════════════════════════════════════════════════════════*/

  private amountInWords(amount: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const twoDigit = (n: number) => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');

    const n = Math.round(Math.abs(amount));
    if (n === 0) return 'Zero';

    const crore = Math.floor(n / 10000000);
    const lakh  = Math.floor((n % 10000000) / 100000);
    const thou  = Math.floor((n % 100000) / 1000);
    const hund  = Math.floor((n % 1000) / 100);
    const rem   = n % 100;

    const p: string[] = [];
    if (crore) p.push(twoDigit(crore) + ' Crore');
    if (lakh)  p.push(twoDigit(lakh)  + ' Lakh');
    if (thou)  p.push(twoDigit(thou)  + ' Thousand');
    if (hund)  p.push(ones[hund]       + ' Hundred');
    if (rem)   p.push(twoDigit(rem));

    return p.join(' ') + ' Rupees';
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     GENERAL TERMS TEXT
     ═══════════════════════════════════════════════════════════════════════════*/

  private getTerms(companyName: string): string[] {
    return [
      'Acceptance of Order: The supplier must confirm acceptance of this Purchase Order (PO) via email within 7 days of issuance. Failure to respond within this period shall be deemed as unconditional acceptance of all terms and conditions stated herein.',
      `Confidentiality & Ownership: All drawings, designs, and documents shared with this PO are the exclusive and confidential property of ${companyName}. Any unauthorized use, reproduction, or disclosure to third parties will constitute a breach of contract and may result in legal action.`,
      'Scope, Specifications & Compliance: Materials must strictly conform to the specifications, drawings, quality standards, and requirements mentioned in the PO. Any deviation must be approved in writing by the buyer prior to execution.',
      'Inspection & Rejection: The buyer reserves the right to inspect the materials upon receipt. Any material not meeting specifications or quality standards may be rejected, and the supplier shall be responsible for replacement/removal at their own cost.',
      'Delivery Schedule & Liquidated Damages: Delivery must be completed as per the agreed schedule. In case of delay, liquidated damages will be charged at 0.5% per day, subject to a maximum of 10% of the total order value.',
      'Invoicing Requirements: All invoices must clearly mention the PO number, product name, and serial number exactly as per the PO. Non-compliance may result in delays in GRN processing and payment.',
      'Packaging & Transit Responsibility: The supplier shall ensure adequate packaging to prevent damage during transit. Any loss or damage in transit shall be borne by the supplier.',
      'Payment Terms: Payment shall be processed as per the terms specified in the PO, subject to successful delivery, inspection, acceptance of materials, and submission of compliant invoices.',
      'Taxes & Statutory Compliance: The supplier shall comply with all applicable laws, taxes, duties, and statutory requirements in force.',
      "Jurisdiction & Dispute Resolution: Any disputes arising out of this PO shall be subject to the jurisdiction of the buyer's registered location.",
    ];
  }
}
