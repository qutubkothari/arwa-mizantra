import { Injectable, NotFoundException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

interface NomenclaturePrimary {
  id: string;
  tenant_id: string;
  label: string;
  acronym: string;
  hint: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface NomenclatureSecondary {
  id: string;
  tenant_id: string;
  primary_id: string;
  label: string;
  acronym: string;
  hint: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface NomenclatureResponse {
  primary: NomenclaturePrimary & { secondaries: NomenclatureSecondary[] };
}

@Injectable()
export class NomenclatureService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // Get all nomenclature data (primary with secondaries) for a tenant
  async findAll(tenantId: string) {
    const { data: primaries, error: primaryError } = await this.supabase
      .from('nomenclature_master')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (primaryError) throw primaryError;

    const { data: secondaries, error: secondaryError } = await this.supabase
      .from('nomenclature_secondary')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (secondaryError) throw secondaryError;

    // Group secondaries by primary_id
    const secondariesByPrimary = new Map<string, NomenclatureSecondary[]>();
    for (const sec of secondaries || []) {
      if (!secondariesByPrimary.has(sec.primary_id)) {
        secondariesByPrimary.set(sec.primary_id, []);
      }
      secondariesByPrimary.get(sec.primary_id)!.push(sec);
    }

    // Build response
    const result = (primaries || []).map(primary => ({
      ...primary,
      secondaries: secondariesByPrimary.get(primary.id) || []
    }));

    return result;
  }

  // Get single primary with secondaries
  async findOne(tenantId: string, id: string) {
    const { data: primary, error: primaryError } = await this.supabase
      .from('nomenclature_master')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (primaryError) throw new NotFoundException('Primary category not found');

    const { data: secondaries, error: secondaryError } = await this.supabase
      .from('nomenclature_secondary')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('primary_id', id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (secondaryError) throw secondaryError;

    return {
      ...primary,
      secondaries: secondaries || []
    };
  }

  // Create primary category
  async createPrimary(tenantId: string, data: {
    label: string;
    acronym: string;
    hint?: string;
    sort_order?: number;
  }) {
    const { data: primary, error } = await this.supabase
      .from('nomenclature_master')
      .insert({
        tenant_id: tenantId,
        label: data.label.trim(),
        acronym: data.acronym.trim().toUpperCase(),
        hint: data.hint?.trim() || null,
        sort_order: data.sort_order || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return { ...primary, secondaries: [] };
  }

  // Update primary category
  async updatePrimary(tenantId: string, id: string, data: {
    label?: string;
    acronym?: string;
    hint?: string;
    sort_order?: number;
    is_active?: boolean;
  }) {
    const updateData: any = {};
    if (data.label !== undefined) updateData.label = data.label.trim();
    if (data.acronym !== undefined) updateData.acronym = data.acronym.trim().toUpperCase();
    if (data.hint !== undefined) updateData.hint = data.hint?.trim() || null;
    if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const { data: primary, error } = await this.supabase
      .from('nomenclature_master')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new NotFoundException('Primary category not found');
    return primary;
  }

  // Delete primary category (with cascade)
  async deletePrimary(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('nomenclature_master')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  }

  // Create secondary category
  async createSecondary(tenantId: string, data: {
    primary_id: string;
    label: string;
    acronym: string;
    hint?: string;
    sort_order?: number;
  }) {
    // Verify primary exists
    const { data: primary, error: primaryError } = await this.supabase
      .from('nomenclature_master')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', data.primary_id)
      .single();

    if (primaryError || !primary) {
      throw new NotFoundException('Primary category not found');
    }

    const { data: secondary, error } = await this.supabase
      .from('nomenclature_secondary')
      .insert({
        tenant_id: tenantId,
        primary_id: data.primary_id,
        label: data.label.trim(),
        acronym: data.acronym.trim().toUpperCase(),
        hint: data.hint?.trim() || null,
        sort_order: data.sort_order || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return secondary;
  }

  // Update secondary category
  async updateSecondary(tenantId: string, id: string, data: {
    label?: string;
    acronym?: string;
    hint?: string;
    sort_order?: number;
    is_active?: boolean;
  }) {
    const updateData: any = {};
    if (data.label !== undefined) updateData.label = data.label.trim();
    if (data.acronym !== undefined) updateData.acronym = data.acronym.trim().toUpperCase();
    if (data.hint !== undefined) updateData.hint = data.hint?.trim() || null;
    if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const { data: secondary, error } = await this.supabase
      .from('nomenclature_secondary')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new NotFoundException('Secondary category not found');
    return secondary;
  }

  // Delete secondary category
  async deleteSecondary(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('nomenclature_secondary')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  }

  // Seed default data
  async seed(tenantId: string) {
    const { data, error } = await this.supabase
      .rpc('seed_nomenclature_data', { p_tenant_id: tenantId });

    if (error) {
      // If RPC fails, it might be because the function doesn't exist yet
      // Return empty array - data will need to be created manually
      console.warn('Seed function not available or failed:', error.message);
      return [];
    }

    return data;
  }
}
