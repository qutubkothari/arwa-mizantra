import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CategoriesService {
  private supabase: SupabaseClient;

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
      .from('item_category_options')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data;
  }

  async create(tenantId: string, name: string) {
    const { data, error } = await this.supabase
      .from('item_category_options')
      .insert({
        tenant_id: tenantId,
        name: name.trim().toUpperCase().replace(/\s+/g, '_'),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(tenantId: string, id: string, name: string) {
    const { data, error } = await this.supabase
      .from('item_category_options')
      .update({
        name: name.trim().toUpperCase().replace(/\s+/g, '_'),
      })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async delete(tenantId: string, id: string) {
    const { error } = await this.supabase
      .from('item_category_options')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  }

  async seed(tenantId: string) {
    const defaultCategories = [
      'RAW_MATERIAL',
      'CAPITAL_GOODS',
      'CONSUMABLE',
      'PACKING_MATERIAL',
      'SERVICES',
    ];

    const { data: existing } = await this.supabase
      .from('item_category_options')
      .select('name')
      .eq('tenant_id', tenantId);

    const existingNames = existing?.map(c => c.name) || [];
    const toInsert = defaultCategories.filter(cat => !existingNames.includes(cat));

    if (toInsert.length > 0) {
      const { data, error } = await this.supabase
        .from('item_category_options')
        .insert(toInsert.map(name => ({ tenant_id: tenantId, name })))
        .select();

      if (error) throw error;
      return data;
    }

    return [];
  }
}
