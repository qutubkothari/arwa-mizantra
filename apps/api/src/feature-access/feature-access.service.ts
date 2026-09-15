import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type FeatureCatalogueEntry = {
  feature_key: string;
  feature_name: string;
  module_name: string;
  description?: string | null;
  screen_route?: string | null;
  route_match?: 'EXACT' | 'PREFIX';
  api_prefixes?: string[];
  display_order?: number;
  is_enabled?: boolean;
};

@Injectable()
export class FeatureAccessService {
  private readonly supabase: SupabaseClient;
  private readonly cache = new Map<string, { expiresAt: number; entries: FeatureCatalogueEntry[] }>();

  constructor(config: ConfigService) {
    this.supabase = createClient(
      config.get<string>('SUPABASE_URL')!,
      config.get<string>('SUPABASE_KEY')!,
    );
  }

  private normalizeKey(value: unknown): string {
    return String(value || '').trim().toLowerCase();
  }

  async catalogueForTenant(tenantId: string): Promise<FeatureCatalogueEntry[]> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.entries;

    const { data: catalogue, error: catalogueError } = await this.supabase
      .from('app_feature_catalogue')
      .select('feature_key,feature_name,module_name,description,screen_route,route_match,api_prefixes,display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('feature_name', { ascending: true });

    // Compatibility during rolling deployment: absence of the additive
    // entitlement schema must never remove an existing customer's access.
    if (catalogueError) return [];

    const { data: entitlements, error: entitlementError } = await this.supabase
      .from('tenant_feature_entitlements')
      .select('feature_key,is_enabled')
      .eq('tenant_id', tenantId);
    if (entitlementError) return (catalogue || []).map((entry: any) => ({ ...entry, is_enabled: true }));

    const enabledByKey = new Map(
      (entitlements || []).map((row: any) => [this.normalizeKey(row.feature_key), row.is_enabled !== false]),
    );
    const entries = (catalogue || []).map((entry: any) => ({
      ...entry,
      api_prefixes: Array.isArray(entry.api_prefixes) ? entry.api_prefixes : [],
      // Missing rows remain enabled for backwards compatibility. The migration
      // explicitly creates rows for all existing tenants.
      is_enabled: enabledByKey.get(this.normalizeKey(entry.feature_key)) ?? true,
    }));
    this.cache.set(tenantId, { expiresAt: Date.now() + 30_000, entries });
    return entries;
  }

  async enabledFeatureKeys(tenantId: string): Promise<string[] | undefined> {
    const catalogue = await this.catalogueForTenant(tenantId);
    if (!catalogue.length) return undefined;
    return catalogue.filter((entry) => entry.is_enabled !== false).map((entry) => entry.feature_key);
  }

  async updateEntitlements(
    tenantId: string,
    userId: string,
    changes: Array<{ feature_key?: string; is_enabled?: boolean }>,
  ) {
    if (!Array.isArray(changes) || !changes.length) {
      throw new BadRequestException('Select at least one feature entitlement to update.');
    }
    const catalogue = await this.catalogueForTenant(tenantId);
    const validKeys = new Set(catalogue.map((entry) => this.normalizeKey(entry.feature_key)));
    const normalized = changes.map((change) => ({
      feature_key: this.normalizeKey(change.feature_key),
      is_enabled: change.is_enabled !== false,
    }));
    if (normalized.some((change) => !change.feature_key || !validKeys.has(change.feature_key))) {
      throw new BadRequestException('One or more feature keys are not part of the application catalogue.');
    }

    const keys = normalized.map((change) => change.feature_key);
    const { data: beforeRows } = await this.supabase
      .from('tenant_feature_entitlements')
      .select('feature_key,is_enabled')
      .eq('tenant_id', tenantId)
      .in('feature_key', keys);
    const before = new Map((beforeRows || []).map((row: any) => [this.normalizeKey(row.feature_key), row.is_enabled !== false]));

    const now = new Date().toISOString();
    const { error } = await this.supabase.from('tenant_feature_entitlements').upsert(
      normalized.map((change) => ({
        tenant_id: tenantId,
        feature_key: change.feature_key,
        is_enabled: change.is_enabled,
        updated_by: userId,
        updated_at: now,
      })),
      { onConflict: 'tenant_id,feature_key' },
    );
    if (error) throw new BadRequestException(error.message);

    const auditRows = normalized
      .filter((change) => before.get(change.feature_key) !== change.is_enabled)
      .map((change) => ({
        tenant_id: tenantId,
        feature_key: change.feature_key,
        previous_enabled: before.get(change.feature_key) ?? true,
        new_enabled: change.is_enabled,
        changed_by: userId,
      }));
    if (auditRows.length) {
      const { error: auditError } = await this.supabase.from('feature_entitlement_audit').insert(auditRows);
      if (auditError) throw new BadRequestException(auditError.message);
    }

    this.cache.delete(tenantId);
    return this.catalogueForTenant(tenantId);
  }

  async featureForApiPath(tenantId: string, rawPath: string): Promise<FeatureCatalogueEntry | null> {
    const path = String(rawPath || '').split('?')[0].replace(/^\/api\/v1/, '') || '/';
    const catalogue = await this.catalogueForTenant(tenantId);
    const matches = catalogue.filter((entry) =>
      (entry.api_prefixes || []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    );
    if (!matches.length) return null;
    return matches.sort((left, right) => {
      const leftLength = Math.max(...(left.api_prefixes || []).map((prefix) => prefix.length), 0);
      const rightLength = Math.max(...(right.api_prefixes || []).map((prefix) => prefix.length), 0);
      return rightLength - leftLength;
    })[0];
  }
}
