import { BadRequestException } from '@nestjs/common';

const TITLE_PREFIXES = ['Mr', 'Ms', 'Mrs', 'Dr', 'Prof'];
const ACRONYMS = new Set(['BOM', 'CAD', 'CEO', 'CFO', 'CIN', 'CNC', 'COD', 'ERP', 'GST', 'GSTIN', 'HR', 'HSN', 'IGST', 'ISO', 'LLP', 'LTD', 'MSME', 'PAN', 'PO', 'PR', 'PVT', 'QC', 'SAC', 'TDS', 'UID', 'UOM']);

function normalizeSpaces(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
  const text = normalizeSpaces(value)
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

export function toUpperCode(value: unknown): string {
  return normalizeSpaces(value).toUpperCase();
}

export function normalizeEmail(value: unknown): string {
  const email = normalizeSpaces(value).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return email;
}

export function normalizeIndianMobile(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  let national = digits;
  if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  if (national.length === 10 && /^[6-9]\d{9}$/.test(national)) return `+91${national}`;
  throw new BadRequestException('Enter a valid Indian mobile number.');
}

export function normalizePersonName(value: unknown, label = 'Person name'): string {
  const personName = toTitleCase(value).replace(/^(Mr|Ms|Mrs|Dr|Prof)\.?\s+/i, (_match, prefix) => `${toTitleCase(prefix)}. `);
  if (personName && !new RegExp(`^(${TITLE_PREFIXES.join('|')})\\.?\\s+`, 'i').test(personName)) {
    throw new BadRequestException(`${label} must start with Mr., Ms., Mrs., Dr., or Prof.`);
  }
  return personName;
}

export function normalizeRegionalPhone(value: unknown, marketProfile: unknown = 'INDIA'): string {
  const market = String(marketProfile || 'INDIA').trim().toUpperCase();
  if (market !== 'UAE') return normalizeIndianMobile(value);

  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  let national = digits;
  if (national.startsWith('00971')) national = national.slice(5);
  else if (national.startsWith('971')) national = national.slice(3);
  else if (national.startsWith('0')) national = national.slice(1);

  // UAE mobile numbers contain nine national digits and start with 5.
  if (/^5\d{8}$/.test(national)) return `+971${national}`;
  throw new BadRequestException('Enter a valid UAE mobile number.');
}
