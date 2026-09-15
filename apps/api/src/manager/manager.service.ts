import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface PendingApproval {
  id: string;
  number: string;
  type: 'PR' | 'PO' | 'GRN' | 'JO' | 'QC' | 'SES';
  requestedBy: string;
  requestedDate: string;
  amount?: number;
  status: string;
  priority?: string;
}

@Injectable()
export class ManagerService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async getPendingApprovals(tenantId: string, managerId: string): Promise<PendingApproval[]> {
    const approvals: PendingApproval[] = [];

    const resolveUserNames = async (userIds: string[]) => {
      const ids = Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean)));
      const names = new Map<string, string>();
      if (ids.length === 0) return names;

      const { data, error } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, username, email')
        .eq('tenant_id', tenantId)
        .in('id', ids);

      if (error) {
        console.error('[ManagerService] User name lookup failed:', error.message);
        return names;
      }

      for (const user of data || []) {
        const displayName =
          `${(user as any).first_name || ''} ${(user as any).last_name || ''}`.trim() ||
          (user as any).username ||
          (user as any).email ||
          (user as any).id;
        names.set(String((user as any).id), displayName);
      }
      return names;
    };

    try {
      // Best-effort manager existence check only. Do not blank the dashboard if
      // the JWT stores the id in a different claim or the user row cannot be
      // hydrated; approvals are tenant-scoped below.
      if (managerId) {
        const { error: managerError } = await this.supabase
          .from('users')
          .select('id')
          .eq('id', managerId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (managerError) {
          console.error('[ManagerService] Manager lookup failed:', managerError.message);
        }
      }

      // 1. Purchase Requisitions (SUBMITTED status)
      const { data: prs } = await this.supabase
        .from('purchase_requisitions')
        .select(`
          id,
          pr_number,
          created_at,
          status,
          priority,
          requested_by
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'SUBMITTED')
        .order('created_at', { ascending: false });

      if (prs) {
        const userNames = await resolveUserNames(prs.map((pr: any) => pr.requested_by));
        for (const pr of prs) {
          approvals.push({
            id: pr.id,
            number: pr.pr_number,
            type: 'PR',
            requestedBy: userNames.get(String(pr.requested_by || '')) || 'Unknown',
            requestedDate: pr.created_at,
            status: pr.status,
            priority: pr.priority,
          });
        }
      }

      // 2. Purchase Orders awaiting manager approval.
      // Current PO screens/reminders use `status=PENDING`; older rows may still
      // carry the approval state in `pr_po_status`, so include both.
      const { data: pos } = await this.supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          created_at,
          status,
          pr_po_status,
          total_amount,
          created_by
        `)
        .eq('tenant_id', tenantId)
        .or('status.eq.PENDING,pr_po_status.eq.PENDING')
        .order('created_at', { ascending: false });

      if (pos) {
        const userNames = await resolveUserNames(pos.map((po: any) => po.created_by));
        for (const po of pos) {
          approvals.push({
            id: po.id,
            number: po.po_number,
            type: 'PO',
            requestedBy: userNames.get(String(po.created_by || '')) || 'Unknown',
            requestedDate: po.created_at,
            amount: po.total_amount,
            status: po.status || po.pr_po_status || 'PENDING',
          });
        }
      }

      // 3. GRNs (DRAFT status - awaiting QC or approval)
      const { data: grns } = await this.supabase
        .from('grns')
        .select(`
          id,
          grn_number,
          created_at,
          status,
          total_amount,
          created_by
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'DRAFT')
        .order('created_at', { ascending: false });

      if (grns) {
        const userNames = await resolveUserNames(grns.map((grn: any) => grn.created_by));
        for (const grn of grns) {
          approvals.push({
            id: grn.id,
            number: grn.grn_number,
            type: 'GRN',
            requestedBy: userNames.get(String(grn.created_by || '')) || 'Unknown',
            requestedDate: grn.created_at,
            amount: grn.total_amount,
            status: grn.status,
          });
        }
      }

      // 4. Job Orders (PENDING or DRAFT status)
      const { data: jos } = await this.supabase
        .from('production_job_orders')
        .select(`
          id,
          job_order_number,
          created_at,
          status,
          created_by
        `)
        .eq('tenant_id', tenantId)
        .in('status', ['PENDING', 'DRAFT'])
        .order('created_at', { ascending: false });

      if (jos) {
        const userNames = await resolveUserNames(jos.map((jo: any) => jo.created_by));
        for (const jo of jos) {
          approvals.push({
            id: jo.id,
            number: jo.job_order_number,
            type: 'JO',
            requestedBy: userNames.get(String(jo.created_by || '')) || 'Unknown',
            requestedDate: jo.created_at,
            status: jo.status,
          });
        }
      }

      // 5. QC pending from GRNs. This matches the global Action Required
      // widget (`/purchase/grn?pendingQc=true`) so manager counts do not drift.
      const { data: qcGrns } = await this.supabase
        .from('grns')
        .select(`
          id,
          grn_number,
          created_at,
          status,
          qc_completed,
          total_amount,
          created_by,
          po_id,
          vendor_id
        `)
        .eq('tenant_id', tenantId)
        .eq('qc_completed', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (qcGrns) {
        const userNames = await resolveUserNames(qcGrns.map((grn: any) => grn.created_by));
        for (const grn of qcGrns) {
          approvals.push({
            id: grn.id,
            number: grn.grn_number,
            type: 'QC',
            requestedBy: userNames.get(String(grn.created_by || '')) || 'Unknown',
            requestedDate: grn.created_at,
            amount: grn.total_amount,
            status: 'QC pending',
          });
        }
      }

      // 6. Service Entry Sheets (SES) awaiting service-owner acceptance.
      // The table is created lazily with the service-entry feature; keep the
      // manager dashboard available on tenants where it has not been opened yet.
      const { data: serviceEntries, error: serviceEntriesError } = await this.supabase
        .from('service_entry_sheets')
        .select('id, ses_number, created_at, status, created_by, po:purchase_orders(po_number), vendor:vendors(name), items:service_entry_sheet_items(amount)')
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING_APPROVAL')
        .order('created_at', { ascending: false });

      if (serviceEntriesError) {
        console.warn('[ManagerService] Service Entry Sheet queue unavailable:', serviceEntriesError.message);
      } else if (serviceEntries) {
        const userNames = await resolveUserNames(serviceEntries.map((entry: any) => entry.created_by));
        for (const entry of serviceEntries) {
          approvals.push({
            id: entry.id,
            number: entry.ses_number,
            type: 'SES',
            requestedBy: userNames.get(String(entry.created_by || '')) || (entry as any).vendor?.name || 'Unknown',
            requestedDate: entry.created_at,
            amount: ((entry as any).items || []).reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0),
            status: 'Awaiting service acceptance',
          });
        }
      }

      // Sort by date descending
      approvals.sort((a, b) => new Date(b.requestedDate).getTime() - new Date(a.requestedDate).getTime());

      return approvals;
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
      return [];
    }
  }
}
