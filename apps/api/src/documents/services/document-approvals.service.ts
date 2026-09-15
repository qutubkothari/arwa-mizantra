import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class DocumentApprovalsService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  async findAllByDocument(req: any, documentId: string) {
    const tenantId = req.user.tenantId;

    const { data, error } = await this.supabase
      .from('document_approvals')
      .select(`
        *,
        approver_user:users!document_approvals_approver_user_id_fkey(id, first_name, last_name, email),
        approver_role:roles(id, name)
      `)
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId)
      .order('approval_sequence');

    if (error) throw new Error(error.message);
    return data;
  }

  async findPendingForUser(req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const { data, error } = await this.supabase
      .from('document_approvals')
      .select(`
        *,
        document:documents(id, document_number, title, document_type, current_revision, file_url)
      `)
      .eq('tenant_id', tenantId)
      .eq('approver_user_id', userId)
      .eq('status', 'PENDING')
      .order('due_date', { ascending: true });

    if (error) throw new Error(error.message);
    return data;
  }
}
