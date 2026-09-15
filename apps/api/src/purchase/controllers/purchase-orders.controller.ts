import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { PurchaseOrdersService } from '../services/purchase-orders.service';
import { WorldClassPoPdfService } from '../services/world-class-po-pdf.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DocumentBrandingService } from '../../common/services/document-branding.service';
import { DuplicateDetectionService } from '../../common/services/duplicate-detection.service';

const PAYMENT_TERMS_LABELS: Record<string, string> = {
  NET_15: 'Net 15 Days',
  NET_30: 'Net 30 Days',
  NET_45: 'Net 45 Days',
  NET_60: 'Net 60 Days',
  NET_90: 'Net 90 Days',
  ADVANCE: 'Advance Payment',
  COD: 'Cash on Delivery',
  AGAINST_DELIVERY: 'Against Delivery',
  AGAINST_PROFORMA: 'Against Proforma Invoice',
  IMMEDIATE: 'Immediate Payment',
};

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function normalizeRoleName(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function hasSuperAdminBypass(user: any): boolean {
  const directRole = user?.role;
  if (typeof directRole === 'string' && normalizeRoleName(directRole) === 'SUPER_ADMIN') {
    return true;
  }

  if (isRecord(directRole) && normalizeRoleName(directRole.name) === 'SUPER_ADMIN') {
    return true;
  }

  const roleEntries = Array.isArray(user?.roles) ? user.roles : [];
  return roleEntries.some((entry: any) => {
    const roleObj = entry?.role || entry;
    return normalizeRoleName(roleObj?.name) === 'SUPER_ADMIN';
  });
}
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequireApprove, RequireDelete, RequireCreate, RequireUpdate } from '../../auth/decorators/permissions.decorator';

