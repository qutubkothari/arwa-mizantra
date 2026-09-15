import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class TenantService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseKey = this.configService.get<string>('SUPABASE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Tenant not found');
    }

    return data;
  }

  async update(
    id: string,
    dto: {
      name?: string;
      domain?: string;
      address?: string;
      phone?: string;
      email?: string;
      tax_id?: string;
      logo_url?: string;
      settings?: Record<string, unknown>;
      market_profile?: 'INDIA' | 'UAE' | 'EGYPT';
      default_currency?: 'INR' | 'AED' | 'EGP';
      tax_regime?: string;
      locale?: string;
      timezone?: string;
    },
  ) {
    const sanitizedDto = this.sanitizeTenantUpdate(dto);

    const { data, error } = await this.supabase
      .from('tenants')
      .update(sanitizedDto)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Tenant not found');
    }

    return data;
  }

  private sanitizeTenantUpdate<T extends { settings?: Record<string, unknown> }>(dto: T): T {
    const input = dto as T & Record<string, unknown>;
    if ('market_profile' in input) {
      const profile = String(input.market_profile || 'INDIA').trim().toUpperCase();
      if (!['INDIA', 'UAE', 'EGYPT'].includes(profile)) {
        throw new Error('Market profile must be INDIA, UAE or EGYPT');
      }
      const regionalDefaults = profile === 'EGYPT'
        ? { default_currency: 'EGP', tax_regime: 'EGYPT_VAT', locale: 'ar-EG', timezone: 'Africa/Cairo' }
        : profile === 'UAE'
          ? { default_currency: 'AED', tax_regime: 'UAE_VAT', locale: 'en-AE', timezone: 'Asia/Dubai' }
          : { default_currency: 'INR', tax_regime: 'GST', locale: 'en-IN', timezone: 'Asia/Kolkata' };
      dto = {
        ...input,
        market_profile: profile,
        ...regionalDefaults,
      } as T;
    }

    if (!dto.settings || typeof dto.settings !== 'object' || Array.isArray(dto.settings)) {
      return dto;
    }

    const deliveryAddresses = dto.settings.deliveryAddresses;
    if (!Array.isArray(deliveryAddresses)) {
      return dto;
    }

    return {
      ...dto,
      settings: {
        ...dto.settings,
        deliveryAddresses: this.normalizeDeliveryAddresses(deliveryAddresses),
      },
    };
  }

  private normalizeDeliveryAddresses(value: unknown[]): Array<{ id: string; name: string; address: string }> {
    const addresses: Array<{ id: string; name: string; address: string }> = [];

    for (const entry of value) {
      const record =
        typeof entry === 'string'
          ? { id: this.makeAddressId(), name: entry.split('\n')[0] || 'Delivery Address', address: entry }
          : entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>)
            : null;

      const address = String(record?.address ?? '').trim();
      if (!address) continue;

      if (addresses.some((saved) => this.areSameDeliveryAddress(saved.address, address))) continue;

      addresses.push({
        id: String(record?.id ?? '').trim() || this.makeAddressId(),
        name: String(record?.name ?? '').trim() || address.split('\n')[0] || 'Delivery Address',
        address,
      });
    }

    return addresses;
  }

  private normalizeAddressKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private areSameDeliveryAddress(left: string, right: string): boolean {
    const leftKey = this.normalizeAddressKey(left);
    const rightKey = this.normalizeAddressKey(right);
    if (!leftKey || !rightKey) return false;
    if (leftKey === rightKey) return true;
    if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;

    const leftPin = leftKey.match(/\b\d{6}\b/)?.[0];
    const rightPin = rightKey.match(/\b\d{6}\b/)?.[0];
    if (!leftPin || leftPin !== rightPin) return false;

    const leftTokens = this.addressTokens(left);
    const rightTokens = this.addressTokens(right);
    if (!leftTokens.size || !rightTokens.size) return false;

    let common = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) common++;
    }

    return common / Math.min(leftTokens.size, rightTokens.size) >= 0.7;
  }

  private addressTokens(value: string): Set<string> {
    const noise = new Set(['and', 'the', 'near', 'road', 'floor', 'no', 'llp', 'pvt', 'ltd']);
    return new Set(
      this.normalizeAddressKey(value)
        .split(' ')
        .filter((token) => token.length > 1 && !noise.has(token)),
    );
  }

  private makeAddressId(): string {
    return `addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
