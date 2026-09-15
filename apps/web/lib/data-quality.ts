type PlainObject = Record<string, any>;

const TITLE_PREFIXES = ['Mr', 'Ms', 'Mrs', 'Dr', 'Prof'];
const ACRONYMS = new Set([
  'BOM', 'CAD', 'CEO', 'CFO', 'CIN', 'CNC', 'COD', 'GST', 'GSTIN', 'HR', 'HSN', 'IGST', 'ISO', 'LLP',
  'LTD', 'MSME', 'PAN', 'PO', 'PR', 'PVT', 'QC', 'UID', 'UOM', 'VAT', 'CST', 'ERP', 'SAC', 'TDS',
]);

const TITLE_CASE_FIELDS = new Set([
  'name', 'legalName', 'legal_name', 'customer_name', 'organization_name', 'companyName', 'company_name',
  'vendor_name', 'item_name', 'description', 'product_category', 'category_name', 'city', 'state', 'country',
  'address', 'street', 'billingLine2', 'billing_line2', 'billing_address', 'shipping_address', 'delivery_address',
  'transporter_name', 'specialization', 'department', 'designation', 'employee_name', 'technician_name',
]);

const PERSON_NAME_FIELDS = new Set([
  'employee_name',
]);

const EMAIL_FIELDS = new Set(['email', 'contact_email', 'customer_email', 'recipientEmail', 'recipient_email']);
const PHONE_FIELDS = new Set(['phone', 'mobile', 'contact_phone', 'customer_phone', 'contact_number', 'primaryPhone']);
const UPPERCASE_FIELDS = new Set([
  'code', 'item_code', 'vendor_item_code', 'customer_code', 'taxId', 'tax_id', 'gstin', 'gst_number', 'gstNumber',
  'pan', 'pan_number', 'panNumber', 'hsn_code', 'uom', 'batch_uom', 'vehicle_number', 'lr_number',
]);

const DATA_QUALITY_ENDPOINTS = [
  /^\/purchase\/vendors(?:\/|$)/,
  /^\/inventory\/items(?:\/|$)/,
  /^\/items(?:\/check-duplicates|\/|$)/,
  /^\/sales\/customers(?:\/|$)/,
  /^\/uid\/deployment(?:\/|$)/,
  /^\/service\/technicians(?:\/|$)/,
  /^\/hr\/employees(?:\/|$)/,
  /^\/production\/work-stations(?:\/|$)/,
  /^\/categories(?:\/|$)/,
];

function isPlainObject(value: any): value is PlainObject {
  const isFile = typeof File !== 'undefined' && value instanceof File;
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !isFile;
}

function humanizeFieldName(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim().replace(/^./, (char) => char.toUpperCase());
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCaseWord(word: string): string {
  const normalized = word.trim();
  if (!normalized) return normalized;

  const lettersOnly = normalized.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (ACRONYMS.has(lettersOnly)) return normalized.toUpperCase();
  if (/^[A-Za-z]\.$/.test(normalized)) return normalized.toUpperCase();

  return normalized.replace(/[A-Za-z]+/g, (part) => {
    const upper = part.toUpperCase();
    if (ACRONYMS.has(upper)) return upper;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  });
}

export function toTitleCase(value: unknown): string {
  const text = normalizeSpaces(String(value ?? ''))
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\.(?=[A-Za-z])/g, '. ');

  return text
    .split(' ')
    .map(titleCaseWord)
    .join(' ')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/([(])\s+/g, '$1');
}

function normalizeEmail(value: unknown): string {
  return normalizeSpaces(String(value ?? '')).toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
}

function normalizePhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  let national = digits;
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);

  if (national.length === 10 && /^[1-9]\d{9}$/.test(national)) {
    return `+91${national}`;
  }

  return raw;
}

function isValidPhone(value: string): boolean {
  if (!value) return true;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function normalizePersonName(value: unknown): string {
  const titleCased = toTitleCase(value);
  return titleCased.replace(/^(Mr|Ms|Mrs|Dr|Prof)\.?\s+/i, (_match, prefix) => `${toTitleCase(prefix)}. `);
}

function hasRequiredPersonTitle(value: string): boolean {
  if (!value) return true;
  return new RegExp(`^(${TITLE_PREFIXES.join('|')})\\.?\\s+`, 'i').test(value);
}

function shouldApplyDataQuality(endpoint: string): boolean {
  return DATA_QUALITY_ENDPOINTS.some((pattern) => pattern.test(endpoint));
}

function normalizeValue(fieldName: string, value: any, errors: string[]): any {
  if (typeof value !== 'string') return value;

  if (EMAIL_FIELDS.has(fieldName)) {
    const email = normalizeEmail(value);
    if (email && !isValidEmail(email)) errors.push(`${humanizeFieldName(fieldName)} is not a valid email address.`);
    return email;
  }

  if (PHONE_FIELDS.has(fieldName)) {
    const phone = normalizePhone(value);
    if (phone && !isValidPhone(phone)) errors.push(`${humanizeFieldName(fieldName)} must be a valid phone number (7–15 digits).`);
    return phone;
  }

  if (PERSON_NAME_FIELDS.has(fieldName)) {
    const personName = normalizePersonName(value);
    if (personName && !hasRequiredPersonTitle(personName)) {
      errors.push(`${humanizeFieldName(fieldName)} must start with Mr., Ms., Mrs., Dr., or Prof.`);
    }
    return personName;
  }

  if (UPPERCASE_FIELDS.has(fieldName)) return normalizeSpaces(value).toUpperCase();
  if (TITLE_CASE_FIELDS.has(fieldName)) return toTitleCase(value);

  return normalizeSpaces(value);
}

function normalizePayload(value: any, errors: string[], fieldName = ''): any {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePayload(entry, errors, fieldName));
  }

  if (!isPlainObject(value)) {
    return normalizeValue(fieldName, value, errors);
  }

  return Object.entries(value).reduce((next, [key, entry]) => {
    next[key] = normalizePayload(entry, errors, key);
    return next;
  }, {} as PlainObject);
}

export function prepareDataQualityPayload<T>(endpoint: string, data: T): T {
  if (!data || !shouldApplyDataQuality(endpoint)) return data;

  const errors: string[] = [];
  const normalized = normalizePayload(data, errors) as T;

  if (errors.length > 0) {
    throw new Error(Array.from(new Set(errors)).join('\n'));
  }

  return normalized;
}
