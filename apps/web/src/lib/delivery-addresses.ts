import { apiClient } from '../../lib/api-client';

export type DeliveryAddressOption = {
  id: string;
  name: string;
  address: string;
};

type TenantWithSettings = {
  settings?: unknown;
};

function parseSettings(settings: unknown): Record<string, unknown> {
  if (!settings) return {};
  if (typeof settings === 'string') {
    try {
      const parsed = JSON.parse(settings);
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return typeof settings === 'object' && settings !== null ? settings as Record<string, unknown> : {};
}

function makeAddressId(): string {
  return `addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAddressKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressTokens(value: string): Set<string> {
  const noise = new Set(['and', 'the', 'near', 'road', 'floor', 'no', 'llp', 'pvt', 'ltd']);
  return new Set(
    normalizeAddressKey(value)
      .split(' ')
      .filter((token) => token.length > 1 && !noise.has(token)),
  );
}

function tokenContainment(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) {
    if (b.has(token)) common++;
  }
  return common / Math.min(a.size, b.size);
}

function areSameDeliveryAddress(left: string, right: string): boolean {
  const leftKey = normalizeAddressKey(left);
  const rightKey = normalizeAddressKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;

  const leftPin = leftKey.match(/\b\d{6}\b/)?.[0];
  const rightPin = rightKey.match(/\b\d{6}\b/)?.[0];
  const samePin = !!leftPin && leftPin === rightPin;
  const containment = tokenContainment(addressTokens(left), addressTokens(right));

  return samePin && containment >= 0.7;
}

export function normalizeDeliveryAddresses(value: unknown): DeliveryAddressOption[] {
  if (!Array.isArray(value)) return [];

  const addresses: DeliveryAddressOption[] = [];
  return value
    .map((entry): DeliveryAddressOption | null => {
      if (typeof entry === 'string') {
        const address = entry.trim();
        return address ? { id: makeAddressId(), name: address.split('\n')[0] || 'Delivery Address', address } : null;
      }
      if (typeof entry !== 'object' || entry === null) return null;
      const record = entry as Record<string, unknown>;
      const address = String(record.address ?? '').trim();
      if (!address) return null;
      const name = String(record.name ?? '').trim() || address.split('\n')[0] || 'Delivery Address';
      const id = String(record.id ?? '').trim() || makeAddressId();
      return { id, name, address };
    })
    .filter((entry): entry is DeliveryAddressOption => {
      if (!entry) return false;
      if (addresses.some((saved) => areSameDeliveryAddress(saved.address, entry.address))) return false;
      addresses.push(entry);
      return true;
    });
}

export async function loadDeliveryAddresses(): Promise<DeliveryAddressOption[]> {
  const tenant = await apiClient.get<TenantWithSettings>('/tenant/current');
  const settings = parseSettings(tenant?.settings);
  return normalizeDeliveryAddresses(settings.deliveryAddresses);
}

export async function saveDeliveryAddress(name: string, address: string): Promise<DeliveryAddressOption[]> {
  const tenant = await apiClient.get<TenantWithSettings>('/tenant/current');
  const settings = parseSettings(tenant?.settings);
  const existing = normalizeDeliveryAddresses(settings.deliveryAddresses);
  const normalizedAddress = address.trim();
  const normalizedName = name.trim() || normalizedAddress.split('\n')[0] || 'Delivery Address';

  if (!normalizedAddress) return existing;

  const duplicate = existing.find((entry) => areSameDeliveryAddress(entry.address, normalizedAddress));
  if (duplicate) {
    throw new Error('This delivery address is already saved.');
  }

  const next = [...existing, { id: makeAddressId(), name: normalizedName, address: normalizedAddress }];

  await apiClient.put('/tenant/current', {
    settings: {
      ...settings,
      deliveryAddresses: next,
    },
  });

  return next;
}
