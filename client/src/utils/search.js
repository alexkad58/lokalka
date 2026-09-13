export function normalizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/ж\s*\/\s*б/g, 'жб')
    .replace(/№/g, ' ')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearch(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(' ') : [];
}

export function matchesSearchQuery(query, ...candidates) {
  const tokens = tokenizeSearch(query);
  if (!tokens.length) return true;

  const haystacks = candidates
    .map(candidate => normalizeSearchText(candidate))
    .filter(Boolean);

  if (!haystacks.length) return false;

  return tokens.every(token => haystacks.some(text => text.includes(token)));
}
