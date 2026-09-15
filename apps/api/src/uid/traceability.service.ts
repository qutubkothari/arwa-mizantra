import { Injectable } from '@nestjs/common';
import { UidSupabaseService } from './services/uid-supabase.service';

export interface TraceabilityRecord {
  uid: string;
  uid_id?: string;
  grn_id?: string;
  po_id?: string;
  pr_id?: string;
  parent_pr_id?: string;
  job_order_id?: string;
  part_code: string;
  part_name: string;
  product_category: string;
  supplier_name: string;
  supplier_code: string;
  supplier_gst: string;
  invoice_number: string;
  invoice_date: string;
  invoice_file_url?: string;
  invoice_file_name?: string;
  invoice_file_type?: string;
  grn_number: string;
  grn_date: string;
  po_number?: string;
  po_date?: string;
  po_total_amount?: number;
  po_quotation_ref?: string;
  po_attachments?: Array<Record<string, any>>;
  pr_number?: string;
  parent_pr_number?: string;
  work_order_number: string;
  work_order_status: string;
  work_order_quantity: number;
  work_order_start_date: string;
  work_order_completion_date: string;
  assembly_item_code: string;
  assembly_name: string;
  level: number;
  usage_type: string;
  work_order_path: string[];
  report_generated_at: string;
}

export interface GrnTraceability {
  uid: string;
  part_code: string;
  part_name: string;
  quantity_received: number;
  supplier_name: string;
  invoice_number: string;
  highest_assembly_level: number;
  final_assemblies: string[];
}

export interface WorkOrderMaterialTraceability {
  material_uid: string;
  material_part_code: string;
  material_part_name: string;
  supplier_name: string;
  grn_number: string;
  invoice_number: string;
  source_job_order: string;
  assembly_produced: string;
  produced_quantity: number;
}

@Injectable()
export class TraceabilityService {
  constructor(private readonly uidSupabaseService: UidSupabaseService) {}

