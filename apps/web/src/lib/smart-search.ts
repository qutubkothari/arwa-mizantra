/**
 * Normalise human-entered ERP search text.
 * Product dimensions such as 8x60, 8×60, 8 X 60, 8-60 and 8*60 are
 * intentionally treated as the same value.
 */
export function normalizeSmartSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[×✕✖*]/g, "x")
    .replace(/[–—−]/g, "-")
    .toLowerCase()
    .trim()
    .replace(/(\d)\s*(?:x|[-_/]|\s)\s*(?=\d)/g, "$1x")
    .replace(/\s+/g, " ");
}

export function compactSmartSearchText(value: unknown): string {
  return normalizeSmartSearchText(value).replace(/[^a-z0-9]+/g, "");
}

export function smartSearchTokens(value: unknown): string[] {
  return normalizeSmartSearchText(value)
    .split(/[\s,;|/\\()[\]{}"'`._:]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function smartSearchMatches(
  query: unknown,
  ...candidateValues: unknown[]
): boolean {
  const normalizedQuery = normalizeSmartSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSmartSearchText(candidateValues.join(" "));
  const compactHaystack = compactSmartSearchText(haystack);

  return smartSearchTokens(normalizedQuery).every((token) => {
    const normalizedToken = normalizeSmartSearchText(token);
    const compactToken = compactSmartSearchText(normalizedToken);
    return (
      haystack.includes(normalizedToken) ||
      (compactToken.length > 0 && compactHaystack.includes(compactToken))
    );
  });
}