@Controller('purchase/orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly poService: PurchaseOrdersService,
    private readonly worldClassPoPdfService: WorldClassPoPdfService,
    private readonly documentBrandingService: DocumentBrandingService,
    private readonly duplicateDetectionService: DuplicateDetectionService,
  ) {}

  @Post('check-duplicates')
  async checkDuplicates(@Request() req: any, @Body() poData: any) {
    const existing = await this.poService.findAll(req.user.tenantId, {});
    
    // Check for same vendor + items within last 7 days
    const recentPOs = existing.filter((po: any) => {
      const vendorId = poData.vendorId ?? poData.vendor_id;
      if (!vendorId) return false;
      if (po.vendor_id !== vendorId) return false;
      const daysDiff = Math.abs(new Date().getTime() - new Date(po.created_at).getTime()) / (1000 * 3600 * 24);
      return daysDiff <= 7;
    });
    
    if (recentPOs.length === 0) {
      return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
    }
    
    const incomingLines = (poData.items ?? []).map((item: any) => {
      const code = item.itemCode ?? item.item_code ?? item.itemId ?? item.item_id ?? '';
      const qty = item.orderedQty ?? item.ordered_qty ?? item.quantity ?? 0;
      return `${String(code)}:${Number(qty)}`;
    });
    const incomingKey = incomingLines.filter(Boolean).sort().join('|');

    // Check if items match (code + ordered qty)
    for (const recentPO of recentPOs) {
      const lines = (recentPO.purchase_order_items ?? []).map((row: any) => {
        const code = row.item_code ?? row.item_id ?? '';
        const qty = row.ordered_qty ?? row.quantity ?? 0;
        return `${String(code)}:${Number(qty)}`;
      });
      const key = lines.filter(Boolean).sort().join('|');

      if (incomingKey.length > 0 && key.length > 0 && key === incomingKey) {
        return {
          hasDuplicates: true,
          exactMatches: [
            {
              id: recentPO.id,
              matchScore: 100,
              matchedFields: ['vendor_id', 'items'],
              data: recentPO,
            },
          ],
          fuzzyMatches: [],
          message: 'Identical PO with same vendor and items created in last 7 days',
        };
      }
    }
    
    return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };
  }

  @Post()
  @RequireCreate('purchase_orders')
  async create(@Request() req: any, @Body() body: any) {
    return this.poService.create(req.user.tenantId, req.user.userId, body);
  }

  @Get()
  async findAll(@Request() req: any, @Query() query: any) {
    return this.poService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.poService.findOne(req.user.tenantId, id);
  }

  @Put(':id')
  @RequireUpdate('purchase_orders')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    return this.poService.update(req.user.tenantId, id, body, req.user);
  }

  @Post(':id/status')
  @RequireUpdate('purchase_orders')
  async updateStatus(@Request() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    const nextStatus = String(body?.status || '').trim().toUpperCase();
    if (nextStatus === 'APPROVED' || nextStatus === 'REJECTED') {
      throw new ForbiddenException('Use the dedicated approval endpoint for approve or reject actions');
    }
    return this.poService.updateStatus(req.user.tenantId, id, body.status, req.user.userId);
  }

  @Post(':id/approve')
  @RequireApprove('purchase_orders')
  async approve(@Request() req: any, @Param('id') id: string) {
    return this.poService.updateStatus(req.user.tenantId, id, 'APPROVED', req.user.userId, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/reject')
  @RequireApprove('purchase_orders')
  async reject(@Request() req: any, @Param('id') id: string) {
    return this.poService.updateStatus(req.user.tenantId, id, 'REJECTED', req.user.userId, {
      overrideMakerChecker: hasSuperAdminBypass(req.user),
    });
  }

  @Post(':id/tracking')
  async updateTracking(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      tracking_number?: string;
      shipped_date?: string;
      estimated_delivery_date?: string;
      actual_delivery_date?: string;
      carrier_name?: string;
      tracking_url?: string;
      delivery_status?: string;
    }
  ) {
    return this.poService.updateTracking(req.user.tenantId, id, body);
  }

  @Post(':id/send-email')
  async sendPOEmail(@Request() req: any, @Param('id') id: string, @Body() body?: any) {
    return this.poService.sendPOEmail(req.user.tenantId, id, body);
  }

  @Post(':id/preview-email')
  async previewPOEmail(@Request() req: any, @Param('id') id: string, @Body() body?: any) {
    return this.poService.previewPOEmail(req.user.tenantId, id, body);
  }

  @Post(':id/send-tracking-reminder')
  async sendTrackingReminder(@Request() req: any, @Param('id') id: string) {
    return this.poService.sendTrackingReminder(req.user.tenantId, id);
  }

  @Get(':id/pdf/world-class')
  async generateWorldClassPdf(@Request() req: any, @Param('id') id: string, @Res() res: Response) {
    try {
      // Fetch PO with all details
      const po = await this.poService.findOne(req.user.tenantId, id);

      if (!po) {
        return res.status(404).json({ message: 'Purchase Order not found' });
      }

      // Map PO data to PDF data structure
      const safeNumber = (value: any): number => {
        const n = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(n) ? n : 0;
      };
      const branding = await this.documentBrandingService.getBranding(req.user.tenantId);
      const vendorBillingLine2 = po.vendor?.billing_line2 || po.vendor?.metadata?.billingLine2 || '';

      const pdfData = {
        // Header
        poNumber: po.po_number,
        poDate: po.po_date || po.order_date,
        quotationRef: po.quotation_ref,
        prNumber: po.pr?.pr_number || po.pr_number || undefined,

        // Vendor Details
        vendorName: (po.vendor?.name || po.vendor_name || 'N/A') + ((po.vendor?.code || po.vendor_code) ? ` - ${po.vendor?.code || po.vendor_code}` : ''),
        vendorCode: undefined,
        vendorAddress: vendorBillingLine2,
        vendorStreet: po.vendor?.street || po.vendor?.address || '',
        vendorCity: po.vendor?.city,
        vendorState: po.vendor?.state,
        vendorPincode: po.vendor?.pincode,
        vendorGSTIN: po.vendor?.tax_id || po.vendor?.gstin,
        vendorPAN: po.vendor?.pan,
        vendorEmail: po.vendor?.email,
        vendorPhone: po.vendor?.phone,
        vendorContactPerson: po.vendor?.contact_person,

        // Company Details (Delivery Address - Works)
        companyName: branding.companyName,
        companyAddress: branding.address,
        companyCity: '',
        companyState: '',
        companyPincode: '',
        companyGSTIN: branding.taxId,
        companyEmail: branding.email,
        companyPhone: branding.phone,
        companyWebsite: branding.website,

        // Delivery Contact (Consignee POC)
        deliveryAddress: po.delivery_address,
        deliveryContactPerson: po.delivery_contact_person || null,
        deliveryPhone: po.delivery_contact_phone || null,

        // Items
        items: (po.purchase_order_items || po.items || []).map((row: any, index: number) => {
          const quantity = safeNumber(row.ordered_qty ?? row.quantity ?? row.orderedQuantity ?? 0);
          const discountPercent = safeNumber(row.discount_percent ?? row.discountPercent ?? 0) || 0;
          const taxPercent = safeNumber(row.tax_percent ?? row.taxPercent ?? row.tax_rate ?? row.taxRate ?? 0) || 0;

          const storedAmount = safeNumber(row.amount ?? row.total_price ?? row.total ?? row.totalPrice ?? 0);

          // Prefer explicit rate; if missing/zero but we have amount+qty, derive rate for printing.
          let unitPrice = safeNumber(row.rate ?? row.unit_price ?? row.unitPrice ?? row.price ?? 0);
          if (unitPrice <= 0 && quantity > 0 && storedAmount > 0) {
            unitPrice = storedAmount / quantity;
          }

          const baseAmount = quantity > 0 && unitPrice > 0 ? quantity * unitPrice : storedAmount;
          const discountAmount = Math.max(0, safeNumber(row.discount_amount ?? row.discountAmount) || baseAmount * (discountPercent / 100));
          const taxableAmount = Math.max(0, baseAmount - discountAmount);

          // Compute GST amounts from taxable + tax% when not present.
          const computedTaxTotal = Math.max(0, taxableAmount * (taxPercent / 100));
          const cgstRate = safeNumber(row.cgst_rate ?? row.cgstRate) || (taxPercent > 0 ? taxPercent / 2 : 0);
          const sgstRate = safeNumber(row.sgst_rate ?? row.sgstRate) || (taxPercent > 0 ? taxPercent / 2 : 0);
          const igstRate = safeNumber(row.igst_rate ?? row.igstRate) || 0;

          const cgstAmount = safeNumber(row.cgst_amount ?? row.cgstAmount) || (cgstRate > 0 ? taxableAmount * (cgstRate / 100) : 0);
          const sgstAmount = safeNumber(row.sgst_amount ?? row.sgstAmount) || (sgstRate > 0 ? taxableAmount * (sgstRate / 100) : 0);
          const igstAmount = safeNumber(row.igst_amount ?? row.igstAmount) || (igstRate > 0 ? taxableAmount * (igstRate / 100) : 0);

          // Amount column in PDF uses total_price. Prefer stored amount if it looks like an inclusive total;
          // otherwise compute inclusive total as taxable + tax.
          const storedLooksLikeInclusive = storedAmount > 0 && computedTaxTotal > 0 && storedAmount > taxableAmount;
          const totalPrice = storedLooksLikeInclusive
            ? storedAmount
            : Math.max(0, taxableAmount + Math.max(0, cgstAmount + sgstAmount + igstAmount));

          return {
            sl_no: index + 1,
            item_code: row.item_code || row.code || row?.item?.code || row?.item?.item_code || '',
            item_name:
              row.item_name ||
              row.name ||
              row?.item?.name ||
              row?.item?.item_name ||
              row?.item?.description ||
              row.description ||
              row.item_code ||
              row?.item?.code ||
              '',
            description: row.description || row.specifications || row?.item?.description,
            hsn_code: row?.item?.hsn_code || row.hsn_code || row.hsn,
            quantity,
            uom: row.uom || row?.item?.uom || 'Nos',
            unit_price: unitPrice,
            discount_percent: discountPercent,
            discount_amount: discountAmount,
            taxable_amount: taxableAmount,
            cgst_rate: cgstRate,
            cgst_amount: cgstAmount,
            sgst_rate: sgstRate,
            sgst_amount: sgstAmount,
            igst_rate: igstRate,
            igst_amount: igstAmount,
            total_price: totalPrice,
            specifications: row.specifications,
            payment_terms: (row.payment_terms ?? row.paymentTerms ?? '')?.toString?.() ?? '',
            delivery_terms: (row.delivery_terms ?? row.deliveryTerms ?? '')?.toString?.() ?? '',
          };
        }),

        // Financial Summary (will be recomputed below if missing)
        subtotal: safeNumber(po.subtotal ?? po.total_amount ?? 0),
        totalDiscount: safeNumber(po.total_discount ?? 0),
        taxableAmount: safeNumber(po.taxable_amount ?? 0),
        cgstTotal: safeNumber(po.cgst_total ?? 0),
        sgstTotal: safeNumber(po.sgst_total ?? 0),
        igstTotal: safeNumber(po.igst_total ?? 0),
        grandTotal: safeNumber(po.grand_total || po.total_amount || 0),

        // Terms (derive from line items; header fields are no longer the source of truth)
        paymentTerms: PAYMENT_TERMS_LABELS[po.payment_terms] || po.payment_terms || undefined,
        deliveryDate: po.expected_delivery || po.delivery_date,
        terms: {
          payment_terms: PAYMENT_TERMS_LABELS[po.payment_terms] || po.payment_terms || undefined,
          delivery_terms: undefined,
          freight_terms: undefined,
        },
        freightAmount: safeNumber((po as any).freight_amount ?? 0),
        freightGstApplicable: false,
        freightGstPercent: 0,
        freightGstAmount: 0,
        additionalExpenses: safeNumber((po as any).other_charges ?? 0),
        customsDuty: safeNumber((po as any).customs_duty ?? 0),
        remarks: (() => {
          let r = String(po.notes || po.remarks || '');
          r = r.replace(/PR-\d{4}-\d{2}-\d+\s*/g, '');        // strip PR numbers like PR-2026-05-004
          r = r.replace(/Priority\s*:\s*\S+/gi, '');           // strip Priority: MEDIUM etc
          r = r.replace(/Department\s*:\s*[^\n]*/gi, '');      // strip Department: ...
          r = r.replace(/Generated from PR\s*:.*?(\n|$)/gi, ''); // strip Generated from PR: ...
          r = r.replace(/\n{2,}/g, '\n').trim();               // collapse blank lines
          return r || undefined;
        })(),

        currency: 'INR',
        projectName: po.project_name || '',
        preparedBy: po.created_by_name || '',
        reviewedBy: '',
        approvedBy: po.approved_by_name || '',
      };

      // Parse terms_and_conditions JSON for project/freight if stored there
      try {
        const tc = po.terms_and_conditions;
        if (tc && typeof tc === 'string' && tc.startsWith('{')) {
          const tcJson = JSON.parse(tc);
          if (!(pdfData as any).projectName && tcJson.project) (pdfData as any).projectName = tcJson.project;
          if (tcJson.freight) (pdfData as any).terms.freight_terms = tcJson.freight;
          if (tcJson.freightAmount) (pdfData as any).freightAmount = safeNumber(tcJson.freightAmount);
          if (tcJson.freightGstApplicable !== undefined) (pdfData as any).freightGstApplicable = tcJson.freightGstApplicable === true;
          if (tcJson.freightGstPercent) (pdfData as any).freightGstPercent = safeNumber(tcJson.freightGstPercent);
          if (tcJson.freightGstAmount) (pdfData as any).freightGstAmount = safeNumber(tcJson.freightGstAmount);
          if (tcJson.additionalExpenses) (pdfData as any).additionalExpenses = safeNumber(tcJson.additionalExpenses);
          if (tcJson.approvedByName && !(pdfData as any).approvedBy) (pdfData as any).approvedBy = String(tcJson.approvedByName);
        } else if (tc && typeof tc === 'object') {
          if (!(pdfData as any).projectName && (tc as any).project) (pdfData as any).projectName = (tc as any).project;
          if ((tc as any).freight) (pdfData as any).terms.freight_terms = (tc as any).freight;
          if ((tc as any).freightAmount) (pdfData as any).freightAmount = safeNumber((tc as any).freightAmount);
          if ((tc as any).freightGstApplicable !== undefined) (pdfData as any).freightGstApplicable = (tc as any).freightGstApplicable === true;
          if ((tc as any).freightGstPercent) (pdfData as any).freightGstPercent = safeNumber((tc as any).freightGstPercent);
          if ((tc as any).freightGstAmount) (pdfData as any).freightGstAmount = safeNumber((tc as any).freightGstAmount);
          if ((tc as any).additionalExpenses) (pdfData as any).additionalExpenses = safeNumber((tc as any).additionalExpenses);
          if ((tc as any).approvedByName && !(pdfData as any).approvedBy) (pdfData as any).approvedBy = String((tc as any).approvedByName);
        }
      } catch {}

      // Pull terms from line items (unique values). If multiple values exist, join them.
      try {
        const items: any[] = Array.isArray((pdfData as any).items) ? (pdfData as any).items : [];
        const uniq = (values: any[]) => Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));

        const itemPaymentTerms = uniq(items.map((it) => it?.payment_terms ?? it?.paymentTerms));
        const itemDeliveryTerms = uniq(items.map((it) => it?.delivery_terms ?? it?.deliveryTerms));

        if (itemPaymentTerms.length > 0) {
          const joined = itemPaymentTerms.join(', ');
          if (!(pdfData as any).paymentTerms) {
            (pdfData as any).paymentTerms = joined;
            (pdfData as any).terms = { ...(pdfData as any).terms, payment_terms: joined };
          }
        }

        if (itemDeliveryTerms.length > 0) {
          const joined = itemDeliveryTerms.join(', ');
          (pdfData as any).terms = { ...(pdfData as any).terms, delivery_terms: joined };
        }
      } catch {
        // Ignore term aggregation issues; PDF will fall back to defaults.
      }

      // If PO header does not have tax totals, compute from items so tax is calculated & visible in PDF.
      try {
        const items: any[] = Array.isArray((pdfData as any).items) ? (pdfData as any).items : [];
        const computedSubtotal = items.reduce((sum, it) => sum + safeNumber(it.quantity) * safeNumber(it.unit_price), 0);
        const computedDiscount = items.reduce((sum, it) => sum + safeNumber(it.discount_amount), 0);
        const computedTaxable = items.reduce((sum, it) => sum + safeNumber(it.taxable_amount), 0);
        const computedCgst = items.reduce((sum, it) => sum + safeNumber(it.cgst_amount), 0);
        const computedSgst = items.reduce((sum, it) => sum + safeNumber(it.sgst_amount), 0);
        const computedIgst = items.reduce((sum, it) => sum + safeNumber(it.igst_amount), 0);
        const computedTaxTotal = computedCgst + computedSgst + computedIgst;
        const computedGrand = computedTaxable + computedTaxTotal;

        // Always use computed values for subtotal and taxableAmount.
        if (computedSubtotal > 0) (pdfData as any).subtotal = computedSubtotal;
        if (computedTaxable > 0) (pdfData as any).taxableAmount = computedTaxable;

        if (!safeNumber((pdfData as any).totalDiscount) && computedDiscount > 0) (pdfData as any).totalDiscount = computedDiscount;

        const headerHasAnyTax = safeNumber((pdfData as any).cgstTotal) + safeNumber((pdfData as any).sgstTotal) + safeNumber((pdfData as any).igstTotal) > 0;
        if (!headerHasAnyTax && computedTaxTotal > 0) {
          (pdfData as any).cgstTotal = computedCgst;
          (pdfData as any).sgstTotal = computedSgst;
          (pdfData as any).igstTotal = computedIgst;
        }

        // If computed tax exists and grandTotal equals taxable (common current bug), use computed grand total.
        const currentGrand = safeNumber((pdfData as any).grandTotal);
        const currentTaxable = safeNumber((pdfData as any).taxableAmount);
        if (computedTaxTotal > 0 && (currentGrand <= 0 || Math.abs(currentGrand - currentTaxable) < 0.01)) {
          (pdfData as any).grandTotal = computedGrand;
        }
      } catch {
        // Ignore computation issues; PDF will fall back to stored totals.
      }

      // Freight GST is part of landed PO tax and total. Older records may have the
      // "applicable" flag without a stored amount, so recompute it for the PDF.
      try {
        const freightAmount = safeNumber((pdfData as any).freightAmount);
        const freightGstApplicable = (pdfData as any).freightGstApplicable === true && freightAmount > 0;
        const freightGstPercent = freightGstApplicable
          ? (safeNumber((pdfData as any).freightGstPercent) || 18)
          : 0;
        const freightGstAmount = freightGstApplicable
          ? Number(((freightAmount * freightGstPercent) / 100).toFixed(2))
          : 0;
        (pdfData as any).freightGstApplicable = freightGstApplicable;
        (pdfData as any).freightGstPercent = freightGstPercent;
        (pdfData as any).freightGstAmount = freightGstAmount;
      } catch {}

      // IGST vs CGST/SGST: if vendor state code differs from company state (Andhra Pradesh = 37), use IGST
      // Note: companyGSTIN may not be populated yet at this point; use AP state code directly.
      try {
        const AP_STATE_CODE = '37';
        const vendorGstin = String((pdfData as any).vendorGSTIN || '');
        const vendorStateCode = vendorGstin.substring(0, 2);
        const isInterState = vendorStateCode.length === 2 && vendorStateCode !== AP_STATE_CODE;
        if (isInterState) {
          (pdfData as any).items = ((pdfData as any).items || []).map((item: any) => {
            const combinedRate = safeNumber(item.cgst_rate) + safeNumber(item.sgst_rate);
            const combinedAmount = safeNumber(item.cgst_amount) + safeNumber(item.sgst_amount);
            return { ...item, igst_rate: combinedRate || item.igst_rate, igst_amount: combinedAmount || item.igst_amount, cgst_rate: 0, cgst_amount: 0, sgst_rate: 0, sgst_amount: 0 };
          });
          (pdfData as any).igstTotal = ((pdfData as any).cgstTotal || 0) + ((pdfData as any).sgstTotal || 0) || (pdfData as any).igstTotal;
          (pdfData as any).cgstTotal = 0;
          (pdfData as any).sgstTotal = 0;
        }
      } catch {}

      try {
        const freightAmount = safeNumber((pdfData as any).freightAmount);
        const freightGstAmount = safeNumber((pdfData as any).freightGstAmount);
        const customsDuty = safeNumber((pdfData as any).customsDuty);
        const additionalExpenses = safeNumber((pdfData as any).additionalExpenses);
        if (freightGstAmount > 0) {
          const hasIgst = safeNumber((pdfData as any).igstTotal) > 0;
          if (hasIgst) {
            (pdfData as any).igstTotal = safeNumber((pdfData as any).igstTotal) + freightGstAmount;
          } else {
            (pdfData as any).cgstTotal = safeNumber((pdfData as any).cgstTotal) + freightGstAmount / 2;
            (pdfData as any).sgstTotal = safeNumber((pdfData as any).sgstTotal) + freightGstAmount / 2;
          }
        }
        (pdfData as any).grandTotal =
          safeNumber((pdfData as any).taxableAmount || (pdfData as any).subtotal) +
          safeNumber((pdfData as any).cgstTotal) +
          safeNumber((pdfData as any).sgstTotal) +
          safeNumber((pdfData as any).igstTotal) +
          freightAmount +
          customsDuty +
          additionalExpenses;
      } catch {}

      // Zoho-style accounting rounding: keep exact component values, post the final PO total as whole rupees,
      // and show the rounding adjustment as its own line in the amount summary.
      try {
        const exactGrandTotal = safeNumber((pdfData as any).grandTotal);
        const roundedGrandTotal = Math.round(exactGrandTotal);
        const roundOff = Number((roundedGrandTotal - exactGrandTotal).toFixed(2));
        (pdfData as any).roundOff = Math.abs(roundOff) >= 0.01 ? roundOff : 0;
        (pdfData as any).grandTotal = roundedGrandTotal;
      } catch {}

      // Generate PDF
      const rawPdfBuffer = await this.worldClassPoPdfService.generatePOPdf(req.user.tenantId, pdfData);

      // Append PO-line selected drawings as extra pages. Optional item drawings are opt-in.
      let pdfBuffer = rawPdfBuffer;
      let appendedDrawingCount = 0;
      try {
        const poItems: any[] = po.purchase_order_items || po.items || [];
        const drawings = await this.poService.fetchDrawingsForPOItems(req.user.tenantId, poItems);
        appendedDrawingCount = drawings.length;
        if (drawings.length > 0) {
          pdfBuffer = await this.worldClassPoPdfService.appendDrawings(pdfBuffer, drawings);
        }
      } catch (drawErr: any) {
        console.warn('[PO PDF] Drawing append failed (non-fatal):', drawErr?.message);
      }

      // Append PO-level attachments (Documents / Attachments section)
      try {
        const poAttachments: any[] = Array.isArray((po as any).attachments) ? (po as any).attachments : [];
        if (poAttachments.length > 0) {
          const attachmentFiles = poAttachments
            .filter((att: any) => att?.url)
            .map((att: any) => {
              const fileName = att.name || (att.url as string).split('/').pop() || '';
              const ext = fileName.split('.').pop()?.toLowerCase() || '';
              return { file_url: att.url, file_name: fileName, file_type: ext };
            });
          if (attachmentFiles.length > 0) {
            pdfBuffer = await this.worldClassPoPdfService.appendDrawings(pdfBuffer, attachmentFiles);
          }
        }
      } catch (attachErr: any) {
        console.warn('[PO PDF] Attachment append failed (non-fatal):', attachErr?.message);
      }

      const isDraftDocument = String(po.status || '').toUpperCase() !== 'APPROVED';
      if (isDraftDocument) {
        pdfBuffer = await this.worldClassPoPdfService.applyDraftWatermark(pdfBuffer);
      }

      const filename = this.worldClassPoPdfService.generateFilename(
        po.po_number,
        po.vendor?.name || po.vendor_name || 'Supplier',
        isDraftDocument,
      );

      // Send PDF response
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Document-Filename': filename,
        'X-Document-Status': isDraftDocument ? 'DRAFT' : 'FINAL',
        'X-PO-Drawing-Count': String(appendedDrawingCount),
        'Content-Length': pdfBuffer.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });

      return res.send(pdfBuffer);
    } catch (error) {
      console.error('Error generating world-class PO PDF:', error);
      return res.status(500).json({ 
        message: 'Error generating PDF', 
        error: error.message 
      });
    }
  }

  @Delete(':id')
  @RequireDelete('purchase_orders')
  async delete(@Request() req: any, @Param('id') id: string) {
    return this.poService.delete(req.user.tenantId, id);
  }
}