  private normalizeJsonArray(value: any): Array<Record<string, any>> {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return this.normalizeJsonArray(parsed);
      } catch {
        return [];
      }
    }
    return [];
  }

  private async enrichTraceabilityRecords(
    tenantId: string,
    records: TraceabilityRecord[],
  ): Promise<TraceabilityRecord[]> {
    if (!records.length) return records;

    const uidValues = Array.from(new Set(records.map((record) => record.uid).filter(Boolean)));
    const grnNumbers = Array.from(new Set(records.map((record) => record.grn_number).filter(Boolean)));
    const workOrderNumbers = Array.from(new Set(records.map((record) => record.work_order_number).filter(Boolean)));

    const registryByUid = new Map<string, any>();
    if (uidValues.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('uid_registry')
        .select('id, uid, grn_id, purchase_order_id, job_order_id')
        .eq('tenant_id', tenantId)
        .in('uid', uidValues);

      if (error) throw new Error(`Failed to fetch UID links: ${error.message}`);
      for (const row of data || []) registryByUid.set(row.uid, row);
    }

    const grnByNumber = new Map<string, any>();
    if (grnNumbers.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('grns')
        .select('id, grn_number, po_id, invoice_file_url, invoice_file_name, invoice_file_type')
        .eq('tenant_id', tenantId)
        .in('grn_number', grnNumbers);

      if (error) throw new Error(`Failed to fetch GRN document links: ${error.message}`);
      for (const row of data || []) grnByNumber.set(row.grn_number, row);
    }

    const poIds = Array.from(new Set(
      records
        .flatMap((record) => {
          const registry = registryByUid.get(record.uid);
          const grn = record.grn_number ? grnByNumber.get(record.grn_number) : null;
          return [registry?.purchase_order_id, grn?.po_id];
        })
        .filter(Boolean),
    ));

    const poById = new Map<string, any>();
    if (poIds.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('purchase_orders')
        .select('id, po_number, po_date, total_amount, grand_total, pr_id, parent_pr_id, quotation_ref, attachments')
        .eq('tenant_id', tenantId)
        .in('id', poIds);

      if (error) throw new Error(`Failed to fetch PO trace links: ${error.message}`);
      for (const row of data || []) poById.set(row.id, row);
    }

    const prIds = Array.from(new Set(
      Array.from(poById.values())
        .flatMap((po) => [po.pr_id, po.parent_pr_id])
        .filter(Boolean),
    ));

    const prById = new Map<string, any>();
    if (prIds.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('purchase_requisitions')
        .select('id, pr_number')
        .eq('tenant_id', tenantId)
        .in('id', prIds);

      if (error) throw new Error(`Failed to fetch PR trace links: ${error.message}`);
      for (const row of data || []) prById.set(row.id, row);
    }

    const jobOrderIds = Array.from(new Set(records.map((record) => registryByUid.get(record.uid)?.job_order_id).filter(Boolean)));
    const jobOrderById = new Map<string, any>();
    if (jobOrderIds.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('production_job_orders')
        .select('id, job_order_number')
        .eq('tenant_id', tenantId)
        .in('id', jobOrderIds);

      if (error) throw new Error(`Failed to fetch job order trace links: ${error.message}`);
      for (const row of data || []) jobOrderById.set(row.id, row);
    }

    const jobOrderByNumber = new Map<string, any>();
    if (workOrderNumbers.length > 0) {
      const { data, error } = await this.uidSupabaseService.client
        .from('production_job_orders')
        .select('id, job_order_number')
        .eq('tenant_id', tenantId)
        .in('job_order_number', workOrderNumbers);

      if (error) throw new Error(`Failed to fetch work order trace links: ${error.message}`);
      for (const row of data || []) jobOrderByNumber.set(row.job_order_number, row);
    }

    return records.map((record) => {
      const registry = registryByUid.get(record.uid);
      const grn = record.grn_number ? grnByNumber.get(record.grn_number) : null;
      const poId = registry?.purchase_order_id || grn?.po_id;
      const po = poId ? poById.get(poId) : null;
      const pr = po?.pr_id ? prById.get(po.pr_id) : null;
      const parentPr = po?.parent_pr_id ? prById.get(po.parent_pr_id) : null;
      const registryJobOrder = registry?.job_order_id ? jobOrderById.get(registry.job_order_id) : null;
      const workOrder = record.work_order_number ? jobOrderByNumber.get(record.work_order_number) : null;

      return {
        ...record,
        uid_id: record.uid_id || registry?.id,
        grn_id: grn?.id || registry?.grn_id,
        po_id: po?.id,
        pr_id: pr?.id,
        parent_pr_id: parentPr?.id,
        job_order_id: registryJobOrder?.id || workOrder?.id,
        invoice_file_url: grn?.invoice_file_url || null,
        invoice_file_name: grn?.invoice_file_name || null,
        invoice_file_type: grn?.invoice_file_type || null,
        po_number: po?.po_number || null,
        po_date: po?.po_date || null,
        po_total_amount: po?.grand_total ?? po?.total_amount ?? null,
        po_quotation_ref: po?.quotation_ref || null,
        po_attachments: this.normalizeJsonArray(po?.attachments),
        pr_number: pr?.pr_number || null,
        parent_pr_number: parentPr?.pr_number || null,
        work_order_number: record.work_order_number || registryJobOrder?.job_order_number || null,
      };
    });
  }

  /**
   * Get full traceability for a specific UID
   */
  async getUidTraceability(uid: string, tenantId: string): Promise<TraceabilityRecord[]> {
    const { data, error } = await this.uidSupabaseService.client
      .rpc('get_uid_traceability', {
        p_uid: uid,
        p_tenant_id: tenantId,
      });

    if (error) {
      throw new Error(`Failed to fetch UID traceability: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get traceability for all UIDs from a specific GRN
   */
  async getGrnTraceability(grnNumber: string, tenantId: string): Promise<GrnTraceability[]> {
    const { data, error } = await this.uidSupabaseService.client
      .rpc('get_grn_uids_traceability', {
        p_grn_number: grnNumber,
        p_tenant_id: tenantId,
      });

    if (error) {
      throw new Error(`Failed to fetch GRN traceability: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get material traceability for a specific Work Order
   */
  async getWorkOrderTraceability(
    workOrderNumber: string,
    tenantId: string,
  ): Promise<WorkOrderMaterialTraceability[]> {
    const { data, error } = await this.uidSupabaseService.client
      .rpc('get_work_order_material_traceability', {
        p_work_order_number: workOrderNumber,
        p_tenant_id: tenantId,
      });

    if (error) {
      throw new Error(`Failed to fetch work order traceability: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get full traceability report with filters
   */
  async getTraceabilityReport(tenantId: string, filters: any): Promise<{
    data: TraceabilityRecord[];
    total: number;
    limit: number;
    offset: number;
  }> {
    let query = this.uidSupabaseService.client
      .from('uid_traceability_report')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Apply filters
    if (filters.uid) {
      query = query.eq('uid', filters.uid);
    }
    if (filters.part_code) {
      query = query.ilike('part_code', `%${filters.part_code}%`);
    }
    if (filters.supplier_name) {
      query = query.ilike('supplier_name', `%${filters.supplier_name}%`);
    }
    if (filters.grn_number) {
      query = query.eq('grn_number', filters.grn_number);
    }
    if (filters.work_order_number) {
      query = query.eq('work_order_number', filters.work_order_number);
    }
    if (filters.assembly_name) {
      query = query.ilike('assembly_name', `%${filters.assembly_name}%`);
    }
    if (filters.level !== undefined) {
      query = query.eq('level', filters.level);
    }
    if (filters.from_date) {
      query = query.gte('grn_date', filters.from_date);
    }
    if (filters.to_date) {
      query = query.lte('grn_date', filters.to_date);
    }

    // Apply pagination
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;
    query = query.range(offset, offset + limit - 1);

    // Order by UID and level
    query = query.order('uid').order('level');

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch traceability report: ${error.message}`);
    }

    const enrichedData = await this.enrichTraceabilityRecords(tenantId, (data || []) as TraceabilityRecord[]);

    return {
      data: enrichedData,
      total: count || 0,
      limit,
      offset,
    };
  }

  /**
   * Export traceability report as CSV or Excel
   */
  async exportReport(
    tenantId: string,
    filters: any,
    format: 'csv' | 'excel',
  ): Promise<{ data: string; filename: string; contentType: string }> {
    // Get all data without pagination
    const result = await this.getTraceabilityReport(tenantId, {
      ...filters,
      limit: 10000,
      offset: 0,
    });

    const records = result.data;

    if (format === 'csv') {
      const csv = this.convertToCSV(records);
      return {
        data: csv,
        filename: `traceability-report-${new Date().toISOString().split('T')[0]}.csv`,
        contentType: 'text/csv',
      };
    } else {
      // For Excel, you would use a library like xlsx
      // This is a placeholder - implement with xlsx package
      throw new Error('Excel export not yet implemented');
    }
  }

  /**
   * Convert data to CSV format
   */
  private convertToCSV(records: TraceabilityRecord[]): string {
    if (records.length === 0) {
      return '';
    }

    // Define headers
    const headers = [
      'UID',
      'Part Code',
      'Part Name',
      'Product Category',
      'Supplier Name',
      'Supplier Code',
      'Invoice Number',
      'Invoice Date',
      'GRN Number',
      'GRN Date',
      'PO Number',
      'PO Date',
      'PR Number',
      'Parent PR Number',
      'Quotation Ref',
      'Invoice File URL',
      'Work Order Number',
      'Work Order Status',
      'Assembly Name',
      'Level',
      'Usage Type',
      'Work Order Path',
    ];

    // Create CSV rows
    const rows = records.map(record => [
      record.uid,
      record.part_code,
      record.part_name,
      record.product_category,
      record.supplier_name || '',
      record.supplier_code || '',
      record.invoice_number || '',
      record.invoice_date || '',
      record.grn_number || '',
      record.grn_date || '',
      record.po_number || '',
      record.po_date || '',
      record.pr_number || '',
      record.parent_pr_number || '',
      record.po_quotation_ref || '',
      record.invoice_file_url || '',
      record.work_order_number || '',
      record.work_order_status || '',
      record.assembly_name || '',
      record.level,
      record.usage_type,
      record.work_order_path ? record.work_order_path.join(' → ') : '',
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(field => `"${field}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  /**
   * Get traceability statistics
   */
  async getTraceabilityStats(tenantId: string): Promise<{
    total_uids: number;
    uids_from_grn: number;
    uids_from_job_orders: number;
    uids_in_assemblies: number;
    multi_level_assemblies: number;
  }> {
    const { data, error } = await this.uidSupabaseService.client.rpc('exec_sql', {
      sql: `
        SELECT 
          COUNT(DISTINCT uid) as total_uids,
          COUNT(DISTINCT CASE WHEN grn_number IS NOT NULL THEN uid END) as uids_from_grn,
          COUNT(DISTINCT CASE WHEN work_order_number IS NOT NULL AND level = 0 THEN uid END) as uids_from_job_orders,
          COUNT(DISTINCT CASE WHEN level > 0 THEN uid END) as uids_in_assemblies,
          COUNT(DISTINCT CASE WHEN level > 1 THEN uid END) as multi_level_assemblies
        FROM uid_traceability_report
        WHERE tenant_id = '${tenantId}'
      `,
    });

    if (error) {
      throw new Error(`Failed to fetch traceability stats: ${error.message}`);
    }

    return data?.[0] || {
      total_uids: 0,
      uids_from_grn: 0,
      uids_from_job_orders: 0,
      uids_in_assemblies: 0,
      multi_level_assemblies: 0,
    };
  }
}
