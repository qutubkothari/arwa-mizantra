import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmailService } from '../../email/email.service';
import { VendorsService } from './vendors.service';
import { RfqExcelService } from './rfq-excel.service';
import { ProjectsService } from '../../projects/projects.service';

const PR_WORKFLOW_STATUS = {
  DRAFT: 'DRAFT',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  APPROVED: 'APPROVED',
  RFQ_ISSUED: 'RFQ_ISSUED',
  RFQ_RCVD: 'RFQ_RCVD',
  PO_DONE: 'PO_DONE',
  GOODS_RCVD: 'GOODS_RCVD',
  REJECTED: 'REJECTED',
} as const;

function normalizeStatus(value: any): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeDepartment(value: any): string {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'R&D' || normalized === 'RND' || normalized === 'RESEARCH') return 'R&D';
  if (normalized === 'PRODUCTION') return 'PRODUCTION';
  throw new BadRequestException('Department must be Production or R&D.');
}

function safeJsonParse(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildRfqNumber(prNumber: string, recipientKey: string, index: number): string {
  const sanitizedKey = String(recipientKey || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

  return `RFQ-${String(prNumber || '').trim()}-${sanitizedKey || String(index + 1).padStart(2, '0')}`;
}

function buildWorkflowStatusLabel(status: string, detail?: string | null): string {
  switch (status) {
    case PR_WORKFLOW_STATUS.DRAFT:
      return 'Draft';
    case PR_WORKFLOW_STATUS.AWAITING_APPROVAL:
      return detail ? `Awaiting Approval (${detail})` : 'Awaiting Approval';
    case PR_WORKFLOW_STATUS.APPROVED:
      return 'Approved';
    case PR_WORKFLOW_STATUS.RFQ_ISSUED:
      if (detail === 'No') return 'RFQ Not Sent';
      if (detail === 'Yes') return 'RFQ Sent';
      return 'RFQ Sent';
    case PR_WORKFLOW_STATUS.RFQ_RCVD:
      return 'RFQ Response Received';
    case PR_WORKFLOW_STATUS.PO_DONE:
      return 'PO Done';
    case PR_WORKFLOW_STATUS.GOODS_RCVD:
      return 'Goods Recvd';
    case PR_WORKFLOW_STATUS.REJECTED:
      return 'Rejected';
    default:
      return status;
  }
}

function normalizeDateOnly(value: any): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    const day = Number(raw.slice(8, 10));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const valid =
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day &&
      year >= 2000 &&
      year <= 2100;
    return valid ? raw : null;
  }

  const ddmmyy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (ddmmyy) {
    const [, dayText, monthText, yearText] = ddmmyy;
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return normalizeDateOnly(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }

  const isoDateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoDateTime) {
    return normalizeDateOnly(`${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}`);
  }

  return null;
}

function requireDateOnly(value: any, label: string): string {
  const normalized = normalizeDateOnly(value);
  if (!normalized) {
    throw new BadRequestException(`${label} must be a valid date between 2000-01-01 and 2100-12-31.`);
  }
  return normalized;
}

function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function requireCurrentOrFutureDate(value: any, label: string): string {
  const normalized = requireDateOnly(value, label);
  const today = todayDateOnly();
  if (normalized < today) {
    throw new BadRequestException(`${label} cannot be before today (${today}).`);
  }
  return normalized;
}

