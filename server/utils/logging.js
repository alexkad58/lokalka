export function sanitizeLogLevel(level, knownLevels = []) {
  const normalized = String(level || '').trim().toLowerCase();
  if (knownLevels.includes(normalized) && normalized !== 'all') {
    return normalized;
  }
  return 'info';
}

export function clipLogString(value, maxLength = 300) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function sanitizeLogMetaValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return clipLogString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[depth-limit]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map(item => sanitizeLogMetaValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      result[key] = sanitizeLogMetaValue(item, depth + 1);
    }
    return result;
  }

  return clipLogString(value);
}

export function sanitizeLogMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    result[key] = sanitizeLogMetaValue(value);
  }
  return result;
}
