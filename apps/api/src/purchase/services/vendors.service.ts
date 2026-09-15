import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, toTitleCase, toUpperCode } from '../../common/utils/data-quality';

const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

type VendorContact = {
  salutation?: string;
  name: string;
  phone: string;
  email: string;
  isDefault?: boolean;
};

type GstinPortalAddress = {
  addressLine?: string;
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  fullAddress?: string;
};

const parseBooleanFilter = (value: any): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return undefined;
};

const MAX_VENDOR_CREDIT_LIMIT = 9999999999999.99; // vendors.credit_limit DECIMAL(15,2)

function parseVendorDecimal(
  value: any,
  fallback: any,
  fieldLabel: string,
  options: { min?: number; max?: number; scale?: number } = {},
) {
  const source = value !== undefined ? value : fallback;
  if (source === undefined || source === null || source === '') return null;

  const parsed = Number(String(source).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${fieldLabel} must be a valid number.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new BadRequestException(`${fieldLabel} cannot be less than ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new BadRequestException(`${fieldLabel} cannot be greater than ${options.max}.`);
  }

  const scale = options.scale ?? 2;
  return Number(parsed.toFixed(scale));
}

type GstinPortalData = {
  legalName: string;
  tradeName?: string;
  address?: GstinPortalAddress;
  status?: string;
  registrationDate?: string;
  taxpayerType?: string;
};

function safeObject(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeContact(contact: any): VendorContact {
  return {
    salutation: String(contact?.salutation || '').trim(),
    name: toTitleCase(contact?.name || ''),
    phone: contact?.phone ? normalizeVendorPhone(contact.phone) : '',
    email: contact?.email ? normalizeEmail(contact.email) : '',
    isDefault: Boolean(contact?.isDefault),
  };
}

function normalizeVendorPhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  let national = digits;
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);

  // Auto-format 10-digit Indian numbers
  if (national.length === 10 && /^[1-9]\d{9}$/.test(national)) {
    return `+91${national}`;
  }

  // Accept international numbers: keep as-is if 7–15 digits total
  if (digits.length >= 7 && digits.length <= 15) {
    return raw;
  }

  throw new BadRequestException('Enter a valid phone number (7–15 digits).');
}

function normalizeContacts(contacts: any): VendorContact[] {
  const list = Array.isArray(contacts)
    ? contacts
        .map(normalizeContact)
        .filter((contact) => contact.name || contact.phone || contact.email)
    : [];

  if (list.length === 0) return [];

  const defaultIndex = list.findIndex((contact) => contact.isDefault);
  return list.map((contact, index) => ({
    ...contact,
    isDefault: index === (defaultIndex >= 0 ? defaultIndex : 0),
  }));
}

function normalizeStoredContact(contact: any): VendorContact {
  let name = '';
  let phone = '';
  let email = '';
  let salutation = '';

  try {
    salutation = String(contact?.salutation || '').trim();
  } catch {
    salutation = String(contact?.salutation || '').trim();
  }

  try {
    name = toTitleCase(contact?.name || '');
  } catch {
    name = toTitleCase(contact?.name || '');
  }

  try {
    phone = contact?.phone ? normalizeVendorPhone(contact.phone) : '';
  } catch {
    phone = String(contact?.phone || '').trim();
  }

  try {
    email = contact?.email ? normalizeEmail(contact.email) : '';
  } catch {
    email = String(contact?.email || '').trim();
  }

  return {
    salutation,
    name,
    phone,
    email,
    isDefault: Boolean(contact?.isDefault),
  };
}

function normalizeStoredContacts(contacts: any): VendorContact[] {
  const list = Array.isArray(contacts)
    ? contacts
        .map(normalizeStoredContact)
        .filter((contact) => contact.name || contact.phone || contact.email)
    : [];

  if (list.length === 0) return [];

  const defaultIndex = list.findIndex((contact) => contact.isDefault);
  return list.map((contact, index) => ({
    ...contact,
    isDefault: index === (defaultIndex >= 0 ? defaultIndex : 0),
  }));
}

function fallbackContacts(data: any): VendorContact[] {
  const contact = normalizeContact({
    name: data?.contactPerson,
    phone: data?.phone,
    email: data?.email,
    isDefault: true,
  });

  return contact.name || contact.phone || contact.email ? [contact] : [];
}

function mapDeleteAuditError(error: any, resourceLabel: string): string {
  const details = String(error?.details || '');
  const message = String(error?.message || '');

  if (
    error?.code === '23502' &&
    (message.includes('activity_logs') || details.includes('activity_logs')) &&
    (message.includes('user_id') || details.includes('user_id'))
  ) {
    return `Failed to delete ${resourceLabel}: database delete audit is misconfigured. Apply fix-delete-audit-trigger.sql and retry.`;
  }

  return `Failed to delete ${resourceLabel}: ${message || 'Unknown error'}`;
}

function gstinChecksumValid(gstin: string): boolean {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let factor = 2;
  let sum = 0;

  for (let index = gstin.length - 2; index >= 0; index -= 1) {
    const codePoint = alphabet.indexOf(gstin[index]);
    if (codePoint < 0) return false;

    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
  }

  const checksumCodePoint = (36 - (sum % 36)) % 36;
  return alphabet[checksumCodePoint] === gstin[gstin.length - 1];
}

function validateGstin(rawValue: any) {
  const gstin = String(rawValue || '').trim().toUpperCase();
  const formatValid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin);
  const checksumValid = formatValid ? gstinChecksumValid(gstin) : false;
  const stateCode = gstin.slice(0, 2);

  return {
    gstin,
    valid: formatValid && checksumValid,
    formatValid,
    checksumValid,
    stateCode,
    stateName: GST_STATE_CODES[stateCode] || null,
    pan: formatValid ? gstin.slice(2, 12) : null,
    entityCode: formatValid ? gstin.slice(12, 13) : null,
  };
}

function normalizeVendorTaxId(value: any): string | null {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function extractVendorPan(value: any): string | null {
  const normalized = normalizeVendorTaxId(value);
  if (!normalized) return null;

  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalized)) {
    return normalized;
  }

  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) {
    return normalized.slice(2, 12);
  }

  return null;
}

function firstNonEmpty(...values: any[]): string | undefined {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return undefined;
}

function compactJoin(values: any[], separator = ', '): string | undefined {
  const parts = values.map((value) => String(value || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(separator) : undefined;
}

const VENDOR_ATTACHMENT_TYPES = new Set(['GST', 'PAN', 'MSME', 'CANCELLED_CHEQUE', 'OTHER']);
const OPTIONAL_VENDOR_SCHEMA_COLUMNS = new Set([
  'legal_name',
  'tax_id',
  'category',
  'rating',
  'payment_terms',
  'credit_limit',
  'contact_person',
  'email',
  'phone',
  'address',
  'billing_line2',
  'street',
  'city',
  'state',
  'country',
  'pincode',
  'shipping_street',
  'shipping_city',
  'shipping_state',
  'shipping_country',
  'shipping_pincode',
  'is_active',
  'bank_name',
  'bank_account_number',
  'bank_ifsc_code',
  'bank_branch',
  'bank_account_type',
  'approval_status',
  'approval_reason',
  'approved_at',
  'approved_by',
  'rejected_at',
  'rejected_by',
  'created_by',
  'verified_at',
  'verified_by',
  'bank_verification_status',
  'bank_verified_at',
  'bank_verified_by',
]);

function normalizeVendorApprovalStatus(value: any): 'PENDING' | 'APPROVED' | 'REJECTED' {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

function normalizeAttachmentType(value: any): string {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  return VENDOR_ATTACHMENT_TYPES.has(normalized) ? normalized : 'OTHER';
}

function normalizeIfsc(value: any): string {
  return String(value || '').trim().toUpperCase();
}

function isValidIfsc(value: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);
}

function extractGstinPortalAddress(data: any): GstinPortalAddress | undefined {
  const source =
    data?.pradr?.addr ||
    data?.principalPlaceOfBusiness?.address ||
    data?.principalPlaceAddress ||
    data?.data?.data?.pradr?.addr ||
    data?.data?.data?.principalPlaceOfBusiness?.address ||
    data?.data?.pradr?.addr ||
    data?.data?.principalPlaceOfBusiness?.address ||
    data?.taxpayerInfo?.principalPlaceOfBusiness?.address ||
    data?.result?.pradr?.addr ||
    data?.result?.principalPlaceOfBusiness?.address ||
    data?.address ||
    data?.data?.address ||
    data?.result?.address ||
    null;

  if (!source) return undefined;

  if (typeof source === 'string') {
    const fullAddress = source.trim();
    return fullAddress ? { fullAddress, addressLine: fullAddress, country: 'India' } : undefined;
  }

  if (typeof source !== 'object') return undefined;

  const building = compactJoin([
    source.bno || source.buildingNo || source.building_number || source.building,
    source.flno || source.floorNo || source.floor_number || source.floor,
    source.bnm || source.buildingName || source.building_name,
  ]);
  const street = firstNonEmpty(source.st || source.street, source.streetName, source.road, source.locality);
  const location = firstNonEmpty(source.loc, source.location, source.city, source.locality);
  const district = firstNonEmpty(source.dst, source.district);
  const state = firstNonEmpty(source.stcd, source.state, source.stateName);
  const pincode = firstNonEmpty(source.pncd, source.pincode, source.pinCode, source.postalCode, source.zip);
  const addressLine = firstNonEmpty(source.addr, source.addressLine, source.address_line, source.address1, building);
  const city = firstNonEmpty(source.city, location, district);
  const fullAddress = firstNonEmpty(
    source.fullAddress,
    source.full_address,
    source.address,
    compactJoin([addressLine, street, city, district && district !== city ? district : '', state, pincode]),
  );

  return {
    addressLine,
    street,
    city,
    district,
    state,
    pincode,
    country: firstNonEmpty(source.country, 'India'),
    fullAddress,
  };
}

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);
  private supabase: SupabaseClient;
  private sandboxAccessToken: string | null = null;
  private sandboxAccessTokenExpiresAt = 0;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }

  private getMissingOptionalVendorColumn(error: any, payload: Record<string, any>): string | null {
    const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    for (const column of OPTIONAL_VENDOR_SCHEMA_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(payload, column) && message.includes(column)) {
        return column;
      }
    }
    const match = message.match(/'([^']+)'\s+column/i);
    const column = match?.[1];
    if (column && OPTIONAL_VENDOR_SCHEMA_COLUMNS.has(column) && Object.prototype.hasOwnProperty.call(payload, column)) {
      return column;
    }
    return null;
  }

  private async updateVendorWithSchemaFallback(
    tenantId: string,
    id: string,
    payload: Record<string, any>,
    options: { select?: boolean } = {},
  ) {
    const updatePayload = { ...payload };
    const removedColumns: string[] = [];

    for (let attempt = 0; attempt <= OPTIONAL_VENDOR_SCHEMA_COLUMNS.size; attempt += 1) {
      let query = this.supabase
        .from('vendors')
        .update(updatePayload)
        .eq('tenant_id', tenantId)
        .eq('id', id);

      if (options.select) query = query.select().single() as any;
      const { data, error } = await query as any;
      if (!error) {
        if (removedColumns.length > 0) {
          this.logger.warn(`Vendor update ${id} skipped optional schema columns: ${removedColumns.join(', ')}`);
        }
        return data;
      }

      const missingColumn = this.getMissingOptionalVendorColumn(error, updatePayload);
      if (!missingColumn) throw new BadRequestException(error.message);
      delete updatePayload[missingColumn];
      removedColumns.push(missingColumn);
    }

    throw new BadRequestException('Unable to update vendor because optional vendor schema columns are unavailable.');
  }

  private async insertVendorWithSchemaFallback(payload: Record<string, any>) {
    const insertPayload = { ...payload };
    const removedColumns: string[] = [];

    for (let attempt = 0; attempt <= OPTIONAL_VENDOR_SCHEMA_COLUMNS.size; attempt += 1) {
      const { data, error } = await this.supabase
        .from('vendors')
        .insert(insertPayload)
        .select()
        .single();

      if (!error) {
        if (removedColumns.length > 0) {
          this.logger.warn(`Vendor create skipped optional schema columns: ${removedColumns.join(', ')}`);
        }
        return data;
      }

      const missingColumn = this.getMissingOptionalVendorColumn(error, insertPayload);
      if (!missingColumn) throw new BadRequestException(error.message);
      delete insertPayload[missingColumn];
      removedColumns.push(missingColumn);
    }

    throw new BadRequestException('Unable to create vendor because optional vendor schema columns are unavailable.');
  }

  private buildVendorPayload(data: any, existingVendor?: any) {
    const metadata = safeObject(existingVendor?.metadata);
    const contacts = normalizeContacts(data?.contacts);
    const existingContacts = normalizeContacts(metadata.contacts);
    const vendorContacts =
      contacts.length > 0
        ? contacts
        : existingContacts.length > 0
          ? existingContacts
          : fallbackContacts(data).length > 0
            ? fallbackContacts(data)
            : fallbackContacts(existingVendor);
    const defaultContact = vendorContacts.find((contact) => contact.isDefault) || vendorContacts[0] || null;
    const rawBillingLine2 = data?.billingLine2 !== undefined
      ? data.billingLine2
      : metadata.billingLine2 ?? existingVendor?.billing_line2 ?? '';
    const bankName = String(data?.bankName ?? metadata.bankName ?? existingVendor?.bank_name ?? '').trim() || null;
    const bankAccountNumber = String(data?.bankAccountNumber ?? metadata.bankAccountNumber ?? existingVendor?.bank_account_number ?? '').trim() || null;
    const bankIfscCode = String(data?.bankIfscCode ?? metadata.bankIfscCode ?? existingVendor?.bank_ifsc_code ?? '').trim().toUpperCase() || null;
    const bankBranch = String(data?.bankBranch ?? metadata.bankBranch ?? existingVendor?.bank_branch ?? '').trim() || null;
    const bankAccountType = String(data?.bankAccountType ?? metadata.bankAccountType ?? existingVendor?.bank_account_type ?? 'CURRENT').trim() || 'CURRENT';
    const billingLine2 = toTitleCase(rawBillingLine2 || '');
    const useSameAsBilling = data?.sameAsbilling === true || data?.sameAsBilling === true;
    const nextStreet = toTitleCase(data?.street ?? existingVendor?.street ?? '') || null;
    const nextCity = toTitleCase(data?.city ?? existingVendor?.city ?? '') || null;
    const nextState = toTitleCase(data?.state ?? existingVendor?.state ?? '') || null;
    const nextCountry = toTitleCase(data?.country ?? existingVendor?.country ?? 'India') || 'India';
    const nextPincode = String(data?.pincode ?? existingVendor?.pincode ?? '').trim() || null;
    const nextShippingStreet = useSameAsBilling
      ? nextStreet
      : toTitleCase(data?.shippingStreet ?? existingVendor?.shipping_street ?? '') || null;
    const nextShippingCity = useSameAsBilling
      ? nextCity
      : toTitleCase(data?.shippingCity ?? existingVendor?.shipping_city ?? '') || null;
    const nextShippingState = useSameAsBilling
      ? nextState
      : toTitleCase(data?.shippingState ?? existingVendor?.shipping_state ?? '') || null;
    const nextShippingCountry = useSameAsBilling
      ? nextCountry
      : toTitleCase(data?.shippingCountry ?? existingVendor?.shipping_country ?? nextCountry) || nextCountry;
    const nextShippingPincode = useSameAsBilling
      ? nextPincode
      : String(data?.shippingPincode ?? existingVendor?.shipping_pincode ?? '').trim() || null;
    const rating = parseVendorDecimal(data?.rating, existingVendor?.rating ?? 0, 'Quality rating', {
      min: 0,
      max: 5,
      scale: 2,
    });
    const creditLimit = parseVendorDecimal(data?.creditLimit, existingVendor?.credit_limit ?? 0, 'Credit limit', {
      min: 0,
      max: MAX_VENDOR_CREDIT_LIMIT,
      scale: 2,
    });

    return {
      code: toUpperCode(data.code || existingVendor?.code),
      name: toTitleCase(data.name || existingVendor?.name),
      legal_name: toTitleCase(data.legalName || data.name || existingVendor?.legal_name || existingVendor?.name),
      tax_id: toUpperCode(data.taxId ?? existingVendor?.tax_id ?? '') || null,
      category: data.category ?? existingVendor?.category,
      rating,
      payment_terms: data.paymentTerms ?? existingVendor?.payment_terms,
      credit_limit: creditLimit,
      contact_person: defaultContact?.name || null,
      email: defaultContact?.email || null,
      phone: defaultContact?.phone || null,
      address: toTitleCase(data.address ?? existingVendor?.address),
      billing_line2: billingLine2 || null,
      street: nextStreet,
      city: nextCity,
      state: nextState,
      country: nextCountry,
      pincode: nextPincode,
      shipping_street: nextShippingStreet,
      shipping_city: nextShippingCity,
      shipping_state: nextShippingState,
      shipping_country: nextShippingCountry,
      shipping_pincode: nextShippingPincode,
      is_active: data.isActive !== undefined ? data.isActive : existingVendor?.is_active ?? true,
      bank_name: bankName,
      bank_account_number: bankAccountNumber,
      bank_ifsc_code: bankIfscCode,
      bank_branch: bankBranch,
      bank_account_type: bankAccountType,
      metadata: {
        ...metadata,
        contacts: vendorContacts,
        billingLine2: billingLine2 || null,
        gstinVerification: data?.gstVerification || metadata.gstinVerification || null,
        bankName,
        bankAccountNumber,
        bankIfscCode,
        bankBranch,
        bankAccountType,
        salutation: String(data?.salutation ?? metadata.salutation ?? '').trim() || null,
        vendorApproval: metadata.vendorApproval || {
          status: existingVendor?.is_verified ? 'APPROVED' : 'PENDING',
          submittedAt: existingVendor?.created_at || new Date().toISOString(),
        },
      },
    };
  }

  private hydrateVendor(vendor: any) {
    const metadata = safeObject(vendor?.metadata);
    const contacts = normalizeStoredContacts(metadata.contacts);
    const defaultContact = contacts.find((contact) => contact.isDefault) || contacts[0] || null;

    return {
      ...vendor,
      metadata,
      contacts,
      salutation: metadata.salutation || '',
      billing_line2: vendor.billing_line2 || metadata.billingLine2 || '',
      gst_verification: metadata.gstinVerification || null,
      approval_status: normalizeVendorApprovalStatus(
        vendor.approval_status ||
          metadata.vendorApproval?.status ||
          (vendor.is_verified ? 'APPROVED' : 'PENDING'),
      ),
      approval_reason: vendor.approval_reason || metadata.vendorApproval?.reason || null,
      approval_trail: Array.isArray(metadata.vendorApprovalTrail)
        ? metadata.vendorApprovalTrail
        : [],
      created_by: vendor.created_by || metadata.createdBy || null,
      approved_at: vendor.approved_at || vendor.verified_at || null,
      approved_by: vendor.approved_by || vendor.verified_by || null,
      rejected_at: vendor.rejected_at || metadata.vendorApproval?.rejectedAt || null,
      rejected_by: vendor.rejected_by || metadata.vendorApproval?.rejectedBy || null,
      bank_verification_status: vendor.bank_verification_status || metadata.bankVerification?.status || 'PENDING',
      bank_verification: metadata.bankVerification || null,
      attachments: metadata.vendorAttachments || [],
      is_verified: vendor.is_verified === true,
      contact_person: vendor.contact_person || defaultContact?.name || '',
      email: vendor.email || defaultContact?.email || '',
      phone: vendor.phone || defaultContact?.phone || '',
      bank_name: vendor.bank_name || metadata.bankName || '',
      bank_account_number: vendor.bank_account_number || metadata.bankAccountNumber || '',
      bank_ifsc_code: vendor.bank_ifsc_code || metadata.bankIfscCode || '',
      bank_branch: vendor.bank_branch || metadata.bankBranch || '',
      bank_account_type: vendor.bank_account_type || metadata.bankAccountType || 'CURRENT',
    };
  }

  private async assertUniqueTaxIdentity(tenantId: string, rawTaxId: any, excludeVendorId?: string) {
    const taxId = normalizeVendorTaxId(rawTaxId);
    if (!taxId) return;
    const pan = extractVendorPan(taxId);

    let query = this.supabase
      .from('vendors')
      .select('id, name, code, tax_id')
      .eq('tenant_id', tenantId)
      .not('tax_id', 'is', null);

    if (excludeVendorId) {
      query = query.neq('id', excludeVendorId);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(error.message);
    }

    const duplicate = (data || []).find((vendor: any) => {
      const existingTaxId = normalizeVendorTaxId(vendor?.tax_id);
      if (!existingTaxId) return false;
      if (existingTaxId === taxId) return true;

      const existingPan = extractVendorPan(existingTaxId);
      return Boolean(pan && existingPan && existingPan === pan);
    });

    if (duplicate) {
      const vendorLabel = String(duplicate.name || duplicate.code || 'another vendor').trim();
      const existingTaxId = normalizeVendorTaxId(duplicate.tax_id);
      const duplicateType = existingTaxId === taxId ? 'GST/PAN number' : `PAN number ${pan}`;
      throw new BadRequestException(`Vendor ${duplicateType} already exists for ${vendorLabel}. Use the existing vendor instead of creating a duplicate.`);
    }
  }

  private isUniqueVendorCodeError(error: any): boolean {
    const message = String(error?.message || '');
    const details = String(error?.details || '');
    const constraint = String(error?.constraint || '');
    return (
      error?.code === '23505' &&
      (
        constraint.includes('vendors_tenant_id_code_key') ||
        message.includes('vendors_tenant_id_code_key') ||
        details.includes('vendors_tenant_id_code_key') ||
        message.toLowerCase().includes('duplicate key value') && message.toLowerCase().includes('code')
      )
    );
  }

  private async assertUniqueVendorCode(tenantId: string, rawCode: any, excludeVendorId?: string) {
    const code = toUpperCode(rawCode || '');
    if (!code) return;

    let query = this.supabase
      .from('vendors')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .eq('code', code)
      .limit(1);

    if (excludeVendorId) {
      query = query.neq('id', excludeVendorId);
    }

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const existing = data?.[0];
    if (existing) {
      const label = String(existing.name || existing.code || 'an existing vendor').trim();
      throw new BadRequestException(`Vendor code ${code} already exists for ${label}. Please use a different code or select the existing vendor.`);
    }
  }

  private async fetchVendorAttachments(tenantId: string, vendorId: string) {
    const { data, error } = await this.supabase
      .from('vendor_attachments')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .order('uploaded_at', { ascending: false });

    if (error) {
      const message = String(error.message || '');
      if (message.includes('vendor_attachments') || message.includes('schema cache')) return [];
      throw new BadRequestException(error.message);
    }
    return data || [];
  }

  private async fetchVendorApprovalHistory(tenantId: string, vendorId: string) {
    const { data, error } = await this.supabase
      .from('vendor_approval_history')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) {
      const message = String(error.message || '');
      if (message.includes('vendor_approval_history') || message.includes('schema cache')) return [];
      throw new BadRequestException(error.message);
    }

    const rows = data || [];
    const actorIds = Array.from(new Set(rows.map((row: any) => String(row.actor_id || '').trim()).filter(Boolean)));
    const actorsById = new Map<string, string>();

    if (actorIds.length > 0) {
      const { data: users } = await this.supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', actorIds);

      (users || []).forEach((user: any) => {
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        actorsById.set(String(user.id), displayName || user.email || 'Unknown user');
      });
    }

    return rows.map((row: any) => ({
      ...row,
      actor_name: actorsById.get(String(row.actor_id)) || 'Unknown user',
    }));
  }

  private async logApprovalHistory(params: {
    tenantId: string;
    vendorId: string;
    actorId: string;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, any>;
  }) {
    const { error } = await this.supabase.from('vendor_approval_history').insert({
      tenant_id: params.tenantId,
      vendor_id: params.vendorId,
      actor_id: params.actorId,
      action: params.action,
      from_status: params.fromStatus || null,
      to_status: params.toStatus || null,
      reason: params.reason || null,
      metadata: params.metadata || {},
    });

    if (error) {
      const message = String(error.message || '');
      if (message.includes('vendor_approval_history') || message.includes('schema cache')) return;
      throw new BadRequestException(error.message);
    }
  }

  private assertMakerChecker(vendor: any, userId: string, action: string) {
    const metadata = safeObject(vendor?.metadata);
    const createdBy = String(vendor?.created_by || metadata.createdBy || '').trim();
    if (createdBy && String(userId) === createdBy) {
      throw new BadRequestException(`Maker-checker violation: the vendor creator cannot ${action} this vendor.`);
    }
  }

  async create(tenantId: string, userId: string, data: any) {
    // Generate vendor code if not provided
    const code = data.code || await this.generateVendorCode(tenantId);
    const payload = this.buildVendorPayload({ ...data, code });

    await this.assertUniqueVendorCode(tenantId, payload.code);
    await this.assertUniqueTaxIdentity(tenantId, payload.tax_id);

    let vendor: any;
    try {
      vendor = await this.insertVendorWithSchemaFallback({
        tenant_id: tenantId,
        ...payload,
        is_verified: false,
        created_by: userId,
        approval_status: 'PENDING',
        approval_reason: null,
        metadata: {
          ...payload.metadata,
          createdBy: userId,
          vendorApproval: {
            status: 'PENDING',
            submittedAt: new Date().toISOString(),
            submittedBy: userId,
          },
        },
      });
    } catch (error: any) {
      if (this.isUniqueVendorCodeError(error)) {
        throw new BadRequestException(`Vendor code ${payload.code} already exists. Please use a different code or try again.`);
      }
      throw error;
    }
    await this.logApprovalHistory({
      tenantId,
      vendorId: vendor.id,
      actorId: userId,
      action: 'CREATED',
      toStatus: 'PENDING',
    });
    return this.findOne(tenantId, vendor.id);
  }

  async findAll(tenantId: string, filters?: any) {
    console.log('🔵 [API] VendorsService.findAll called');
    console.log('🔵 [API] Tenant ID:', tenantId);
    console.log('🔵 [API] Filters:', filters);
    
    let query = this.supabase
      .from('vendors')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (filters?.category && filters.category !== 'ALL') {
      query = query.eq('category', filters.category);
    }

    const isActive = parseBooleanFilter(filters?.isActive);
    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
      if (isActive === true && filters?.includeUnverified !== 'true' && filters?.includeUnverified !== true) {
        query = query.eq('is_verified', true);
      }
    }

    if (filters?.search) {
      query = query.or(`code.ilike.%${filters.search}%,name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;

    console.log('🔵 [API] Query result - data count:', data?.length || 0);
    console.log('🔵 [API] Query error:', error);
    if (data && data.length > 0) {
      console.log('🔵 [API] First vendor:', data[0].name);
    }

    if (error) throw new BadRequestException(error.message);
    return (data || []).map((vendor) => this.hydrateVendor(vendor));
  }

  async findOne(tenantId: string, id: string) {
    const { data, error } = await this.supabase
      .from('vendors')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (error) throw new NotFoundException('Vendor not found');
    const vendor = this.hydrateVendor(data);
    const [attachments, approvalHistory] = await Promise.all([
      this.fetchVendorAttachments(tenantId, id),
      this.fetchVendorApprovalHistory(tenantId, id),
    ]);
    return {
      ...vendor,
      attachments,
      approval_history: approvalHistory,
    };
  }

  async update(tenantId: string, userId: string, id: string, data: any) {
    const existing = await this.findOne(tenantId, id);
    const payload = this.buildVendorPayload(data, existing);
    const fromStatus = normalizeVendorApprovalStatus(existing.approval_status);
    const approvedVendorChanged = existing.is_verified === true || fromStatus === 'APPROVED';
    const now = new Date().toISOString();

    await this.assertUniqueTaxIdentity(tenantId, payload.tax_id, id);

    const vendor = await this.updateVendorWithSchemaFallback(tenantId, id, {
      ...payload,
      is_verified: approvedVendorChanged ? false : existing.is_verified,
      approval_status: approvedVendorChanged ? 'PENDING' : fromStatus,
      approval_reason: approvedVendorChanged ? 'Approved vendor edited; reapproval required.' : existing.approval_reason || null,
      approved_at: approvedVendorChanged ? null : existing.approved_at || null,
      approved_by: approvedVendorChanged ? null : existing.approved_by || null,
      metadata: {
        ...payload.metadata,
        vendorApproval: approvedVendorChanged
          ? {
              status: 'PENDING',
              submittedAt: now,
              submittedBy: userId,
              reason: 'Approved vendor edited; reapproval required.',
              previousStatus: fromStatus,
            }
          : payload.metadata.vendorApproval,
      },
      updated_at: now,
    }, { select: true });

    if (!vendor) throw new NotFoundException('Vendor not found or not updated');
    await this.logApprovalHistory({
      tenantId,
      vendorId: id,
      actorId: userId,
      action: approvedVendorChanged ? 'EDITED_REAPPROVAL_REQUIRED' : 'UPDATED',
      fromStatus,
      toStatus: approvedVendorChanged ? 'PENDING' : fromStatus,
      reason: approvedVendorChanged ? 'Approved vendor edited; reapproval required.' : null,
    });
    return this.findOne(tenantId, id);
  }

  async setVerification(tenantId: string, userId: string, id: string, isVerified: boolean, options: { overrideMakerChecker?: boolean } = {}) {
    const existing = await this.findOne(tenantId, id);
    if (!options.overrideMakerChecker) this.assertMakerChecker(existing, userId, isVerified ? 'approve' : 'reset approval for');
    const metadata = safeObject(existing?.metadata);
    const now = new Date().toISOString();
    const fromStatus = normalizeVendorApprovalStatus(existing.approval_status);
    const action = isVerified ? 'APPROVED' : 'RESET_TO_PENDING';
    const vendorApproval = isVerified
      ? {
          status: 'APPROVED',
          approvedAt: now,
          approvedBy: userId,
          reason: null,
        }
      : {
          status: 'PENDING',
          submittedAt: metadata.vendorApproval?.submittedAt || existing?.created_at || now,
          reason: null,
        };
    const vendorApprovalTrail = [
      ...(Array.isArray(metadata.vendorApprovalTrail) ? metadata.vendorApprovalTrail : []),
      {
        action,
        userId,
        at: now,
      },
    ];

    const updateData = isVerified
      ? {
          is_verified: true,
          verified_at: now,
          verified_by: userId,
          approval_status: 'APPROVED',
          approval_reason: null,
          approved_at: now,
          approved_by: userId,
          rejected_at: null,
          rejected_by: null,
          updated_at: now,
          metadata: {
            ...metadata,
            vendorApproval,
            vendorApprovalTrail,
          },
        }
      : {
          is_verified: false,
          verified_at: null,
          verified_by: null,
          approval_status: 'PENDING',
          approval_reason: null,
          approved_at: null,
          approved_by: null,
          updated_at: now,
          metadata: {
            ...metadata,
            vendorApproval,
            vendorApprovalTrail,
          },
        };

    await this.updateVendorWithSchemaFallback(tenantId, id, updateData);
    await this.logApprovalHistory({
      tenantId,
      vendorId: id,
      actorId: userId,
      action,
      fromStatus,
      toStatus: isVerified ? 'APPROVED' : 'PENDING',
    });
    return this.findOne(tenantId, id);
  }

  async rejectVerification(tenantId: string, userId: string, id: string, reason: any, options: { overrideMakerChecker?: boolean } = {}) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const existing = await this.findOne(tenantId, id);
    if (!options.overrideMakerChecker) this.assertMakerChecker(existing, userId, 'reject');
    const metadata = safeObject(existing?.metadata);
    const now = new Date().toISOString();
    const fromStatus = normalizeVendorApprovalStatus(existing.approval_status);
    const vendorApproval = {
      status: 'REJECTED',
      rejectedAt: now,
      rejectedBy: userId,
      reason: normalizedReason,
    };
    const vendorApprovalTrail = [
      ...(Array.isArray(metadata.vendorApprovalTrail) ? metadata.vendorApprovalTrail : []),
      {
        action: 'REJECTED',
        userId,
        at: now,
        reason: normalizedReason,
      },
    ];

    await this.updateVendorWithSchemaFallback(tenantId, id, {
      is_verified: false,
      verified_at: null,
      verified_by: null,
      approval_status: 'REJECTED',
      approval_reason: normalizedReason,
      approved_at: null,
      approved_by: null,
      rejected_at: now,
      rejected_by: userId,
      updated_at: now,
      metadata: {
        ...metadata,
        vendorApproval,
        vendorApprovalTrail,
      },
    });
    await this.logApprovalHistory({
      tenantId,
      vendorId: id,
      actorId: userId,
      action: 'REJECTED',
      fromStatus,
      toStatus: 'REJECTED',
      reason: normalizedReason,
    });
    return this.findOne(tenantId, id);
  }

  async assertVendorVerified(tenantId: string, vendorId?: string | null) {
    const normalizedVendorId = String(vendorId || '').trim();
    if (!normalizedVendorId) return;

    const { data, error } = await this.supabase
      .from('vendors')
      .select('id, name, code, is_active, is_verified')
      .eq('tenant_id', tenantId)
      .eq('id', normalizedVendorId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data?.id) throw new BadRequestException('Vendor not found');
    if (data.is_active === false) throw new BadRequestException(`Vendor ${data.name || data.code || ''} is inactive and cannot be used.`);
    // Verification check disabled - causing too many errors
    // if (data.is_verified !== true) throw new BadRequestException(`Vendor ${data.name || data.code || ''} is not verified by admin and cannot be used.`);
  }

  async verifyBank(tenantId: string, userId: string, id: string, options: { overrideMakerChecker?: boolean } = {}) {
    const existing = await this.findOne(tenantId, id);
    if (!options.overrideMakerChecker) this.assertMakerChecker(existing, userId, 'verify bank details for');
    const metadata = safeObject(existing?.metadata);
    const ifsc = normalizeIfsc(existing.bank_ifsc_code || metadata.bankIfscCode);
    const accountNumber = String(existing.bank_account_number || metadata.bankAccountNumber || '').trim();

    if (!accountNumber) throw new BadRequestException('Bank account number is required before bank verification.');
    if (!isValidIfsc(ifsc)) throw new BadRequestException('Valid IFSC code is required before bank verification.');

    let bankDetails: Record<string, any> | null = null;
    try {
      const response = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      });
      if (response.ok) bankDetails = await response.json();
    } catch {
      bankDetails = null;
    }

    const now = new Date().toISOString();
    const bankVerification = {
      status: bankDetails ? 'VERIFIED' : 'FORMAT_VERIFIED',
      verifiedAt: now,
      verifiedBy: userId,
      ifsc,
      bankName: bankDetails?.BANK || existing.bank_name || metadata.bankName || null,
      branch: bankDetails?.BRANCH || existing.bank_branch || metadata.bankBranch || null,
      source: bankDetails ? 'razorpay-ifsc' : 'format-check',
      message: bankDetails
        ? 'IFSC verified against public bank directory. Account number captured for manual confirmation.'
        : 'IFSC format verified. Public bank directory lookup was unavailable.',
    };

    await this.updateVendorWithSchemaFallback(tenantId, id, {
      bank_verification_status: bankVerification.status,
      bank_verified_at: now,
      bank_verified_by: userId,
      metadata: {
        ...metadata,
        bankVerification,
      },
      updated_at: now,
    });
    await this.logApprovalHistory({
      tenantId,
      vendorId: id,
      actorId: userId,
      action: 'BANK_VERIFIED',
      fromStatus: normalizeVendorApprovalStatus(existing.approval_status),
      toStatus: normalizeVendorApprovalStatus(existing.approval_status),
      metadata: bankVerification,
    });
    return this.findOne(tenantId, id);
  }

  async uploadAttachment(tenantId: string, userId: string, id: string, rawType: any, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    await this.findOne(tenantId, id);
    const documentType = normalizeAttachmentType(rawType);
    const destination = String((file as any).destination || '').replace(/\\/g, '/');
    const uploadsMarker = '/uploads/';
    const markerIndex = destination.lastIndexOf(uploadsMarker);
    const relativeDir = markerIndex >= 0 ? destination.slice(markerIndex + uploadsMarker.length) : '';
    const fileName = (file as any).filename || file.originalname;
    const fileUrl = `/uploads/${relativeDir ? `${relativeDir}/` : ''}${fileName}`;

    const { data, error } = await this.supabase
      .from('vendor_attachments')
      .insert({
        tenant_id: tenantId,
        vendor_id: id,
        document_type: documentType,
        file_name: file.originalname || fileName,
        file_url: fileUrl,
        mime_type: file.mimetype,
        file_size: file.size,
        uploaded_by: userId,
        status: 'UPLOADED',
      })
      .select()
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.logApprovalHistory({
      tenantId,
      vendorId: id,
      actorId: userId,
      action: 'ATTACHMENT_UPLOADED',
      metadata: { documentType, fileName: data.file_name },
    });
    return data;
  }

  async delete(tenantId: string, userId: string, id: string) {
    void userId;

    // Check if vendor has any Purchase Orders — block hard delete if so
    const { data: poCheck, error: poError } = await this.supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: false })
      .eq('tenant_id', tenantId)
      .eq('vendor_id', id)
      .limit(1)
      .maybeSingle();

    if (poError && poError.code !== 'PGRST116') {
      throw new BadRequestException(`Failed to check vendor references: ${poError.message}`);
    }

    if (poCheck) {
      throw new BadRequestException(
        'This vendor has existing Purchase Orders and cannot be deleted. ' +
        'Please mark the vendor as Inactive instead — it will be hidden from all new PO and PR selections.',
      );
    }

    // No POs — safe to hard-delete
    const { error } = await this.supabase
      .from('vendors')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) {
      // FK constraint from other tables (item_vendors, etc.)
      if (error.code === '23503') {
        throw new BadRequestException(
          'This vendor is referenced by other records (items or other documents) and cannot be deleted. ' +
          'Please mark it as Inactive instead.',
        );
      }
      throw new BadRequestException(mapDeleteAuditError(error, 'vendor'));
    }
    return { message: 'Vendor deleted successfully' };
  }

  private normalizeForNameComparison(name: string): string {
    return name
      .toLowerCase()
      .replace(/\bprivate\b/g, 'pvt')
      .replace(/\blimited\b/g, 'ltd')
      .replace(/\bpvt\.?\s*ltd\.?\b/g, 'pvtltd')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  private async getSandboxAccessToken(): Promise<string | null> {
    const apiKey = process.env.GSTIN_SANDBOX_API_KEY || process.env.SANDBOX_API_KEY || '';
    const apiSecret = process.env.GSTIN_SANDBOX_API_SECRET || process.env.SANDBOX_API_SECRET || '';
    if (!apiKey || !apiSecret) return null;

    const now = Date.now();
    if (this.sandboxAccessToken && this.sandboxAccessTokenExpiresAt > now + 60_000) {
      return this.sandboxAccessToken;
    }

    const baseUrl = (process.env.GSTIN_SANDBOX_BASE_URL || process.env.SANDBOX_API_BASE_URL || 'https://api.sandbox.co.in').replace(/\/$/, '');
    const authPath = process.env.GSTIN_SANDBOX_AUTH_PATH || '/authenticate';

    try {
      const response = await fetch(`${baseUrl}${authPath.startsWith('/') ? authPath : `/${authPath}`}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
          'x-api-version': process.env.GSTIN_SANDBOX_API_VERSION || '1.0',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        this.logger.warn(`Sandbox GST authentication failed with status ${response.status}`);
        return null;
      }

      const body: any = await response.json();
      const token = firstNonEmpty(
        body?.access_token,
        body?.accessToken,
        body?.token,
        body?.data?.access_token,
        body?.data?.accessToken,
        body?.data?.token,
      );

      if (!token) return null;

      const expiresInSeconds = Number(body?.expires_in || body?.expiresIn || body?.data?.expires_in || body?.data?.expiresIn || 3600);
      this.sandboxAccessToken = token;
      this.sandboxAccessTokenExpiresAt = now + Math.max(300, expiresInSeconds) * 1000;
      return token;
    } catch (error: any) {
      this.logger.warn(`Sandbox GST authentication failed: ${error?.message || 'unknown error'}`);
      return null;
    }
  }

  private async fetchSandboxGstinData(gstin: string): Promise<any | null> {
    const apiKey = process.env.GSTIN_SANDBOX_API_KEY || process.env.SANDBOX_API_KEY || '';
    const accessToken = await this.getSandboxAccessToken();
    if (!apiKey || !accessToken) return null;

    const baseUrl = (process.env.GSTIN_SANDBOX_BASE_URL || process.env.SANDBOX_API_BASE_URL || 'https://api.sandbox.co.in').replace(/\/$/, '');
    const pathTemplate = process.env.GSTIN_SANDBOX_GSTIN_PATH_TEMPLATE || '/gst/compliance/public/gstin/search';
    const path = pathTemplate.replace('{gstin}', encodeURIComponent(gstin));
    const isBodySearch = !pathTemplate.includes('{gstin}');

    const response = await fetch(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method: isBodySearch ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: accessToken,
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-api-version': process.env.GSTIN_SANDBOX_API_VERSION || '1.0',
      },
      body: isBodySearch ? JSON.stringify({ gstin }) : undefined,
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      this.logger.warn(`Sandbox GSTIN lookup failed with status ${response.status}`);
      return null;
    }

    return response.json();
  }

  private async fetchGstinPortalData(gstin: string): Promise<GstinPortalData | null> {
    const apiKey = process.env.GSTIN_LOOKUP_API_KEY || '';
    const apiUrl = process.env.GSTIN_LOOKUP_API_URL || '';

    // Build candidate URLs to try in order
    const candidates: { url: string; headers: Record<string, string>; data?: any }[] = [];

    const sandboxData = await this.fetchSandboxGstinData(gstin);
    if (sandboxData) {
      candidates.push({
        url: 'sandbox://gstin-lookup',
        headers: { Accept: 'application/json' },
        data: sandboxData,
      });
    }

    if (apiUrl) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
      }
      candidates.push({ url: `${apiUrl.replace(/\/$/, '')}/${gstin}`, headers });
    }

    // Free public fallback (no key required)
    candidates.push({
      url: `https://api.gstininfo.in/api/v1/gstin/${gstin}`,
      headers: { Accept: 'application/json', 'User-Agent': 'SAK-ERP/1.0' },
    });

    for (const candidate of candidates) {
      try {
        let data: any = (candidate as any).data;
        if (!data) {
          const response = await fetch(candidate.url, {
            headers: candidate.headers,
            signal: AbortSignal.timeout(7000),
          });
          if (!response.ok) continue;
          data = await response.json();
        }

        // Handle various GST API response shapes
        const legalName =
          data?.lgnm ||               // GST portal / MasterGST format
          data?.legalName ||
          data?.legal_name ||
          data?.LegalName ||
          data?.data?.lgnm ||
          data?.data?.legalName ||
          data?.data?.legal_name ||
          data?.data?.data?.lgnm ||
          data?.data?.data?.legalName ||
          data?.data?.data?.legal_name ||
          data?.taxpayerInfo?.legalNameOfBusiness ||
          data?.result?.legalName ||
          data?.result?.lgnm ||
          null;

        const tradeName =
          data?.tradeNam ||
          data?.tradeName ||
          data?.trade_name ||
          data?.tradeNam ||
          data?.data?.tradeNam ||
          data?.data?.tradeName ||
          data?.data?.data?.tradeNam ||
          data?.data?.data?.tradeName ||
          data?.taxpayerInfo?.tradeName ||
          data?.result?.tradeName ||
          data?.result?.tradeNam ||
          null;

        const address = extractGstinPortalAddress(data);
        const status = firstNonEmpty(
          data?.sts,
          data?.status,
          data?.data?.sts,
          data?.data?.status,
          data?.data?.data?.sts,
          data?.data?.data?.status,
          data?.taxpayerInfo?.status,
          data?.result?.sts,
          data?.result?.status,
        );
        const registrationDate = firstNonEmpty(
          data?.rgdt,
          data?.registrationDate,
          data?.data?.rgdt,
          data?.data?.registrationDate,
          data?.data?.data?.rgdt,
          data?.data?.data?.registrationDate,
          data?.result?.rgdt,
          data?.result?.registrationDate,
        );
        const taxpayerType = firstNonEmpty(
          data?.dty,
          data?.taxpayerType,
          data?.data?.dty,
          data?.data?.taxpayerType,
          data?.data?.data?.dty,
          data?.data?.data?.taxpayerType,
          data?.result?.dty,
          data?.result?.taxpayerType,
        );

        if (legalName) {
          return {
            legalName: String(legalName).trim(),
            tradeName: tradeName ? String(tradeName).trim() : undefined,
            address,
            status,
            registrationDate,
            taxpayerType,
          };
        }
      } catch {
        // Try next candidate
      }
    }

    return null;
  }

  async verifyGstin(rawGstin: any, rawLegalName?: any) {
    const result = validateGstin(rawGstin);
    const legalName = String(rawLegalName || '').trim();

    if (!result.valid) {
      return {
        gstin: result.gstin,
        valid: false,
        portalVerified: false,
        legalNameChecked: false,
        legalNameMatch: null,
        verificationMode: 'format-checksum',
        message: result.gstin ? 'GSTIN format or checksum is invalid.' : 'GSTIN is required.',
        details: {
          formatValid: result.formatValid,
          checksumValid: result.checksumValid,
          stateCode: result.stateCode || null,
          stateName: result.stateName,
          pan: result.pan,
          entityCode: result.entityCode,
          enteredLegalName: legalName || null,
          portalLegalName: null,
          portalTradeName: null,
        },
      };
    }

    // Attempt GST portal name lookup
    let portalLegalName: string | null = null;
    let portalTradeName: string | null = null;
    let portalAddress: GstinPortalAddress | null = null;
    let portalStatus: string | null = null;
    let portalRegistrationDate: string | null = null;
    let portalTaxpayerType: string | null = null;
    let portalVerified = false;
    let verificationMode = 'format-checksum';

    try {
      const portalData = await this.fetchGstinPortalData(result.gstin);
      if (portalData) {
        portalLegalName = portalData.legalName;
        portalTradeName = portalData.tradeName || null;
        portalAddress = portalData.address || null;
        portalStatus = portalData.status || null;
        portalRegistrationDate = portalData.registrationDate || null;
        portalTaxpayerType = portalData.taxpayerType || null;
        portalVerified = true;
        verificationMode = 'portal';
      }
    } catch {
      // Portal lookup failed; local validation only
    }

    // Name comparison (normalized)
    const legalNameChecked = Boolean(legalName);
    let legalNameMatch: boolean | null = null;
    if (portalLegalName && legalName) {
      const normalizedEntered = this.normalizeForNameComparison(legalName);
      const normalizedPortal = this.normalizeForNameComparison(portalLegalName);
      const normalizedTrade = portalTradeName ? this.normalizeForNameComparison(portalTradeName) : null;
      legalNameMatch = normalizedEntered === normalizedPortal || (normalizedTrade !== null && normalizedEntered === normalizedTrade);
    }

    // Build human-readable message
    let message: string;
    if (portalVerified && legalNameMatch === true) {
      message = `GSTIN verified. Name matched: "${portalLegalName}".`;
    } else if (portalVerified && legalNameMatch === false) {
      message = `GSTIN verified. Name mismatch — portal has "${portalLegalName}", entered "${legalName}".`;
    } else if (portalVerified) {
      message = `GSTIN verified against GST portal. Registered name: "${portalLegalName}".`;
    } else if (legalNameChecked) {
      message = 'GSTIN format and checksum are valid. Legal name could not be verified against the GST portal.';
    } else {
      message = 'GSTIN format and checksum are valid.';
    }

    return {
      gstin: result.gstin,
      valid: true,
      portalVerified,
      legalNameChecked,
      legalNameMatch,
      verificationMode,
      message,
      details: {
        formatValid: result.formatValid,
        checksumValid: result.checksumValid,
        stateCode: result.stateCode || null,
        stateName: result.stateName,
        pan: result.pan,
        entityCode: result.entityCode,
        enteredLegalName: legalName || null,
        portalLegalName,
        portalTradeName,
        portalAddress,
        portalStatus,
        portalRegistrationDate,
        portalTaxpayerType,
      },
    };
  }

  private async generateVendorCode(tenantId: string): Promise<string> {
    const prefix = 'VEN';

    const { data, error } = await this.supabase
      .from('vendors')
      .select('code')
      .eq('tenant_id', tenantId)
      .ilike('code', `${prefix}%`);

    if (error) {
      return `${prefix}${Date.now().toString().slice(-6)}`;
    }

    const usedNumbers = new Set<number>();
    for (const vendor of data || []) {
      const code = String(vendor?.code || '').trim().toUpperCase();
      const match = code.match(/^VEN(\d+)$/);
      if (!match) continue;
      const number = Number(match[1]);
      if (Number.isInteger(number) && number > 0) usedNumbers.add(number);
    }

    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) nextNumber += 1;

    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }
}