function isUuid(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function canonicalizeRequisitionItems(entries: any[], persisted: boolean) {
  return (Array.isArray(entries) ? entries : [])
    .map((item) => ({
      key: String(
        persisted
          ? item?.item_id || item?.item_code || ''
          : item?.itemId || item?.item_id || item?.itemCode || item?.item_code || '',
      ).trim().toLowerCase(),
      quantity: Number(persisted ? item?.requested_qty : item?.quantity ?? item?.requestedQty),
    }))
    .filter((item) => item.key && Number.isFinite(item.quantity))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function assertNoDuplicateRequisitionItems(entries: any[], persisted = false) {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const item of Array.isArray(entries) ? entries : []) {
    const itemId = String(persisted ? item?.item_id : item?.itemId ?? item?.item_id ?? '').trim().toLowerCase();
    const itemCode = String(persisted ? item?.item_code : item?.itemCode ?? item?.item_code ?? '').trim().toUpperCase();
    const key = itemId || itemCode;
    if (!key) continue;

    const label = itemCode || String(persisted ? item?.item_name : item?.itemName ?? item?.item_name ?? 'Selected item').trim();
    if (seen.has(key)) {
      duplicates.push(label || seen.get(key) || 'Selected item');
    } else {
      seen.set(key, label || 'Selected item');
    }
  }

  if (duplicates.length > 0) {
    throw new BadRequestException(
      `Duplicate items are not allowed in a Purchase Requisition: ${Array.from(new Set(duplicates)).join(', ')}. Please edit the existing line quantity/specifications instead.`,
    );
  }
}

export function requisitionItemsMatch(left: Array<{ key: string; quantity: number }>, right: Array<{ key: string; quantity: number }>) {
  return left.length === right.length && left.every((item, index) => (
    item.key === right[index].key && item.quantity === right[index].quantity
  ));
}

@Injectable()
export class PurchaseRequisitionsService {
  private supabase: SupabaseClient;

  constructor(
    private readonly emailService: EmailService,
    private readonly vendorsService: VendorsService,
    private readonly rfqExcelService: RfqExcelService,
    private readonly projectsService: ProjectsService,
  ) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  private async assertItemsVerified(
    tenantId: string,
    rawItems: any[],
    options: { allowUnverifiedRndTemporary?: boolean; approvalGate?: boolean } = {},
  ) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    const ids = Array.from(new Set(items.map((item) => String(item?.itemId || item?.item_id || '').trim()).filter(Boolean)));
    const codes = Array.from(new Set(items.map((item) => String(item?.itemCode || item?.item_code || '').trim()).filter(Boolean)));
    if (ids.length === 0 && codes.length === 0) return;

    const byId = new Map<string, any>();
    const byCode = new Map<string, any>();

    if (ids.length > 0) {
      const { data, error } = await this.supabase
        .from('items')
        .select('id, code, name, is_active, is_verified, is_rnd_item, metadata')
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (error) {
        // Log but don't fail for items lookup errors - job order items may not exist in master
        console.warn('Items verification lookup warning (job-order items may not exist):', error.message);
      }
      (data || []).forEach((item: any) => byId.set(String(item.id), item));
    }

    if (codes.length > 0) {
      const { data, error } = await this.supabase
        .from('items')
        .select('id, code, name, is_active, is_verified, is_rnd_item, metadata')
        .eq('tenant_id', tenantId)
        .in('code', codes);
      if (error) {
        // Log but don't fail for items lookup errors - job order items may not exist in master
        console.warn('Items verification lookup warning (job-order items may not exist):', error.message);
      }
      (data || []).forEach((item: any) => byCode.set(String(item.code), item));
    }

    const approvalBlockers: string[] = [];
    for (const rawItem of items) {
      const id = String(rawItem?.itemId || rawItem?.item_id || '').trim();
      const code = String(rawItem?.itemCode || rawItem?.item_code || '').trim();
      const item = (id && byId.get(id)) || (code && byCode.get(code));
      if (!item) throw new BadRequestException(`Item ${code || id || 'unknown'} was not found in the item master.`);
      const label = item.name || item.code || code || id;
      const metadata = safeJsonParse(item.metadata);
      const isUnverifiedRndTemporary = item.is_verified !== true
        && item.is_rnd_item === true
        && metadata.isTemporary === true;

      if (item.is_active === false || item.is_verified !== true) {
        if (options.approvalGate) {
          approvalBlockers.push(`${item.code || label} (${item.is_active === false ? 'inactive' : 'verification pending'})`);
          continue;
        }
        if (item.is_active !== false && options.allowUnverifiedRndTemporary && isUnverifiedRndTemporary) {
          continue;
        }
        if (item.is_active === false) throw new BadRequestException(`Item ${label} is inactive and cannot be used.`);
        throw new BadRequestException(`Item ${label} is not verified and cannot be used.`);
      }
    }

    if (approvalBlockers.length > 0) {
      throw new BadRequestException(
        `Purchase requisition cannot be approved until every item is verified and active. Pending: ${approvalBlockers.join(', ')}.`,
      );
    }
  }

  private async assertVendorsVerified(tenantId: string, vendorIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(vendorIds.map((vendorId) => String(vendorId || '').trim()).filter(Boolean)));
    await Promise.all(ids.map((vendorId) => this.vendorsService.assertVendorVerified(tenantId, vendorId)));
  }

  private async normalizeRfqVendorSelection(
    tenantId: string,
    pr: any,
    vendorIds: string[],
    itemVendors: Array<{ itemId: string; vendorIds: string[] }>,
  ): Promise<{ vendorIds: string[]; itemVendors: Array<{ itemId: string; vendorIds: string[] }> }> {
    const requestedVendorIds = Array.from(new Set((vendorIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    const activeVendorIds = new Set<string>();

    if (requestedVendorIds.length > 0) {
      const { data: vendors, error } = await this.supabase
        .from('vendors')
        .select('id, is_active')
        .eq('tenant_id', tenantId)
        .in('id', requestedVendorIds);
      if (error) throw new BadRequestException(error.message);
      (vendors || []).forEach((vendor: any) => {
        if (vendor?.is_active !== false && vendor?.id) activeVendorIds.add(String(vendor.id));
      });
    }

    const prItems = Array.isArray(pr?.purchase_requisition_items) ? pr.purchase_requisition_items : [];
    const prItemById = new Map<string, any>();
    const missingCodes = new Set<string>();

    for (const item of prItems) {
      const prItemId = String(item?.id || '').trim();
      if (prItemId) prItemById.set(prItemId, item);
      if (!String(item?.item_id || '').trim() && String(item?.item_code || '').trim()) {
        missingCodes.add(String(item.item_code).trim());
      }
    }

    const itemIdByCode = new Map<string, string>();
    if (missingCodes.size > 0) {
      const { data: itemRows, error } = await this.supabase
        .from('items')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', Array.from(missingCodes));
      if (error) throw new BadRequestException(error.message);
      (itemRows || []).forEach((row: any) => {
        const code = String(row?.code || '').trim();
        const id = String(row?.id || '').trim();
        if (code && id) itemIdByCode.set(code, id);
      });
    }

    const masterItemIdByPrItemId = new Map<string, string>();
    for (const item of prItems) {
      const prItemId = String(item?.id || '').trim();
      const itemId =
        String(item?.item_id || '').trim() ||
        itemIdByCode.get(String(item?.item_code || '').trim()) ||
        '';
      if (prItemId && itemId) masterItemIdByPrItemId.set(prItemId, itemId);
    }

    const itemIds = Array.from(new Set(Array.from(masterItemIdByPrItemId.values()).filter(Boolean)));
    const preferredVendorByItemId = new Map<string, string>();

    if (itemIds.length > 0) {
      const { data: links, error } = await this.supabase
        .from('item_vendors')
        .select('item_id, vendor_id, priority, vendor:vendors(id, is_active, is_verified, approval_status)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('item_id', itemIds)
        .order('priority', { ascending: true });
      if (error) throw new BadRequestException(error.message);

      for (const link of links || []) {
        const itemId = String((link as any)?.item_id || '').trim();
        const vendorId = String((link as any)?.vendor_id || '').trim();
        if (!itemId || !vendorId || preferredVendorByItemId.has(itemId)) continue;
        const vendor = Array.isArray((link as any)?.vendor) ? (link as any).vendor[0] : (link as any)?.vendor;
        const approvalStatus = String(vendor?.approval_status || '').trim().toUpperCase();
        const isApproved = vendor?.is_verified === true || ['APPROVED', 'VERIFIED'].includes(approvalStatus);
        if (vendor?.is_active === false || !isApproved) continue;
        preferredVendorByItemId.set(itemId, vendorId);
        activeVendorIds.add(vendorId);
      }
    }

    const normalizedItemVendors = (itemVendors || [])
      .map((assignment) => {
        const prItemId = String(assignment?.itemId || '').trim();
        if (!prItemId) return null;

        const activeAssigned = Array.from(new Set(
          (assignment?.vendorIds || [])
            .map((id) => String(id || '').trim())
            .filter((id) => id && activeVendorIds.has(id)),
        ));

        if (activeAssigned.length > 0) {
          return { itemId: prItemId, vendorIds: activeAssigned };
        }

        const masterItemId = masterItemIdByPrItemId.get(prItemId);
        const preferredVendorId = masterItemId ? preferredVendorByItemId.get(masterItemId) : '';
        return preferredVendorId ? { itemId: prItemId, vendorIds: [preferredVendorId] } : { itemId: prItemId, vendorIds: [] };
      })
      .filter((assignment): assignment is { itemId: string; vendorIds: string[] } => Boolean(assignment));

    const assignmentVendorIds = normalizedItemVendors.flatMap((assignment) => assignment.vendorIds);
    const effectiveVendorIds = Array.from(new Set([
      ...requestedVendorIds.filter((id) => activeVendorIds.has(id)),
      ...assignmentVendorIds,
    ].filter(Boolean)));

    return {
      vendorIds: effectiveVendorIds,
      itemVendors: normalizedItemVendors,
    };
  }

  private assertLineDeliveryDates(items: any[], status: string) {
    if (status !== 'SUBMITTED') return;
    for (const item of Array.isArray(items) ? items : []) {
      const label = String(item?.itemCode || item?.item_code || item?.itemName || item?.item_name || 'item');
      requireCurrentOrFutureDate(
        item?.requiredDate ?? item?.required_date,
        `Delivery date for ${label}`,
      );
    }
  }

  async create(tenantId: string, userId: string, data: any) {
    await this.projectsService.ensureSchema();
    const department = normalizeDepartment(data.department);
    assertNoDuplicateRequisitionItems(data.items || []);
    await this.assertItemsVerified(tenantId, data.items || [], {
      allowUnverifiedRndTemporary: department === 'R&D',
    });
    await this.assertVendorsVerified(
      tenantId,
      (Array.isArray(data.items) ? data.items : []).map((item: any) => item.vendorId ?? item.vendor_id ?? null),
    );

    // Generate PR number
    const prNumber = await this.generatePRNumber(tenantId);

    const requestedStatus = normalizeStatus(data.status || 'DRAFT');
    if (!['DRAFT', 'SUBMITTED'].includes(requestedStatus)) {
      throw new BadRequestException('A new requisition can only be saved as draft or submitted.');
    }
    this.assertLineDeliveryDates(data.items || [], requestedStatus);
    const projectId = String(data.projectId ?? data.project_id ?? '').trim() || null;
    const projectName = String(data.projectName ?? data.project_name ?? '').trim() || null;

    const { data: pr, error } = await this.supabase
      .from('purchase_requisitions')
      .insert({
        tenant_id: tenantId,
        pr_number: prNumber,
        request_date: normalizeDateOnly(data.requestDate) || new Date().toISOString().split('T')[0],
        department,
        project_id: projectId,
        project_name: projectName,
        purpose: data.purpose,
        delivery_address: data.deliveryAddress ?? data.delivery_address ?? null,
        requested_by: userId,
        required_date: requireCurrentOrFutureDate(data.requiredDate, 'Required date'),
        priority: normalizeStatus(data.priority || 'MEDIUM'),
        status: 'DRAFT',
        remarks: data.remarks,
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    if (projectId) {
      await this.projectsService.logEvent(tenantId, projectId, userId, {
        eventType: 'PR_CREATED',
        sourceModule: 'PURCHASE_REQUISITION',
        sourceId: pr.id,
        sourceNumber: pr.pr_number,
        remarks: `Purchase requisition created for ${department}`,
        metadata: { status: requestedStatus },
      });
    }

    // Insert items
    if (data.items && data.items.length > 0) {
      const items = data.items.map((item: any) => ({
        pr_id: pr.id,
        item_id: item.itemId ?? item.item_id ?? null,
        item_code: item.itemCode,
        item_name: item.itemName,
        vendor_id: item.vendorId ?? item.vendor_id ?? null,
        description: item.description,
        uom: item.uom,
        requested_qty: item.requestedQty,
        estimated_rate: item.estimatedRate,
        required_date: normalizeDateOnly(item.requiredDate),
        payment_terms: item.paymentTerms ?? null,
        delivery_terms: item.deliveryTerms ?? null,
        remarks: item.remarks,
      }));

      let { error: itemsError } = await this.supabase
        .from('purchase_requisition_items')
        .insert(items);

      // Fallback: retry without commercial-terms columns if schema cache is stale
      if (itemsError && (itemsError.message.includes('payment_terms') || itemsError.message.includes('delivery_terms'))) {
        const safeItems = items.map(({ payment_terms, delivery_terms, ...rest }: any) => rest);
        const { error: retryError } = await this.supabase
          .from('purchase_requisition_items')
          .insert(safeItems);
        itemsError = retryError ?? null;
      }

      if (itemsError) throw new BadRequestException(itemsError.message);
    }

    if (requestedStatus === 'SUBMITTED') {
      return this.submit(tenantId, pr.id, userId);
    }

    return this.findOne(tenantId, pr.id);
  }

  async checkDuplicates(tenantId: string, rawItems: any[]) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    if (items.length === 0) return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };

    const requested = canonicalizeRequisitionItems(items, false);
    if (requested.length !== items.length) {
      throw new BadRequestException('Each duplicate-check item requires an item ID or code and a valid quantity.');
    }

    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from('purchase_requisitions')
      .select('id, pr_number, status, created_at, purchase_requisition_items(item_id, item_code, requested_qty)')
      .eq('tenant_id', tenantId)
      .gte('created_at', since);

    if (error) throw new BadRequestException(error.message);

    const match = (data || []).find((pr: any) => {
      const existing = canonicalizeRequisitionItems(pr?.purchase_requisition_items || [], true);
      return requisitionItemsMatch(existing, requested);
    });

    if (!match) return { hasDuplicates: false, exactMatches: [], fuzzyMatches: [] };

    return {
      hasDuplicates: true,
      exactMatches: [],
      fuzzyMatches: [{
        id: match.id,
        matchScore: 100,
        matchedFields: ['items'],
        data: match,
      }],
      message: `A requisition with the same items and quantities was created recently (${match.pr_number}).`,
    };
  }

  async getItemAvailability(tenantId: string, itemId: string) {
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) {
      throw new BadRequestException('Item is required.');
    }

    const toQty = (value: any) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const { data: item, error: itemError } = await this.supabase
      .from('items')
      .select('id, code, name, uom')
      .eq('tenant_id', tenantId)
      .eq('id', normalizedItemId)
      .single();

    if (itemError || !item) {
      throw new NotFoundException('Item not found');
    }

    const [{ data: stockRows, error: stockError }, { data: poRows, error: poError }, { data: prRows, error: prError }] =
      await Promise.all([
        this.supabase
          .from('inventory_stock')
          .select('quantity, available_quantity')
          .eq('tenant_id', tenantId)
          .eq('item_id', normalizedItemId),
        this.supabase
          .from('purchase_orders')
          .select('id, po_number, status, purchase_order_items(item_id, ordered_qty, received_qty)')
          .eq('tenant_id', tenantId),
        this.supabase
          .from('purchase_requisitions')
          .select('id, pr_number, status, purchase_requisition_items(item_id, requested_qty, total_ordered_qty)')
          .eq('tenant_id', tenantId),
      ]);

    if (stockError) throw new BadRequestException(stockError.message);
    if (poError) throw new BadRequestException(poError.message);
    if (prError) throw new BadRequestException(prError.message);

    const currentStockQty = (stockRows || []).reduce(
      (sum: number, row: any) => sum + toQty(row?.available_quantity ?? row?.quantity),
      0,
    );

    const openPoLines: any[] = [];
    let pendingPoQty = 0;
    const ignoredPoStatuses = new Set(['REJECTED', 'CANCELLED', 'CLOSED']);
    for (const po of poRows || []) {
      if (ignoredPoStatuses.has(normalizeStatus(po?.status))) continue;
      const lines = Array.isArray(po?.purchase_order_items) ? po.purchase_order_items : [];
      for (const line of lines) {
        if (String(line?.item_id || '') !== normalizedItemId) continue;
        const orderedQty = toQty(line?.ordered_qty);
        const receivedQty = toQty(line?.received_qty);
        const pendingQty = Math.max(0, orderedQty - receivedQty);
        if (pendingQty <= 0) continue;
        pendingPoQty += pendingQty;
        openPoLines.push({
          poNumber: po?.po_number,
          pendingQty,
        });
      }
    }

    const openPrLines: any[] = [];
    let openPrQty = 0;
    const ignoredPrStatuses = new Set(['REJECTED', 'CANCELLED', 'PO_DONE', 'GOODS_RCVD', 'CLOSED']);
    for (const pr of prRows || []) {
      if (ignoredPrStatuses.has(normalizeStatus(pr?.status))) continue;
      const lines = Array.isArray(pr?.purchase_requisition_items) ? pr.purchase_requisition_items : [];
      for (const line of lines) {
        if (String(line?.item_id || '') !== normalizedItemId) continue;
        const requestedQty = toQty(line?.requested_qty);
        const orderedQty = toQty(line?.total_ordered_qty);
        const openQty = Math.max(0, requestedQty - orderedQty);
        if (openQty <= 0) continue;
        openPrQty += openQty;
        openPrLines.push({
          prNumber: pr?.pr_number,
          openQty,
        });
      }
    }

    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      uom: item.uom,
      currentStockQty,
      pendingPoQty,
      openPrQty,
      openPoLines: openPoLines.slice(0, 5),
      openPrLines: openPrLines.slice(0, 5),
    };
  }

  async findAll(tenantId: string, filters?: any) {
    let query = this.supabase
      .from('purchase_requisitions')
      .select(`
        *,
        purchase_requisition_items(*)
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.department) {
      query = query.eq('department', filters.department);
    }

    if (filters?.requestedBy) {
      query = query.eq('requested_by', filters.requestedBy);
    }

    const { data, error } = await query;

    if (error) throw new BadRequestException(error.message);

    let requisitions: any[] = Array.isArray(data) ? data : [];

    // Backfill item master text used only for list/search matching. PR lines store
    // denormalized code/name/remarks; master description/OEM may only live on items.
    try {
      const allLines: any[] = requisitions.flatMap((r: any) =>
        Array.isArray(r?.purchase_requisition_items) ? r.purchase_requisition_items : [],
      );
      const ids = Array.from(new Set(allLines.map((it: any) => String(it?.item_id || it?.itemId || '').trim()).filter(Boolean)));
      const codes = Array.from(new Set(allLines.map((it: any) => String(it?.item_code || it?.itemCode || '').trim()).filter(Boolean)));
      const itemSearchById = new Map<string, string>();
      const itemSearchByCode = new Map<string, string>();
      const mapItemRow = (row: any) => {
        const text = [row?.code, row?.name, row?.description, row?.oem_part_no, row?.oem_name, row?.hsn_code]
          .filter(Boolean)
          .join(' ');
        if (row?.id) itemSearchById.set(String(row.id), text);
        if (row?.code) itemSearchByCode.set(String(row.code), text);
      };

      if (ids.length > 0) {
        const { data: byId } = await this.supabase
          .from('items')
          .select('id, code, name, description, oem_part_no, oem_name, hsn_code')
          .eq('tenant_id', tenantId)
          .in('id', ids);
        (Array.isArray(byId) ? byId : []).forEach(mapItemRow);
      }
      if (codes.length > 0) {
        const { data: byCode } = await this.supabase
          .from('items')
          .select('id, code, name, description, oem_part_no, oem_name, hsn_code')
          .eq('tenant_id', tenantId)
          .in('code', codes);
        (Array.isArray(byCode) ? byCode : []).forEach(mapItemRow);
      }

      requisitions.forEach((r: any) => {
        const lines = Array.isArray(r?.purchase_requisition_items) ? r.purchase_requisition_items : [];
        lines.forEach((line: any) => {
          const id = String(line?.item_id || line?.itemId || '').trim();
          const code = String(line?.item_code || line?.itemCode || '').trim();
          line.item_master_search = (id && itemSearchById.get(id)) || (code && itemSearchByCode.get(code)) || '';
        });
      });
    } catch (e) {
      console.warn('PR item description search backfill failed:', (e as any)?.message || e);
    }

    if (filters?.search) {
      const tokens = String(filters.search || '')
        .toLowerCase()
        .split(/[\s,;|/\\()[\]{}"'`._:-]+/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (tokens.length > 0) {
        requisitions = requisitions.filter((row: any) => {
          const lineText = (Array.isArray(row?.purchase_requisition_items) ? row.purchase_requisition_items : [])
            .map((item: any) => [
              item?.item_code,
              item?.item_name,
              item?.item_description,
              item?.description,
              item?.specifications,
              item?.notes,
              item?.remarks,
              item?.oem_part_no,
              item?.oem_name,
              item?.item_master_search,
            ].filter(Boolean).join(' '))
            .join(' ');
          const haystack = [
            row?.pr_number,
            row?.department,
            row?.priority,
            row?.status,
            row?.purpose,
            row?.notes,
            row?.project_name,
            lineText,
          ].filter(Boolean).join(' ').toLowerCase();

          return tokens.every((token) => haystack.includes(token));
        });
      }
    }

    // Record-level PR visibility follows the employee department assignment.
    // Managers/admins/approvers do not receive this internal filter; other users
    // see their own PRs plus PRs belonging to their department.
    if (filters?.visibility) {
      const requestedBy = String(filters.visibility.requestedBy || '').trim();
      const department = String(filters.visibility.department || '').trim().toUpperCase();
      const departments = new Set(
        (Array.isArray(filters.visibility.departments) ? filters.visibility.departments : [])
          .map((value: any) => String(value || '').trim().toUpperCase())
          .filter(Boolean),
      );
      if (department) departments.add(department);
      requisitions = requisitions.filter((row: any) => {
        const isCreator = requestedBy && String(row?.requested_by || '').trim() === requestedBy;
        const rowDepartment = String(row?.department || '').trim().toUpperCase();
        const isSameDepartment = rowDepartment && departments.has(rowDepartment);
        return Boolean(isCreator || isSameDepartment);
      });
    }

    // Backfill missing UOM in response from master items (best-effort)
    try {
      const allItems: any[] = requisitions.flatMap((r: any) =>
        Array.isArray(r?.purchase_requisition_items) ? r.purchase_requisition_items : [],
      );

      const missing = allItems.filter((it: any) => {
        const uom = String(it?.uom ?? '').trim();
        const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
        const id = String(it?.item_id ?? it?.itemId ?? '').trim();
        return (!uom || uom.length === 0) && (code.length > 0 || id.length > 0);
      });

      if (missing.length > 0) {
        const codeSet = new Set<string>();
        const idSet = new Set<string>();
        missing.forEach((it: any) => {
          const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
          const id = String(it?.item_id ?? it?.itemId ?? '').trim();
          if (code) codeSet.add(code);
          if (id) idSet.add(id);
        });

        const codes = Array.from(codeSet);
        const ids = Array.from(idSet);
        const itemUomByCode = new Map<string, string>();
        const itemUomById = new Map<string, string>();

        if (codes.length > 0 || ids.length > 0) {
          const itemsQuery = this.supabase
            .from('items')
            .select('id, code, uom')
            .eq('tenant_id', tenantId);

          if (ids.length > 0 && codes.length > 0) {
            // Supabase doesn't support OR across two different IN clauses cleanly; do two queries.
            const [{ data: byId }, { data: byCode }] = await Promise.all([
              this.supabase
                .from('items')
                .select('id, code, uom')
                .eq('tenant_id', tenantId)
                .in('id', ids),
              this.supabase
                .from('items')
                .select('id, code, uom')
                .eq('tenant_id', tenantId)
                .in('code', codes),
            ]);

            (Array.isArray(byId) ? byId : []).forEach((row: any) => {
              if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
              if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
            });
            (Array.isArray(byCode) ? byCode : []).forEach((row: any) => {
              if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
              if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
            });
          } else if (ids.length > 0) {
            const { data: itemsData } = await itemsQuery.in('id', ids);
            (Array.isArray(itemsData) ? itemsData : []).forEach((row: any) => {
              if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
              if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
            });
          } else if (codes.length > 0) {
            const { data: itemsData } = await itemsQuery.in('code', codes);
            (Array.isArray(itemsData) ? itemsData : []).forEach((row: any) => {
              if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
              if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
            });
          }
        }

        requisitions.forEach((r: any) => {
          const items = Array.isArray(r?.purchase_requisition_items)
            ? r.purchase_requisition_items
            : [];
          items.forEach((it: any) => {
            const currentUom = String(it?.uom ?? '').trim();
            if (currentUom) return;
            const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
            const id = String(it?.item_id ?? it?.itemId ?? '').trim();
            const backfill = (id && itemUomById.get(id)) || (code && itemUomByCode.get(code)) || '';
            if (backfill) it.uom = backfill;
          });
        });
      }
    } catch (e) {
      // Never block PR list rendering on backfill
      console.warn('PR UOM response backfill failed:', (e as any)?.message || e);
    }

    return this.attachWorkflowMetadata(tenantId, requisitions);
  }

  async findUserDepartment(tenantId: string, userId: string): Promise<string | null> {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return null;

    const { data, error } = await this.supabase
      .from('employees')
      .select('department')
      .eq('tenant_id', tenantId)
      .eq('user_id', normalizedUserId)
      .maybeSingle();

    if (error) {
      console.warn(`Unable to resolve PR department visibility for user ${normalizedUserId}: ${error.message}`);
      return null;
    }

    const department = String((data as any)?.department || '').trim();
    return department || null;
  }

  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('purchase_requisitions')
      .select(`
        *,
        purchase_requisition_items(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException('Purchase Requisition not found');

    // Backfill missing UOM in response from master items (best-effort)
    try {
      const pr: any = data as any;
      const items: any[] = Array.isArray(pr?.purchase_requisition_items)
        ? pr.purchase_requisition_items
        : [];

      const missing = items.filter((it: any) => {
        const uom = String(it?.uom ?? '').trim();
        const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
        const itemId = String(it?.item_id ?? it?.itemId ?? '').trim();
        return (!uom || uom.length === 0) && (code.length > 0 || itemId.length > 0);
      });

      if (missing.length > 0) {
        const codeSet = new Set<string>();
        const idSet = new Set<string>();
        missing.forEach((it: any) => {
          const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
          const itemId = String(it?.item_id ?? it?.itemId ?? '').trim();
          if (code) codeSet.add(code);
          if (itemId) idSet.add(itemId);
        });

        const codes = Array.from(codeSet);
        const ids = Array.from(idSet);
        const itemUomByCode = new Map<string, string>();
        const itemUomById = new Map<string, string>();

        if (ids.length > 0) {
          const { data: byId } = await this.supabase
            .from('items')
            .select('id, code, uom')
            .eq('tenant_id', tenantId)
            .in('id', ids);
          (Array.isArray(byId) ? byId : []).forEach((row: any) => {
            if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
            if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
          });
        }

        if (codes.length > 0) {
          const { data: byCode } = await this.supabase
            .from('items')
            .select('id, code, uom')
            .eq('tenant_id', tenantId)
            .in('code', codes);
          (Array.isArray(byCode) ? byCode : []).forEach((row: any) => {
            if (row?.id && row?.uom) itemUomById.set(String(row.id), String(row.uom));
            if (row?.code && row?.uom) itemUomByCode.set(String(row.code), String(row.uom));
          });
        }

        items.forEach((it: any) => {
          const currentUom = String(it?.uom ?? '').trim();
          if (currentUom) return;
          const code = String(it?.item_code ?? it?.itemCode ?? '').trim();
          const itemId = String(it?.item_id ?? it?.itemId ?? '').trim();
          const backfill = (itemId && itemUomById.get(itemId)) || (code && itemUomByCode.get(code)) || '';
          if (backfill) it.uom = backfill;
        });
      }
    } catch (e) {
      console.warn('PR UOM response backfill failed:', (e as any)?.message || e);
    }

    try {
      const prData: any = data as any;
      const approverId = String(prData?.approved_by || '').trim();

      if (approverId) {
        const { data: approver } = await this.supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .eq('id', approverId)
          .maybeSingle();

        if (approver) {
          const firstName = String((approver as any).first_name || '').trim();
          const lastName = String((approver as any).last_name || '').trim();
          const email = String((approver as any).email || '').trim();

          prData.approved_by_name =
            [firstName, lastName].filter(Boolean).join(' ').trim() ||
            email ||
            null;
        }
      }
    } catch (e) {
      console.warn('PR approver name resolution failed:', (e as any)?.message || e);
    }

    const [withWorkflow] = await this.attachWorkflowMetadata(tenantId, [data as any]);
    return withWorkflow || data;
  }

  async findOneAvailableForPO(tenantId: string, id: string) {
    const pr = await this.findOne(tenantId, id);
    const prStatus = normalizeStatus((pr as any)?.status);
    const poEligibleStatuses = new Set([
      PR_WORKFLOW_STATUS.APPROVED,
      PR_WORKFLOW_STATUS.RFQ_ISSUED,
      PR_WORKFLOW_STATUS.RFQ_RCVD,
      PR_WORKFLOW_STATUS.PO_DONE,
      'RFQ_RESPONSE_RECORDED',
      'PO_PARTIAL',
      'PARTIAL',
    ]);
    if (!poEligibleStatuses.has(prStatus)) {
      throw new BadRequestException(
        `PR ${(pr as any)?.pr_number || id} must be fully approved before creating a Purchase Order.`,
      );
    }

    const { data: poRows, error: poError } = await this.supabase
      .from('purchase_orders')
      .select(`
        id,
        status,
        purchase_order_items(pr_item_id, ordered_qty)
      `)
      .eq('tenant_id', tenantId)
      .eq('pr_id', id);

    if (poError) throw new BadRequestException(poError.message);

    const orderedByPrItemId = new Map<string, number>();
    (poRows || []).forEach((po: any) => {
      if (['REJECTED', 'CANCELLED'].includes(normalizeStatus(po?.status))) return;
      const items = Array.isArray(po?.purchase_order_items) ? po.purchase_order_items : [];
      items.forEach((it: any) => {
        const prItemId = String(it?.pr_item_id || '').trim();
        if (!prItemId) return;
        orderedByPrItemId.set(
          prItemId,
          (orderedByPrItemId.get(prItemId) || 0) + Number(it?.ordered_qty || 0),
        );
      });
    });

    const prItems = Array.isArray((pr as any)?.purchase_requisition_items)
      ? (pr as any).purchase_requisition_items
      : [];

    let availableItems = prItems.map((it: any) => {
      const prItemId = String(it?.id || '').trim();
      const requestedQty = Number(it?.requested_qty || 0);
      const orderedQty = orderedByPrItemId.get(prItemId) || 0;
      const remainingQty = Math.max(0, requestedQty - orderedQty);
      return {
        ...it,
        total_ordered_qty: orderedQty,
        remaining_qty: remainingQty,
        requested_qty: remainingQty,
        original_requested_qty: requestedQty,
      };
    }).filter((it: any) => Number(it?.remaining_qty || 0) > 0);

    // Hydrate legacy/auto-generated PR lines that only stored item_code, then
    // attach the first active item vendor (lowest priority = preferred). This
    // gives Create PO one stable vendor_id instead of relying on client-side
    // master-list timing or RPC response shapes.
    const missingItemCodes = Array.from(new Set(
      availableItems
        .filter((it: any) => !String(it?.item_id || '').trim())
        .map((it: any) => String(it?.item_code || '').trim())
        .filter(Boolean),
    ));

    const itemIdByCode = new Map<string, string>();
    if (missingItemCodes.length > 0) {
      const { data: itemRows, error: itemError } = await this.supabase
        .from('items')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('code', missingItemCodes);
      if (itemError) throw new BadRequestException(itemError.message);
      for (const row of itemRows || []) {
        const code = String((row as any)?.code || '').trim();
        const itemId = String((row as any)?.id || '').trim();
        if (code && itemId) itemIdByCode.set(code, itemId);
      }
    }

    availableItems = availableItems.map((it: any) => ({
      ...it,
      item_id: String(it?.item_id || '').trim() || itemIdByCode.get(String(it?.item_code || '').trim()) || null,
    }));

    const resolvedItemIds = Array.from(new Set(
      availableItems.map((it: any) => String(it?.item_id || '').trim()).filter(Boolean),
    ));
    const existingVendorIds = Array.from(new Set(
      availableItems.map((it: any) => String(it?.vendor_id || '').trim()).filter(Boolean),
    ));
    const activeExistingVendorIds = new Set<string>();
    if (existingVendorIds.length > 0) {
      const { data: existingVendors, error: existingVendorError } = await this.supabase
        .from('vendors')
        .select('id, is_active')
        .eq('tenant_id', tenantId)
        .in('id', existingVendorIds);
      if (existingVendorError) throw new BadRequestException(existingVendorError.message);
      for (const vendor of existingVendors || []) {
        if ((vendor as any)?.is_active !== false && (vendor as any)?.id) {
          activeExistingVendorIds.add(String((vendor as any).id));
        }
      }
    }

    const preferredVendorByItemId = new Map<string, any>();
    if (resolvedItemIds.length > 0) {
      const { data: vendorLinks, error: vendorLinkError } = await this.supabase
        .from('item_vendors')
        .select('item_id, vendor_id, unit_price, priority, vendor:vendors(id, name, is_active, is_verified, approval_status)')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .in('item_id', resolvedItemIds)
        .order('priority', { ascending: true });
      if (vendorLinkError) throw new BadRequestException(vendorLinkError.message);

      for (const link of vendorLinks || []) {
        const itemId = String((link as any)?.item_id || '').trim();
        if (!itemId || preferredVendorByItemId.has(itemId)) continue;
        const relation = Array.isArray((link as any)?.vendor) ? (link as any).vendor[0] : (link as any)?.vendor;
        const approvalStatus = String(relation?.approval_status || '').trim().toUpperCase();
        const isApproved = relation?.is_verified === true || ['APPROVED', 'VERIFIED'].includes(approvalStatus);
        if (relation?.is_active === false || !isApproved) continue;
        preferredVendorByItemId.set(itemId, link);
      }
    }

    availableItems = availableItems.map((it: any) => {
      const currentVendorId = String(it?.vendor_id || '').trim();
      if (currentVendorId && activeExistingVendorIds.has(currentVendorId)) return it;
      const preferred = preferredVendorByItemId.get(String(it?.item_id || '').trim());
      if (!preferred) {
        return {
          ...it,
          vendor_id: currentVendorId && activeExistingVendorIds.has(currentVendorId) ? currentVendorId : null,
        };
      }
      const relation = Array.isArray(preferred.vendor) ? preferred.vendor[0] : preferred.vendor;
      return {
        ...it,
        vendor_id: preferred.vendor_id || relation?.id || null,
        vendor_name: relation?.name || null,
        preferred_vendor_id: preferred.vendor_id || relation?.id || null,
        preferred_vendor_name: relation?.name || null,
        preferred_vendor_unit_price: preferred.unit_price ?? null,
      };
    });

    return {
      ...pr,
      purchase_requisition_items: availableItems,
      _meta: {
        ordered_quantities_by_pr_item_id: Object.fromEntries(orderedByPrItemId.entries()),
      },
    };
  }

  async findApprovalHistory(tenantId: string, id: string) {
    await this.getRequisitionForTransition(tenantId, id);
    const { data, error } = await this.supabase
      .from('purchase_requisition_approval_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('pr_id', id)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn(`Failed to load requisition approval history for ${id}: ${error.message}`);
      return [];
    }

    const rows = data || [];
    const actorIds = Array.from(new Set(rows.map((row: any) => String(row.actor_id || '')).filter(Boolean)));
    const actorsById = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: users } = await this.supabase.from('users').select('id, first_name, last_name, email').in('id', actorIds);
      (users || []).forEach((user: any) => {
        actorsById.set(String(user.id), [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown user');
      });
    }
    return rows.map((row: any) => ({ ...row, actor_name: actorsById.get(String(row.actor_id)) || 'Unknown user' }));
  }

  private async logApprovalAction(args: {
    tenantId: string;
    prId: string;
    actorId: string;
    action: string;
    fromStatus?: string;
    toStatus?: string;
    reason?: string | null;
    approvalLevel?: number;
    approvalRuleId?: string | null;
  }) {
    const { error } = await this.supabase.from('purchase_requisition_approval_history').insert({
      tenant_id: args.tenantId,
      pr_id: args.prId,
      actor_id: args.actorId,
      action: args.action,
      from_status: args.fromStatus || null,
      to_status: args.toStatus || null,
      reason: args.reason || null,
      approval_level: args.approvalLevel || 0,
      approval_rule_id: args.approvalRuleId || null,
    });
    if (error) {
      console.warn('Failed to record requisition history:', error.message);
    }
  }

  private async getRequisitionForTransition(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('purchase_requisitions')
      .select(`
        *,
        purchase_requisition_items(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(`Failed to load purchase requisition: ${error.message}`);
    if (!data) throw new NotFoundException('Purchase Requisition not found');
    return data as any;
  }

  private async getMatchingApprovalRules(tenantId: string, department: string, totalAmount: number) {
    const { data, error } = await this.supabase
      .from('purchase_requisition_approval_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sequence', { ascending: true });
    if (error) throw new BadRequestException(`Failed to load approval rules: ${error.message}`);
    return (data || []).filter((rule: any) => {
      const departmentMatches = !rule.department || normalizeStatus(rule.department) === normalizeStatus(department);
      const minimumMatches = totalAmount >= Number(rule.min_amount || 0);
      const maximumMatches = rule.max_amount === null || rule.max_amount === undefined || totalAmount <= Number(rule.max_amount);
      return departmentMatches && minimumMatches && maximumMatches;
    });
  }

  private async assertRuleApprover(userId: string, rule: any) {
    if (rule?.approver_user_id && String(rule.approver_user_id) !== String(userId)) {
      throw new BadRequestException('This approval step is assigned to another approver.');
    }
    if (!rule?.approver_role_id) return;

    const [{ data: membership }, { data: legacyUser }] = await Promise.all([
      this.supabase.from('user_roles').select('user_id').eq('user_id', userId).eq('role_id', rule.approver_role_id).maybeSingle(),
      this.supabase.from('users').select('id').eq('id', userId).eq('role_id', rule.approver_role_id).maybeSingle(),
    ]);
    if (!membership && !legacyUser) throw new BadRequestException('Your role is not assigned to this approval step.');
  }

  private async assertDefaultApprover(tenantId: string, userId: string) {
    const [{ data: memberships, error: membershipError }, { data: legacyUser, error: userError }] = await Promise.all([
      this.supabase.from('user_roles').select('role_id').eq('user_id', userId),
      this.supabase.from('users').select('role_id').eq('tenant_id', tenantId).eq('id', userId).maybeSingle(),
    ]);
    if (membershipError || userError) {
      throw new BadRequestException('Unable to verify the approver role.');
    }

    const roleIds = Array.from(new Set([
      ...(memberships || []).map((membership: any) => membership.role_id),
      legacyUser?.role_id,
    ].filter(Boolean)));
    if (roleIds.length === 0) {
      throw new BadRequestException('A Manager or Administrator role is required to approve this requisition.');
    }

    const { data: roles, error: rolesError } = await this.supabase
      .from('roles')
      .select('code, name')
      .in('id', roleIds);
    if (rolesError) throw new BadRequestException('Unable to verify the approver role.');

    const allowedRole = (roles || []).some((role: any) => {
      const identity = `${normalizeStatus(role.code)} ${normalizeStatus(role.name)}`;
      return ['MANAGER', 'ADMIN', 'DIRECTOR', 'OWNER'].some((keyword) => identity.includes(keyword));
    });
    if (!allowedRole) {
      throw new BadRequestException('A Manager or Administrator role is required to approve this requisition.');
    }
  }

  private formatLifecycleLockMessage(action: 'edit' | 'delete', pr: any, locks: any) {
    const references: string[] = [];
    if (locks.rfqCount > 0) {
      references.push(`${locks.rfqCount} RFQ${locks.rfqCount === 1 ? '' : 's'} sent`);
    }
    if (locks.poCount > 0) {
      references.push(`${locks.poCount} PO${locks.poCount === 1 ? '' : 's'}: ${locks.poNumbers.join(', ')}`);
    }
    if (locks.grnCount > 0) {
      references.push(`${locks.grnCount} GRN${locks.grnCount === 1 ? '' : 's'}: ${locks.grnNumbers.join(', ')}`);
    }
    if (locks.receivedQty > 0) {
      references.push(`goods received qty ${locks.receivedQty}`);
    }
    if (locks.invoicedCount > 0) {
      references.push(`${locks.invoicedCount} supplier invoice/AP record${locks.invoicedCount === 1 ? '' : 's'}`);
    }

    const actionText = action === 'delete' ? 'deleted' : 'edited';
    const referenceText = references.length > 0 ? references.join('; ') : 'downstream documents';
    return `PR ${pr?.pr_number || pr?.id || 'selected'} cannot be ${actionText} because it has linked ${referenceText}. Use the PR Trail to review the linked documents. Only Super Admin can override edit locks; delete is blocked once downstream documents exist.`;
  }

  private async getPrLifecycleLocks(tenantId: string, id: string) {
    const { data: pr, error: prError } = await this.supabase
      .from('purchase_requisitions')
      .select('id, pr_number, status')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (prError || !pr) throw new NotFoundException('Purchase Requisition not found');

    const [{ data: rfqRows, error: rfqError }, { data: poRows, error: poError }] = await Promise.all([
      this.supabase
        .from('rfqs')
        .select('id, rfq_number, status')
        .eq('tenant_id', tenantId)
        .eq('pr_id', id),
      this.supabase
        .from('purchase_orders')
        .select('id, po_number, status, purchase_order_items(id, ordered_qty, received_qty, pr_item_id)')
        .eq('tenant_id', tenantId)
        .eq('pr_id', id),
    ]);

    if (rfqError) throw new BadRequestException(rfqError.message);
    if (poError) throw new BadRequestException(poError.message);

    const poIds = (poRows || []).map((po: any) => String(po.id)).filter(Boolean);
    let grnRows: any[] = [];
    if (poIds.length > 0) {
      const { data, error } = await this.supabase
        .from('grns')
        .select('id, grn_number, status, qc_completed, invoice_approved, po_id')
        .eq('tenant_id', tenantId)
        .in('po_id', poIds);
      if (error) throw new BadRequestException(error.message);
      grnRows = Array.isArray(data) ? data : [];
    }

    const poItems = (poRows || []).flatMap((po: any) =>
      Array.isArray(po.purchase_order_items)
        ? po.purchase_order_items.map((item: any) => ({ ...item, po_number: po.po_number }))
        : [],
    );

    const receivedQty = poItems.reduce((sum: number, item: any) => sum + Number(item?.received_qty || 0), 0);
    const orderedQty = poItems.reduce((sum: number, item: any) => sum + Number(item?.ordered_qty || 0), 0);
    const invoicedCount = grnRows.filter((grn: any) => grn.invoice_approved === true).length;

    return {
      pr,
      rfqCount: (rfqRows || []).length,
      rfqNumbers: (rfqRows || []).map((row: any) => row.rfq_number).filter(Boolean),
      poCount: (poRows || []).length,
      poNumbers: (poRows || []).map((row: any) => row.po_number).filter(Boolean),
      grnCount: grnRows.length,
      grnNumbers: grnRows.map((row: any) => row.grn_number).filter(Boolean),
      orderedQty,
      receivedQty,
      invoicedCount,
      hasDownstream: (rfqRows || []).length > 0 || (poRows || []).length > 0 || grnRows.length > 0 || receivedQty > 0 || invoicedCount > 0,
      hasHardDownstream: (poRows || []).length > 0 || grnRows.length > 0 || receivedQty > 0 || invoicedCount > 0,
    };
  }

  async update(tenantId: string, id: string, data: any, userId: string, options: { overrideLifecycleLock?: boolean } = {}) {
    await this.projectsService.ensureSchema();
    const current = await this.getRequisitionForTransition(tenantId, id);
    const currentStatus = normalizeStatus(current.status);
    if (!['DRAFT', 'SUBMITTED', 'REJECTED'].includes(currentStatus)) {
      throw new BadRequestException(`A requisition in ${currentStatus} status cannot be edited.`);
    }

    const lifecycleLocks = await this.getPrLifecycleLocks(tenantId, id);
    if (lifecycleLocks.hasDownstream && !options.overrideLifecycleLock) {
      throw new BadRequestException(this.formatLifecycleLockMessage('edit', lifecycleLocks.pr, lifecycleLocks));
    }

    let existingRowsForSync: any[] = [];
    if (Array.isArray(data.items)) {
      const { data: existingRows, error: existingError } = await this.supabase
        .from('purchase_requisition_items')
        .select('id, item_id, item_code, item_name, vendor_id, uom, requested_qty, estimated_rate, required_date, payment_terms, delivery_terms, remarks, description, total_ordered_qty')
        .eq('pr_id', id);
      if (existingError) throw new BadRequestException(existingError.message);
      existingRowsForSync = existingRows || [];

      const retainedIds = new Set(
        data.items
          .map((item: any) => String(item?.id || '').trim())
          .filter((itemId: string) => isUuid(itemId)),
      );
      const removedRows = existingRowsForSync.filter((item: any) => !retainedIds.has(String(item.id)));
      const removedIds = removedRows.map((item: any) => String(item.id));
      if (lifecycleLocks.hasHardDownstream && removedIds.length > 0) {
        throw new BadRequestException(
          `Line items cannot be removed from PR ${current.pr_number || id} because PO/GRN documents already exist. Create a revision/correction flow instead of changing the source PR lines.`,
        );
      }
      if (removedRows.some((item: any) => Number(item.total_ordered_qty || 0) > 0)) {
        throw new BadRequestException('An item already converted to a purchase order cannot be removed.');
      }
      if (removedIds.length > 0) {
        const [{ data: poLinks }, { data: rfqLinks }] = await Promise.all([
          this.supabase.from('purchase_order_items').select('id').in('pr_item_id', removedIds).limit(1),
          this.supabase.from('rfq_items').select('id').in('pr_item_id', removedIds).limit(1),
        ]);
        if ((poLinks || []).length > 0 || (rfqLinks || []).length > 0) {
          throw new BadRequestException('An item referenced by a PO or RFQ cannot be removed.');
        }
      }
    }
    const department = normalizeDepartment(data.department ?? current.department);
    if (data.items) {
      assertNoDuplicateRequisitionItems(data.items);
      await this.assertItemsVerified(tenantId, data.items, {
        allowUnverifiedRndTemporary: department === 'R&D',
      });
      await this.assertVendorsVerified(
        tenantId,
        (Array.isArray(data.items) ? data.items : []).map((item: any) => item.vendorId ?? item.vendor_id ?? null),
      );
    }

    const nowIso = new Date().toISOString();
    const requestedStatus = data.status === undefined ? currentStatus : normalizeStatus(data.status);
    if (!['DRAFT', 'SUBMITTED'].includes(requestedStatus)) {
      throw new BadRequestException('An edited requisition can only be saved as draft or submitted.');
    }
    this.assertLineDeliveryDates(data.items || [], requestedStatus);
    if (requestedStatus === 'DRAFT' && currentStatus !== 'DRAFT') {
      throw new BadRequestException('A submitted or rejected requisition cannot be moved back to draft.');
    }
    const projectId = String(data.projectId ?? data.project_id ?? '').trim() || null;
    const projectName = String(data.projectName ?? data.project_name ?? '').trim() || null;
    const updateData: any = {
      department,
      project_id: projectId,
      project_name: projectName,
      required_date: requireCurrentOrFutureDate(data.requiredDate, 'Required date'),
      priority: data.priority,
      // Keep backward/forward compatibility with different client field names
      purpose: data.purpose ?? data.notes ?? null,
      delivery_address: data.deliveryAddress ?? data.delivery_address ?? null,
      notes: data.notes ?? data.purpose ?? null,
      remarks: data.remarks ?? null,
      updated_by: userId,
      updated_at: nowIso,
    };
    if (currentStatus === 'SUBMITTED') {
      updateData.approved_by = null;
      updateData.approved_at = null;
      updateData.rejected_by = null;
      updateData.rejected_at = null;
      updateData.rejection_reason = null;
      updateData.current_approval_level = 0;
    }

    const { error } = await this.supabase
      .from('purchase_requisitions')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    if (projectId) {
      await this.projectsService.logEvent(tenantId, projectId, userId, {
        eventType: 'PR_UPDATED',
        sourceModule: 'PURCHASE_REQUISITION',
        sourceId: id,
        sourceNumber: current.pr_number,
        remarks: `Purchase requisition updated for ${department}`,
        metadata: { fromStatus: currentStatus, toStatus: requestedStatus },
      });
    }

    if (Array.isArray(data.items)) {
      const existingRows = existingRowsForSync;

      const existingById = new Map((existingRows || []).map((item: any) => [String(item.id), item]));
      const retainedIds = new Set<string>();
      const newRows: any[] = [];

      const buildItemPayload = (item: any) => ({
        item_id: item.itemId ?? item.item_id ?? null,
        item_code: item.itemCode,
        item_name: item.itemName,
        vendor_id: item.vendorId ?? item.vendor_id ?? null,
        description: item.description ?? item.specifications ?? null,
        uom: item.uom ?? null,
        requested_qty: item.requestedQty ?? item.quantity ?? null,
        estimated_rate: item.estimatedRate ?? item.estimatedPrice ?? null,
        required_date: normalizeDateOnly(item.requiredDate),
        payment_terms: item.paymentTerms ?? null,
        delivery_terms: item.deliveryTerms ?? null,
        remarks: item.remarks ?? item.notes ?? null,
        updated_by: userId,
        updated_at: nowIso,
      });

      const hasMeaningfulLineChange = (existing: any, next: any) => {
        const text = (value: any) => String(value ?? '').trim();
        const num = (value: any) => Number(value ?? 0);
        return (
          text(existing.item_id) !== text(next.item_id) ||
          text(existing.item_code) !== text(next.item_code) ||
          text(existing.item_name) !== text(next.item_name) ||
          text(existing.vendor_id) !== text(next.vendor_id) ||
          text(existing.uom) !== text(next.uom) ||
          num(existing.requested_qty) !== num(next.requested_qty) ||
          num(existing.estimated_rate) !== num(next.estimated_rate) ||
          text(existing.required_date) !== text(next.required_date) ||
          text(existing.payment_terms) !== text(next.payment_terms) ||
          text(existing.delivery_terms) !== text(next.delivery_terms) ||
          text(existing.remarks) !== text(next.remarks) ||
          text(existing.description) !== text(next.description)
        );
      };

      for (const item of data.items) {
        const incomingId = String(item?.id || '').trim();
        if (isUuid(incomingId) && existingById.has(incomingId)) {
          retainedIds.add(incomingId);
          const nextPayload = buildItemPayload(item);
          const existing = existingById.get(incomingId);
          if (lifecycleLocks.hasHardDownstream && hasMeaningfulLineChange(existing, nextPayload)) {
            throw new BadRequestException(
              `Line items on PR ${current.pr_number || id} cannot be changed because PO/GRN documents already exist. Create a revision/correction flow instead of changing the source PR lines.`,
            );
          }
          const { error: itemError } = await this.supabase
            .from('purchase_requisition_items')
            .update(nextPayload)
            .eq('pr_id', id)
            .eq('id', incomingId);
          if (itemError) throw new BadRequestException(`Failed to update PR item: ${itemError.message}`);
        } else {
          if (lifecycleLocks.hasHardDownstream) {
            throw new BadRequestException(
              `New line items cannot be added to PR ${current.pr_number || id} because PO/GRN documents already exist. Create a new PR or controlled revision instead.`,
            );
          }
          newRows.push({ pr_id: id, ...buildItemPayload(item), updated_by: undefined, updated_at: undefined });
        }
      }

      if (newRows.length > 0) {
        const sanitizedRows = newRows.map(({ updated_by, updated_at, ...row }) => row);
        const { error: insertError } = await this.supabase.from('purchase_requisition_items').insert(sanitizedRows);
        if (insertError) throw new BadRequestException(`Failed to add PR item: ${insertError.message}`);
      }

      const removedRows = (existingRows || []).filter((item: any) => !retainedIds.has(String(item.id)));
      const removedIds = removedRows.map((item: any) => String(item.id));
      if (removedIds.length > 0) {
        const { error: deleteError } = await this.supabase.from('purchase_requisition_items').delete().in('id', removedIds).eq('pr_id', id);
        if (deleteError) throw new BadRequestException(`Failed to remove PR item: ${deleteError.message}`);
      }
    }

    if (requestedStatus === 'SUBMITTED' && currentStatus !== 'SUBMITTED') {
      return this.submit(tenantId, id, userId);
    }
    if (currentStatus === 'SUBMITTED') {
      await this.logApprovalAction({ tenantId, prId: id, actorId: userId, action: 'EDITED_AND_RESUBMITTED', fromStatus: currentStatus, toStatus: 'SUBMITTED' });
    }
    return this.findOne(tenantId, id);
  }

  async submit(tenantId: string, id: string, userId: string) {
    const pr = await this.getRequisitionForTransition(tenantId, id);
    const fromStatus = normalizeStatus(pr.status);
    if (!['DRAFT', 'REJECTED'].includes(fromStatus)) {
      throw new BadRequestException(`Only draft or rejected requisitions can be submitted; current status is ${fromStatus}.`);
    }
    if (!String(pr.department || '').trim() || !pr.required_date || !(pr.purchase_requisition_items || []).length) {
      throw new BadRequestException('Department, required date, and at least one item are required before submission.');
    }
    if (String(pr.required_date).slice(0, 10) < todayDateOnly()) {
      throw new BadRequestException(`Required date cannot be before today (${todayDateOnly()}).`);
    }
    const { error } = await this.supabase
      .from('purchase_requisitions')
      .update({
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        approved_by: null,
        approved_at: null,
        current_approval_level: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    await this.logApprovalAction({ tenantId, prId: id, actorId: userId, action: 'SUBMITTED', fromStatus, toStatus: 'SUBMITTED' });
    return this.findOne(tenantId, id);
  }

  async approve(tenantId: string, id: string, userId: string, options: { overrideMakerChecker?: boolean } = {}) {
    const pr = await this.getRequisitionForTransition(tenantId, id);
    const fromStatus = normalizeStatus(pr.status);
    if (fromStatus !== 'SUBMITTED') throw new BadRequestException(`Only submitted requisitions can be approved; current status is ${fromStatus}.`);
    if (!options.overrideMakerChecker && (
      String(pr.requested_by || '') === String(userId || '') ||
      String(pr.updated_by || '') === String(userId || '')
    )) throw new BadRequestException('You cannot approve a purchase requisition that you created or last edited.');

    await this.assertItemsVerified(tenantId, pr.purchase_requisition_items || [], {
      approvalGate: true,
    });

    const totalAmount = (pr.purchase_requisition_items || []).reduce(
      (sum: number, item: any) => sum + Number(item.requested_qty || 0) * Number(item.estimated_rate || 0),
      0,
    );
    const rules = await this.getMatchingApprovalRules(tenantId, pr.department, totalAmount);
    const currentLevel = Number(pr.current_approval_level || 0);
    const currentRule = rules[currentLevel];
    if (!options.overrideMakerChecker && currentRule) {
      await this.assertRuleApprover(userId, currentRule);
    } else if (!options.overrideMakerChecker && rules.length === 0) {
      await this.assertDefaultApprover(tenantId, userId);
    }
    const finalApproval = options.overrideMakerChecker || rules.length === 0 || currentLevel + 1 >= rules.length;
    const nextStatus = finalApproval ? 'APPROVED' : 'SUBMITTED';

    const { error } = await this.supabase
      .from('purchase_requisitions')
      .update({
        status: nextStatus,
        approved_by: finalApproval ? userId : null,
        approved_at: finalApproval ? new Date().toISOString() : null,
        current_approval_level: currentLevel + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    await this.logApprovalAction({
      tenantId,
      prId: id,
      actorId: userId,
      action: finalApproval ? 'APPROVED' : 'APPROVED_STEP',
      fromStatus,
      toStatus: nextStatus,
      approvalLevel: currentLevel + 1,
      approvalRuleId: options.overrideMakerChecker ? null : currentRule?.id || null,
    });
    return this.findOne(tenantId, id);
  }

  async reject(tenantId: string, id: string, userId: string, reason: string, options: { overrideMakerChecker?: boolean } = {}) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) throw new BadRequestException('A rejection reason is required.');
    const pr = await this.getRequisitionForTransition(tenantId, id);
    const fromStatus = normalizeStatus(pr.status);
    if (fromStatus !== 'SUBMITTED') throw new BadRequestException(`Only submitted requisitions can be rejected; current status is ${fromStatus}.`);
    if (!options.overrideMakerChecker && (
      String(pr.requested_by || '') === String(userId || '') ||
      String(pr.updated_by || '') === String(userId || '')
    )) throw new BadRequestException('You cannot reject a purchase requisition that you created or last edited.');
    const { error } = await this.supabase
      .from('purchase_requisitions')
      .update({
        status: 'REJECTED',
        approved_by: null,
        approved_at: null,
        rejected_by: userId,
        rejected_at: new Date().toISOString(),
        rejection_reason: normalizedReason,
        current_approval_level: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    await this.logApprovalAction({ tenantId, prId: id, actorId: userId, action: 'REJECTED', fromStatus, toStatus: 'REJECTED', reason: normalizedReason });
    return this.findOne(tenantId, id);
  }

  async sendRFQ(tenantId: string, requisitionId: string, userId: string, body: any) {
    let vendorIds: string[] = Array.isArray(body?.vendorIds) ? body.vendorIds : [];
    const vendorEmails: string[] = Array.isArray(body?.vendorEmails) ? body.vendorEmails : [];
    let itemVendors: Array<{ itemId: string; vendorIds: string[] }> = Array.isArray(body?.itemVendors) ? body.itemVendors : [];

    const recipientOverrides: Record<string, string> =
      body?.recipientOverrides && typeof body.recipientOverrides === 'object'
        ? body.recipientOverrides
        : body?.recipient_overrides && typeof body.recipient_overrides === 'object'
          ? body.recipient_overrides
          : {};

    const subjectOverride: string | undefined =
      typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim() : undefined;

    const customMessage: string | undefined =
      typeof body?.customMessage === 'string'
        ? body.customMessage
        : typeof body?.custom_message === 'string'
          ? body.custom_message
          : undefined;

    if (vendorIds.length === 0 && vendorEmails.length === 0) {
      throw new BadRequestException('vendorIds or vendorEmails is required');
    }

    const pr = await this.findOne(tenantId, requisitionId);

    if (!pr) {
      throw new NotFoundException('Purchase Requisition not found');
    }

    const baseStatus = normalizeStatus((pr as any)?.status);
    if (baseStatus !== PR_WORKFLOW_STATUS.APPROVED) {
      throw new BadRequestException('PR must be fully approved before sending RFQ');
    }

    const normalizedSelection = await this.normalizeRfqVendorSelection(tenantId, pr, vendorIds, itemVendors);
    vendorIds = normalizedSelection.vendorIds;
    itemVendors = normalizedSelection.itemVendors;

    await this.assertVendorsVerified(tenantId, vendorIds);

    // Save item-vendor mappings to pr_item_rfq_vendors table
    if (itemVendors.length > 0) {
      // First, delete existing mappings for this PR
      await this.supabase
        .from('pr_item_rfq_vendors')
        .delete()
        .in('pr_item_id', itemVendors.map(iv => iv.itemId));

      // Then insert new mappings
      const mappings = itemVendors.flatMap(iv => 
        iv.vendorIds.map(vendorId => ({
          pr_item_id: iv.itemId,
          vendor_id: vendorId,
        }))
      );

      if (mappings.length > 0) {
        const { error: mappingError } = await this.supabase
          .from('pr_item_rfq_vendors')
          .insert(mappings);

        if (mappingError) {
          console.error('Error saving item-vendor mappings:', mappingError);
          // Don't throw - continue with RFQ sending even if mapping save fails
        }
      }
    }

    const vendorLookups = await Promise.all(
      vendorIds.map(async (vendorId) => this.vendorsService.findOne(tenantId, vendorId)),
    );

    const recipients: Array<{ email: string; name: string; vendorId?: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (let i = 0; i < vendorLookups.length; i++) {
      const vendor = vendorLookups[i];
      if (vendor?.email) {
        recipients.push({ 
          email: vendor.email, 
          name: vendor.name || 'Vendor',
          vendorId: vendorIds[i]
        });
      } else {
        skipped.push({ name: vendor?.name || vendorIds[i], reason: 'No email address on file' });
      }
    }

    for (const email of vendorEmails) {
      if (typeof email === 'string' && email.trim()) {
        recipients.push({ email: email.trim(), name: 'Vendor' });
      }
    }

    // Apply recipient overrides (by vendorId or by original email)
    for (const recipient of recipients) {
      const keyByVendorId = recipient.vendorId ? String(recipient.vendorId) : '';
      const keyByEmail = String(recipient.email || '').trim();
      const override =
        (keyByVendorId && typeof recipientOverrides[keyByVendorId] === 'string'
          ? recipientOverrides[keyByVendorId]
          : undefined) ||
        (keyByEmail && typeof recipientOverrides[keyByEmail] === 'string'
          ? recipientOverrides[keyByEmail]
          : undefined);

      if (typeof override === 'string' && override.trim()) {
        recipient.email = override.trim();
      }
    }

    if (recipients.length === 0) {
      throw new BadRequestException('No valid vendor emails found');
    }

    const rawResponseDate = body?.responseDate || body?.response_date;
    const responseDate = rawResponseDate ? normalizeDateOnly(rawResponseDate) : null;
    if (rawResponseDate && !responseDate) {
      throw new BadRequestException('RFQ response date must be a valid date between 2000-01-01 and 2100-12-31.');
    }
    const remarks = body?.remarks;

    const persistedRfqByVendorId = new Map<string, any>();

    for (let index = 0; index < recipients.length; index++) {
      const recipient = recipients[index];
      if (!recipient?.vendorId) continue;

      const recipientKey = recipient.vendorId || recipient.email || String(index + 1);
      const rfqNumber = buildRfqNumber(pr.pr_number, recipientKey, index);
      const vendorItems = (pr.purchase_requisition_items || []).filter((item: any) => {
        if (itemVendors.length === 0) return true;
        return itemVendors
          .filter((iv) => iv.vendorIds.includes(recipient.vendorId as string))
          .some((iv) => iv.itemId === item.id);
      });

      const payloadNotes = {
        ...(safeJsonParse(undefined)),
        remarks: remarks || null,
        subject: subjectOverride || null,
        customMessage: customMessage || null,
        recipientEmail: recipient.email,
        responseDate: responseDate || null,
      };

      const { data: existingRfq } = await this.supabase
        .from('rfqs')
        .select('id, notes')
        .eq('tenant_id', tenantId)
        .eq('pr_id', requisitionId)
        .eq('vendor_id', recipient.vendorId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let rfqRecord = existingRfq;

      if (existingRfq?.id) {
        const mergedNotes = {
          ...safeJsonParse(existingRfq.notes),
          ...payloadNotes,
        };

        const { data: updatedRfq, error: updateRfqError } = await this.supabase
          .from('rfqs')
          .update({
            rfq_number: rfqNumber,
            sent_at: new Date().toISOString(),
            response_deadline: responseDate || null,
            status: 'SENT',
            notes: JSON.stringify(mergedNotes),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingRfq.id)
          .select()
          .single();

        if (updateRfqError) throw new BadRequestException(updateRfqError.message);
        rfqRecord = updatedRfq;

        await this.supabase.from('rfq_items').delete().eq('rfq_id', existingRfq.id);
      } else {
        const { data: createdRfq, error: createRfqError } = await this.supabase
          .from('rfqs')
          .insert({
            tenant_id: tenantId,
            pr_id: requisitionId,
            rfq_number: rfqNumber,
            vendor_id: recipient.vendorId,
            sent_at: new Date().toISOString(),
            response_deadline: responseDate || null,
            status: 'SENT',
            notes: JSON.stringify(payloadNotes),
            created_by: userId,
          })
          .select()
          .single();

        if (createRfqError) throw new BadRequestException(createRfqError.message);
        rfqRecord = createdRfq;
      }

      if (rfqRecord?.id && vendorItems.length > 0) {
        const { error: rfqItemsError } = await this.supabase
          .from('rfq_items')
          .insert(
            vendorItems.map((item: any) => ({
              rfq_id: rfqRecord.id,
              pr_item_id: item.id,
              item_code: item.item_code || item.itemCode || null,
              item_name: item.item_name || item.itemName || null,
              requested_qty: item.requested_qty ?? item.quantity ?? 0,
              uom: item.uom || null,
              vendor_notes: null,
            })),
          );

        if (rfqItemsError) throw new BadRequestException(rfqItemsError.message);
      }

      persistedRfqByVendorId.set(String(recipient.vendorId), rfqRecord);
    }

    const sendResults = await Promise.allSettled(
      recipients.map(async (recipient, index) => {
        // Filter items for this vendor based on itemVendors mappings
        let vendorItems = pr.purchase_requisition_items || [];
        
        if (recipient.vendorId && itemVendors.length > 0) {
          // Get items assigned to this vendor
          const assignedItemIds = itemVendors
            .filter(iv => iv.vendorIds.includes(recipient.vendorId as string))
            .map(iv => iv.itemId);
          
          vendorItems = vendorItems.filter((item: any) => 
            assignedItemIds.includes(item.id)
          );
        }

        const items = vendorItems.map((item: any) => ({
          item_name: item.item_name || item.itemName || '-',
          item_code: item.item_code || item.itemCode || '-',
          uom: item.uom || '-',
          description: item.description || item.specifications || item.remarks || '-',
          quantity: item.requested_qty ?? item.quantity ?? 0,
          required_date: item.required_date || pr.required_date || '-',
        }));

        // Generate Excel attachment for this vendor
        const excelBuffer = await this.rfqExcelService.generateRFQExcel({
          prNumber: pr.pr_number,
          department: pr.department,
          requiredDate: pr.required_date,
          vendorName: recipient.name,
          vendorEmail: recipient.email,
          items: vendorItems.map((item: any) => ({
            item_id: item.id,
            item_code: item.item_code || item.itemCode || '-',
            item_name: item.item_name || item.itemName || '-',
            description: item.description || item.specifications || item.remarks || '',
            requested_qty: item.requested_qty ?? item.quantity ?? 0,
            uom: item.uom || '-',
            required_date: item.required_date || pr.required_date,
            specifications: item.specifications || '',
          })),
          responseDeadline: responseDate,
          remarks: remarks,
        });

        const excelFilename = this.rfqExcelService.generateFilename(pr.pr_number, recipient.name);
        
        const attachments = [
          ...(Array.isArray(body?.attachments) ? body.attachments : []),
          {
            filename: excelFilename,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ];

        const rfqRecord = recipient.vendorId ? persistedRfqByVendorId.get(String(recipient.vendorId)) : null;
        const rfqNumber = rfqRecord?.rfq_number || buildRfqNumber(pr.pr_number, recipient.vendorId || recipient.email, index);

        return this.emailService.sendRFQ(recipient.email, {
          tenant_id: tenantId,
          rfq_number: rfqNumber,
          vendor_name: recipient.name,
          items,
          response_date: responseDate,
          remarks,
          subject: subjectOverride,
          custom_message: customMessage,
          attachments,
        });
      }),
    );

    const sent: Array<{ email: string; messageId?: string }> = [];
    const failed: Array<{ email: string; error: string }> = [];

    sendResults.forEach((result, idx) => {
      const email = recipients[idx]?.email;
      if (!email) return;
      if (result.status === 'fulfilled') {
        sent.push({ email, messageId: (result.value as any)?.messageId });
      } else {
        failed.push({ email, error: result.reason?.message || String(result.reason) });
      }
    });

    return {
      requisition_id: requisitionId,
      sent_count: sent.length,
      failed_count: failed.length,
      skipped_count: skipped.length,
      sent,
      failed,
      skipped,
    };
  }

  async previewRFQ(tenantId: string, requisitionId: string, body: any) {
    let vendorIds: string[] = Array.isArray(body?.vendorIds) ? body.vendorIds : [];
    const vendorEmails: string[] = Array.isArray(body?.vendorEmails) ? body.vendorEmails : [];
    let itemVendors: Array<{ itemId: string; vendorIds: string[] }> = Array.isArray(body?.itemVendors)
      ? body.itemVendors
      : [];

    const recipientOverrides: Record<string, string> =
      body?.recipientOverrides && typeof body.recipientOverrides === 'object'
        ? body.recipientOverrides
        : body?.recipient_overrides && typeof body.recipient_overrides === 'object'
          ? body.recipient_overrides
          : {};

    const subjectOverride: string | undefined =
      typeof body?.subject === 'string' && body.subject.trim() ? body.subject.trim() : undefined;

    const customMessage: string | undefined =
      typeof body?.customMessage === 'string'
        ? body.customMessage
        : typeof body?.custom_message === 'string'
          ? body.custom_message
          : undefined;

    if (vendorIds.length === 0 && vendorEmails.length === 0) {
      throw new BadRequestException('vendorIds or vendorEmails is required');
    }

    const pr = await this.findOne(tenantId, requisitionId);

    if (!pr) {
      throw new NotFoundException('Purchase Requisition not found');
    }

    const baseStatus = normalizeStatus((pr as any)?.status);
    if (baseStatus !== PR_WORKFLOW_STATUS.APPROVED) {
      throw new BadRequestException('PR must be fully approved before previewing RFQ');
    }

    const normalizedSelection = await this.normalizeRfqVendorSelection(tenantId, pr, vendorIds, itemVendors);
    vendorIds = normalizedSelection.vendorIds;
    itemVendors = normalizedSelection.itemVendors;

    await this.assertVendorsVerified(tenantId, vendorIds);

    const vendorLookups = await Promise.all(
      vendorIds.map(async (vendorId) => this.vendorsService.findOne(tenantId, vendorId)),
    );

    const recipients: Array<{ email: string; name: string; vendorId?: string }> = [];

    for (let i = 0; i < vendorLookups.length; i++) {
      const vendor = vendorLookups[i];
      if (vendor?.email) {
        recipients.push({
          email: vendor.email,
          name: vendor.name || 'Vendor',
          vendorId: vendorIds[i],
        });
      }
    }

    for (const email of vendorEmails) {
      if (typeof email === 'string' && email.trim()) {
        recipients.push({ email: email.trim(), name: 'Vendor' });
      }
    }

    // Apply recipient overrides (by vendorId or by original email)
    for (const recipient of recipients) {
      const keyByVendorId = recipient.vendorId ? String(recipient.vendorId) : '';
      const keyByEmail = String(recipient.email || '').trim();
      const override =
        (keyByVendorId && typeof recipientOverrides[keyByVendorId] === 'string'
          ? recipientOverrides[keyByVendorId]
          : undefined) ||
        (keyByEmail && typeof recipientOverrides[keyByEmail] === 'string'
          ? recipientOverrides[keyByEmail]
          : undefined);

      if (typeof override === 'string' && override.trim()) {
        recipient.email = override.trim();
      }
    }

    if (recipients.length === 0) {
      throw new BadRequestException('No valid vendor emails found');
    }

    const rawResponseDate = body?.responseDate || body?.response_date;
    const responseDate = rawResponseDate ? normalizeDateOnly(rawResponseDate) : null;
    if (rawResponseDate && !responseDate) {
      throw new BadRequestException('RFQ response date must be a valid date between 2000-01-01 and 2100-12-31.');
    }
    const remarks = body?.remarks;

    const previews = await Promise.all(
      recipients.map(async (recipient, index) => {
        // Filter items for this vendor based on itemVendors mappings
        let vendorItems = pr.purchase_requisition_items || [];

        if (recipient.vendorId && itemVendors.length > 0) {
          const assignedItemIds = itemVendors
            .filter((iv) => iv.vendorIds.includes(recipient.vendorId as string))
            .map((iv) => iv.itemId);

          vendorItems = vendorItems.filter((item: any) => assignedItemIds.includes(item.id));
        }

        const items = vendorItems.map((item: any) => ({
          item_name: item.item_name || item.itemName || '-',
          item_code: item.item_code || item.itemCode || '-',
          uom: item.uom || '-',
          description: item.description || item.specifications || item.remarks || '-',
          quantity: item.requested_qty ?? item.quantity ?? 0,
          required_date: item.required_date || pr.required_date || '-',
        }));

        const excelBuffer = await this.rfqExcelService.generateRFQExcel({
          prNumber: pr.pr_number,
          department: pr.department,
          requiredDate: pr.required_date,
          vendorName: recipient.name,
          vendorEmail: recipient.email,
          items: vendorItems.map((item: any) => ({
            item_id: item.id,
            item_code: item.item_code || item.itemCode || '-',
            item_name: item.item_name || item.itemName || '-',
            description: item.description || item.specifications || item.remarks || '',
            requested_qty: item.requested_qty ?? item.quantity ?? 0,
            uom: item.uom || '-',
            required_date: item.required_date || pr.required_date,
            specifications: item.specifications || '',
          })),
          responseDeadline: responseDate,
          remarks: remarks,
        });

        const excelFilename = this.rfqExcelService.generateFilename(pr.pr_number, recipient.name);

        const attachments = [
          ...(Array.isArray(body?.attachments) ? body.attachments : []),
          {
            filename: excelFilename,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ];

        const preview = await this.emailService.buildRFQPreview(recipient.email, {
          tenant_id: tenantId,
          rfq_number: buildRfqNumber(pr.pr_number, recipient.vendorId || recipient.email, index),
          vendor_name: recipient.name,
          items,
          response_date: responseDate,
          remarks,
          subject: subjectOverride,
          custom_message: customMessage,
          attachments,
        });

        return {
          vendor_name: recipient.name,
          vendor_id: recipient.vendorId,
          ...preview,
        };
      }),
    );

    return {
      rfq_number: null,
      requisition_id: requisitionId,
      preview_count: previews.length,
      previews,
    };
  }

  async delete(tenantId: string, id: string) {
    const lifecycleLocks = await this.getPrLifecycleLocks(tenantId, id);
    if (lifecycleLocks.hasDownstream) {
      throw new BadRequestException(this.formatLifecycleLockMessage('delete', lifecycleLocks.pr, lifecycleLocks));
    }

    const { error: itemError } = await this.supabase
      .from('purchase_requisition_items')
      .delete()
      .eq('pr_id', id);
    if (itemError) throw new BadRequestException(`Failed to delete PR items: ${itemError.message}`);

    const { error } = await this.supabase
      .from('purchase_requisitions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new BadRequestException(error.message);
    return { message: 'Purchase Requisition deleted successfully' };
  }

  async findRFQs(tenantId: string, requisitionId: string) {
    const { data, error } = await this.supabase
      .from('rfqs')
      .select(`
        *,
        vendor:vendors(id, code, name, email),
        rfq_items(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('pr_id', requisitionId)
      .order('created_at', { ascending: false });

    if (error) throw new BadRequestException(error.message);

    return (Array.isArray(data) ? data : []).map((row: any) => {
      const meta = safeJsonParse(row.notes);
      return {
        ...row,
        meta,
        follow_up_date: meta.followUpDate || null,
        follow_up_notes: meta.followUpNotes || null,
        response_attachments: Array.isArray(meta.responseAttachments) ? meta.responseAttachments : [],
        response_remarks: meta.responseRemarks || null,
      };
    });
  }

  async recordRFQResponse(
    tenantId: string,
    requisitionId: string,
    rfqId: string,
    userId: string,
    body: any,
  ) {
    const { data: rfq, error } = await this.supabase
      .from('rfqs')
      .select(`
        *,
        rfq_items(*)
      `)
      .eq('tenant_id', tenantId)
      .eq('pr_id', requisitionId)
      .eq('id', rfqId)
      .single();

    if (error || !rfq) throw new NotFoundException('RFQ not found');

    const existingMeta = safeJsonParse(rfq.notes);
    const normalizedFollowUpDate = normalizeDateOnly(body?.followUpDate || body?.follow_up_date);
    const attachments = Array.isArray(body?.attachments)
      ? body.attachments
          .map((item: any) => ({
            url: String(item?.url || '').trim(),
            name: String(item?.name || '').trim() || 'Attachment',
          }))
          .filter((item: any) => item.url)
      : [];

    const itemPayload = Array.isArray(body?.items) ? body.items : [];
    const existingItems = Array.isArray(rfq.rfq_items) ? rfq.rfq_items : [];

    for (const item of itemPayload) {
      const match = existingItems.find(
        (rfqItem: any) =>
          (item?.id && String(rfqItem.id) === String(item.id)) ||
          (item?.prItemId && String(rfqItem.pr_item_id) === String(item.prItemId)),
      );

      const itemUpdate = {
        vendor_quoted_price:
          item?.quotedPrice === '' || item?.quotedPrice == null ? null : Number(item.quotedPrice),
        vendor_quoted_lead_time:
          item?.leadTime === '' || item?.leadTime == null ? null : Number(item.leadTime),
        vendor_notes: String(item?.notes || '').trim() || null,
      };

      if (match?.id) {
        const { error: updateItemError } = await this.supabase
          .from('rfq_items')
          .update(itemUpdate)
          .eq('id', match.id);

        if (updateItemError) throw new BadRequestException(updateItemError.message);
      } else if (item?.prItemId) {
        const { error: createItemError } = await this.supabase
          .from('rfq_items')
          .insert({
            rfq_id: rfqId,
            pr_item_id: item.prItemId,
            item_code: item.itemCode || null,
            item_name: item.itemName || null,
            requested_qty: item.requestedQty ?? null,
            uom: item.uom || null,
            ...itemUpdate,
          });

        if (createItemError) throw new BadRequestException(createItemError.message);
      }
    }

    const updatedMeta = {
      ...existingMeta,
      responseRemarks: String(body?.remarks || body?.responseRemarks || '').trim() || null,
      followUpDate: normalizedFollowUpDate,
      followUpNotes: String(body?.followUpNotes || body?.follow_up_notes || '').trim() || null,
      responseAttachments: attachments,
      respondedBy: userId,
    };

    const { error: updateRfqError } = await this.supabase
      .from('rfqs')
      .update({
        status: 'RECEIVED',
        vendor_quote_received_at: body?.receivedAt || new Date().toISOString(),
        notes: JSON.stringify(updatedMeta),
        updated_at: new Date().toISOString(),
      })
      .eq('id', rfqId);

    if (updateRfqError) throw new BadRequestException(updateRfqError.message);

    const rows = await this.findRFQs(tenantId, requisitionId);
    return rows.find((row: any) => String(row.id) === String(rfqId)) || { id: rfqId };
  }

  private async attachWorkflowMetadata(tenantId: string, requisitions: any[]) {
    if (!Array.isArray(requisitions) || requisitions.length === 0) return requisitions;

    const prIds = requisitions
      .map((row: any) => String(row?.id || '').trim())
      .filter(Boolean);

    if (prIds.length === 0) return requisitions;

    const [{ data: rfqRows }, { data: poRows }] = await Promise.all([
      this.supabase
        .from('rfqs')
        .select('id, pr_id, status, sent_at, response_deadline, vendor_quote_received_at, notes')
        .eq('tenant_id', tenantId)
        .in('pr_id', prIds),
      this.supabase
        .from('purchase_orders')
        .select('id, po_number, pr_id, status, purchase_order_items(id, ordered_qty, received_qty)')
        .eq('tenant_id', tenantId)
        .in('pr_id', prIds),
    ]);

    const poIds = (Array.isArray(poRows) ? poRows : [])
      .map((row: any) => String(row?.id || '').trim())
      .filter(Boolean);

    let grnRows: any[] = [];
    let grnItemRows: any[] = [];
    if (poIds.length > 0) {
      const { data: fetchedGrns } = await this.supabase
        .from('grns')
        .select('id, grn_number, po_id, status, qc_completed')
        .eq('tenant_id', tenantId)
        .in('po_id', poIds);
      grnRows = Array.isArray(fetchedGrns) ? fetchedGrns : [];

      const grnIds = grnRows.map((row: any) => String(row?.id || '').trim()).filter(Boolean);
      if (grnIds.length > 0) {
        const { data: fetchedGrnItems } = await this.supabase
          .from('grn_items')
          .select('grn_id, received_qty, accepted_qty, rejected_qty, qc_status')
          .in('grn_id', grnIds);
        grnItemRows = Array.isArray(fetchedGrnItems) ? fetchedGrnItems : [];
      }
    }

    const rfqSummaryByPr = new Map<string, any>();
    (Array.isArray(rfqRows) ? rfqRows : []).forEach((row: any) => {
      const prId = String(row?.pr_id || '').trim();
      if (!prId) return;
      const current = rfqSummaryByPr.get(prId) || {
        total: 0,
        sentCount: 0,
        receivedCount: 0,
        nextFollowUpDate: null,
      };
      const notes = safeJsonParse(row?.notes);
      const normalized = normalizeStatus(row?.status);
      current.total += 1;
      if (row?.sent_at) current.sentCount += 1;
      if (normalized === 'RECEIVED' || row?.vendor_quote_received_at) current.receivedCount += 1;
      const followUpDate = String(notes.followUpDate || '').trim();
      if (followUpDate && (!current.nextFollowUpDate || followUpDate < current.nextFollowUpDate)) {
        current.nextFollowUpDate = followUpDate;
      }
      rfqSummaryByPr.set(prId, current);
    });

    const poSummaryByPr = new Map<string, any>();
    const grnsByPo = new Map<string, any[]>();
    (Array.isArray(grnRows) ? grnRows : []).forEach((row: any) => {
      const poId = String(row?.po_id || '').trim();
      if (!poId || ['REJECTED', 'CANCELLED'].includes(normalizeStatus(row?.status))) return;
      const rows = grnsByPo.get(poId) || [];
      rows.push(row);
      grnsByPo.set(poId, rows);
    });

    const grnItemsByGrn = new Map<string, any[]>();
    (Array.isArray(grnItemRows) ? grnItemRows : []).forEach((row: any) => {
      const grnId = String(row?.grn_id || '').trim();
      if (!grnId) return;
      const rows = grnItemsByGrn.get(grnId) || [];
      rows.push(row);
      grnItemsByGrn.set(grnId, rows);
    });

    (Array.isArray(poRows) ? poRows : []).forEach((row: any) => {
      const prId = String(row?.pr_id || '').trim();
      if (!prId) return;
      const current = poSummaryByPr.get(prId) || {
        total: 0,
        draftCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        cancelledCount: 0,
        totalOrderedQty: 0,
        totalReceivedQty: 0,
        grnCount: 0,
        completedGrnCount: 0,
        poNumbers: [],
        grnNumbers: [],
      };
      const poStatus = normalizeStatus(row?.status);
      current.total += 1;
      if (poStatus === 'DRAFT') current.draftCount += 1;
      if (['PENDING', 'SUBMITTED', 'AWAITING_APPROVAL'].includes(poStatus)) current.pendingCount += 1;
      if (poStatus === 'APPROVED') current.approvedCount += 1;
      if (poStatus === 'REJECTED') current.rejectedCount += 1;
      if (poStatus === 'CANCELLED') current.cancelledCount += 1;
      if (row?.po_number && current.poNumbers.length < 8) current.poNumbers.push(row.po_number);

      const items = Array.isArray(row?.purchase_order_items) ? row.purchase_order_items : [];
      let poItemReceivedQty = 0;
      items.forEach((item: any) => {
        current.totalOrderedQty += Number(item?.ordered_qty || 0);
        poItemReceivedQty += Number(item?.received_qty || 0);
      });

      const poGrns = grnsByPo.get(String(row?.id || '').trim()) || [];
      current.grnCount += poGrns.length;
      let grnReceivedQtyForPo = 0;
      poGrns.forEach((grn: any) => {
        if (grn?.qc_completed || normalizeStatus(grn?.status) === 'COMPLETED') current.completedGrnCount += 1;
        if (grn?.grn_number && current.grnNumbers.length < 8) current.grnNumbers.push(grn.grn_number);

        const grnItems = grnItemsByGrn.get(String(grn?.id || '').trim()) || [];
        const grnReceivedQty = grnItems.reduce((sum: number, item: any) => {
          const qcStatus = normalizeStatus(item?.qc_status);
          const receivedQty = Number(item?.received_qty || 0);
          const acceptedQty = Number(item?.accepted_qty || 0);
          const rejectedQty = Number(item?.rejected_qty || 0);
          const qcRecorded =
            ['ACCEPTED', 'PARTIAL', 'REJECTED'].includes(qcStatus) || acceptedQty > 0 || rejectedQty > 0;
          return sum + (qcRecorded ? acceptedQty : receivedQty);
        }, 0);
        grnReceivedQtyForPo += grnReceivedQty;
      });
      current.totalReceivedQty += Math.max(poItemReceivedQty, grnReceivedQtyForPo);
      poSummaryByPr.set(prId, current);
    });

    return requisitions.map((row: any) => {
      const prId = String(row?.id || '').trim();
      const baseStatus = normalizeStatus(row?.status);
      const items = Array.isArray(row?.purchase_requisition_items) ? row.purchase_requisition_items : [];
      const rfqSummary = rfqSummaryByPr.get(prId) || {
        total: 0,
        sentCount: 0,
        receivedCount: 0,
        nextFollowUpDate: null,
      };
      const poSummary = poSummaryByPr.get(prId) || {
        total: 0,
        draftCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        cancelledCount: 0,
        totalOrderedQty: 0,
        totalReceivedQty: 0,
        grnCount: 0,
        completedGrnCount: 0,
        poNumbers: [],
        grnNumbers: [],
      };

      const requestedTotal = items.reduce((sum: number, item: any) => sum + Number(item?.requested_qty || 0), 0);
      const poDone = requestedTotal > 0 && poSummary.totalOrderedQty >= requestedTotal - 1e-9;
      const goodsReceived = poSummary.totalOrderedQty > 0 && poSummary.totalReceivedQty >= poSummary.totalOrderedQty;

      let workflowStatus = baseStatus;
      let workflowDetail: string | null = null;

      if (baseStatus === 'REJECTED') {
        workflowStatus = PR_WORKFLOW_STATUS.REJECTED;
      } else if (baseStatus === 'DRAFT' || !baseStatus) {
        workflowStatus = PR_WORKFLOW_STATUS.DRAFT;
      } else if (baseStatus === 'SUBMITTED') {
        workflowStatus = PR_WORKFLOW_STATUS.AWAITING_APPROVAL;
        workflowDetail = `Level ${Number(row?.current_approval_level || 0) + 1}`;
      } else if (baseStatus === PR_WORKFLOW_STATUS.APPROVED) {
        if (goodsReceived) {
          workflowStatus = PR_WORKFLOW_STATUS.GOODS_RCVD;
        } else if (poDone) {
          workflowStatus = PR_WORKFLOW_STATUS.PO_DONE;
        } else if (rfqSummary.receivedCount > 0) {
          workflowStatus = PR_WORKFLOW_STATUS.RFQ_RCVD;
          workflowDetail = 'Received';
        } else if (rfqSummary.sentCount > 0) {
          workflowStatus = PR_WORKFLOW_STATUS.RFQ_ISSUED;
          workflowDetail = 'Yes';
        } else {
          workflowStatus = PR_WORKFLOW_STATUS.APPROVED;
        }
      }

      return {
        ...row,
        workflow_status: workflowStatus,
        workflow_status_detail: workflowDetail,
        workflow_status_label: buildWorkflowStatusLabel(workflowStatus, workflowDetail),
        rfq_summary: rfqSummary,
        po_summary: poSummary,
      };
    });
  }

  private async generatePRNumber(tenantId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `PR-${year}-${month}`;

    // Fetch ALL PR numbers to find the global max sequence (never resets on month rollover)
    const { data } = await this.supabase
      .from('purchase_requisitions')
      .select('pr_number')
      .eq('tenant_id', tenantId)
      .like('pr_number', 'PR-%');

    let maxSeq = 0;
    for (const row of (data || [])) {
      const match = /^PR-\d{4}-\d{2}-(\d+)$/.exec(row.pr_number || '');
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    return `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
  }
}
