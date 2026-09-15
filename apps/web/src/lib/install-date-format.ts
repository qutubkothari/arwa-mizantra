const DATE_FORMAT_PATCH_FLAG = Symbol.for('sak-erp.date-format-patched');

type DateLocaleArg = string | string[] | undefined;

type PatchedDateConstructor = DateConstructor & {
  [DATE_FORMAT_PATCH_FLAG]?: boolean;
};

const originalToLocaleDateString = Date.prototype.toLocaleDateString;
const originalToLocaleString = Date.prototype.toLocaleString;

function normalizeDateSeparators(value: string): string {
  return value.replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$1-$2-$3');
}

function shouldNormalizeLocale(locales?: DateLocaleArg): boolean {
  if (locales == null) return true;
  if (Array.isArray(locales)) {
    return locales.length === 0 || locales.some((locale) => String(locale || '').trim().toLowerCase() === 'en-in');
  }

  return String(locales || '').trim().toLowerCase() === 'en-in';
}

function buildNormalizedDateOptions(
  options: Intl.DateTimeFormatOptions | undefined,
  includeTime: boolean,
): Intl.DateTimeFormatOptions {
  const normalized: Intl.DateTimeFormatOptions = {
    ...(options || {}),
  };

  delete normalized.dateStyle;
  delete normalized.weekday;
  delete normalized.era;
  normalized.day = '2-digit';
  normalized.month = '2-digit';
  normalized.year = 'numeric';

  const hasExplicitTimeOptions = Boolean(
    normalized.timeStyle ||
      normalized.hour ||
      normalized.minute ||
      normalized.second ||
      normalized.fractionalSecondDigits ||
      normalized.timeZoneName,
  );

  const requestedTimeStyle = normalized.timeStyle;
  delete normalized.timeStyle;

  if (!includeTime) {
    delete normalized.hour;
    delete normalized.minute;
    delete normalized.second;
    delete normalized.fractionalSecondDigits;
    delete normalized.timeZoneName;
    delete normalized.hour12;
    return normalized;
  }

  if (!hasExplicitTimeOptions) {
    normalized.hour = '2-digit';
    normalized.minute = '2-digit';
    normalized.second = '2-digit';
    normalized.hour12 = false;
  } else if (requestedTimeStyle && !normalized.hour && !normalized.minute && !normalized.second) {
    normalized.hour = '2-digit';
    normalized.minute = '2-digit';
    if (requestedTimeStyle === 'medium' || requestedTimeStyle === 'long' || requestedTimeStyle === 'full') {
      normalized.second = '2-digit';
    }
  }

  return normalized;
}

export function installDateFormatDefaults(): void {
  const patchedDate = Date as PatchedDateConstructor;
  if (patchedDate[DATE_FORMAT_PATCH_FLAG]) return;

  Date.prototype.toLocaleDateString = function toLocaleDateStringPatched(
    locales?: DateLocaleArg,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    if (!shouldNormalizeLocale(locales)) {
      return originalToLocaleDateString.call(this, locales as any, options);
    }

    return normalizeDateSeparators(
      originalToLocaleDateString.call(
        this,
        'en-GB',
        buildNormalizedDateOptions(options, false),
      ),
    );
  };

  Date.prototype.toLocaleString = function toLocaleStringPatched(
    locales?: DateLocaleArg,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    if (!shouldNormalizeLocale(locales)) {
      return originalToLocaleString.call(this, locales as any, options);
    }

    return normalizeDateSeparators(
      originalToLocaleString.call(
        this,
        'en-GB',
        buildNormalizedDateOptions(options, true),
      ),
    );
  };

  patchedDate[DATE_FORMAT_PATCH_FLAG] = true;
}

installDateFormatDefaults();
