import './install-date-format';

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const inputValue = parseDisplayDateToInputValue(raw);
    if (!inputValue) return null;
    const [year, month, day] = inputValue.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = value;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getTodayDateInputValue(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}

export function formatDisplayDateTime(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return '—';
  const dateText = formatDisplayDate(date);
  const timeText = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateText}, ${timeText}`;
}

export function formatDateInputDisplay(value: string | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
}

function parseDatePartsToInputValue(dayText: string, monthText: string, yearText: string): string {
  const day = Number(dayText);
  const month = Number(monthText);
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return '';
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDisplayDateToInputValue(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;

  const compactShortMatch = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (compactShortMatch) {
    return parseDatePartsToInputValue(compactShortMatch[1], compactShortMatch[2], compactShortMatch[3]);
  }

  const compactLongMatch = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compactLongMatch) {
    return parseDatePartsToInputValue(compactLongMatch[1], compactLongMatch[2], compactLongMatch[3]);
  }

  const displayMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!displayMatch) return '';
  return parseDatePartsToInputValue(displayMatch[1], displayMatch[2], displayMatch[3]);
}
