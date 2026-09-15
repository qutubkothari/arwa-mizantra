import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class DocumentRevisionsService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!,
  );

  async findAllByDocument(req: any, documentId: string) {
    try {
      const tenantId = req.user.tenantId;
      console.log('Fetching revisions for document:', documentId, 'tenant:', tenantId);

      const { data, error } = await this.supabase
        .from('document_revisions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching revisions:', error);
        throw new Error(error.message);
      }
    
    // Return empty array if no data
    if (!data || data.length === 0) {
      return [];
    }
    
    // Fetch user details separately if needed
    const userIds = [
      ...new Set([
        ...data.map(d => d.created_by).filter(Boolean),
        ...data.map(d => d.approved_by).filter(Boolean)
      ])
    ];
    
    if (userIds.length === 0) {
      return data.map(rev => ({
        ...rev,
        created_by_user: null,
        approved_by_user: null
      }));
    }
    
    try {
      const { data: users, error: userError } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('tenant_id', tenantId)
        .in('id', userIds);
      
      if (userError) {
        console.error('Error fetching users:', userError);
        // Return data without user details if user fetch fails
        return data.map(rev => ({
          ...rev,
          created_by_user: null,
          approved_by_user: null
        }));
      }
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      
      return data.map(rev => ({
        ...rev,
        created_by_user: rev.created_by ? userMap.get(rev.created_by) || null : null,
        approved_by_user: rev.approved_by ? userMap.get(rev.approved_by) || null : null
      }));
    } catch (e) {
      console.error('Exception fetching users:', e);
      // Return data without user details if exception occurs
      return data.map(rev => ({
        ...rev,
        created_by_user: null,
        approved_by_user: null
      }));
    }
    } catch (error) {
      console.error('Fatal error in findAllByDocument:', error);
      throw error;
    }
  }

  async findOne(req: any, id: string) {
    const tenantId = req.user.tenantId;

    const { data, error } = await this.supabase
      .from('document_revisions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error) throw new Error(error.message);
    
    if (!data) {
      return null;
    }
    
    // Fetch user details separately if needed
    const userIds = [data.created_by, data.approved_by].filter(Boolean);
    
    if (userIds.length === 0) {
      return {
        ...data,
        created_by_user: null,
        approved_by_user: null
      };
    }
    
    try {
      const { data: users, error: userError } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('tenant_id', tenantId)
        .in('id', userIds);
      
      if (userError) {
        console.error('Error fetching users:', userError);
        return {
          ...data,
          created_by_user: null,
          approved_by_user: null
        };
      }
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      
      return {
        ...data,
        created_by_user: data.created_by ? userMap.get(data.created_by) || null : null,
        approved_by_user: data.approved_by ? userMap.get(data.approved_by) || null : null
      };
    } catch (e) {
      console.error('Exception fetching users:', e);
      return {
        ...data,
        created_by_user: null,
        approved_by_user: null
      };
    }
  }
}
