import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class RoleService {
  private supabase: SupabaseClient;

  private makeRoleCode(name: string): string {
    const normalized = (name || '')
      .trim()
      .toUpperCase()
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized.slice(0, 60);
  }

  private async ensureUniqueRoleCode(tenantId: string, baseCode: string): Promise<string> {
    const trimmed = (baseCode || '').trim();
    if (!trimmed) {
      // Last-resort fallback to satisfy NOT NULL constraint.
      return `ROLE_${Date.now()}`;
    }

    for (let attempt = 0; attempt < 25; attempt++) {
      const code = attempt === 0 ? trimmed : `${trimmed}_${attempt + 1}`;

      const { data, error } = await this.supabase
        .from('roles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('code', code)
        .limit(1);

      if (error) {
        throw new Error(`Failed to validate role code: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return code;
      }
    }

    return `${trimmed}_${Date.now()}`;
  }

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async findAll(tenantId: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch roles: ${error.message}`);
    }

    return data;
  }

  async findOne(id: string, tenantId: string) {
    const { data, error } = await this.supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Role not found');
    }

    return data;
  }

  async create(dto: {
    name: string;
    description: string;
    permissions: any[];
    code?: string;
    tenantId: string;
  }) {
    const baseCode = this.makeRoleCode(dto.code || dto.name);
    const code = await this.ensureUniqueRoleCode(dto.tenantId, baseCode);

    const { data, error } = await this.supabase
      .from('roles')
      .insert({
        name: dto.name,
        code,
        description: dto.description,
        permissions: dto.permissions,
        tenant_id: dto.tenantId,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create role: ${error.message}`);
    }

    return data;
  }

  async update(
    id: string,
    dto: {
      name?: string;
      description?: string;
      permissions?: any[];
    },
    tenantId: string,
  ) {
    const { data, error } = await this.supabase
      .from('roles')
      .update(dto)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Role not found');
    }

    return data;
  }

  async delete(id: string, tenantId: string) {
    const { error } = await this.supabase
      .from('roles')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      throw new Error(`Failed to delete role: ${error.message}`);
    }

    return { message: 'Role deleted successfully' };
  }
}
