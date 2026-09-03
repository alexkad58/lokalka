export function asNumber(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sanitizeFactExpression(value) {
  let normalized = String(value ?? '').replace(/[^\d+]/g, '');
  normalized = normalized.replace(/\++/g, '+');
  normalized = normalized.replace(/^\+/, '');
  return normalized;
}

export function sumFactExpression(value) {
  const normalized = sanitizeFactExpression(value);
  const parts = normalized.split('+').filter(Boolean);
  if (!parts.length) return null;

  return parts.reduce((acc, part) => acc + asNumber(part), 0);
}

export function parseCenCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const parts = raw.split(';');
  if (!parts.length || parts[0]?.toUpperCase() !== 'CEN') return null;
  const barcode = parts[1]?.trim();
  return barcode || null;
}

export function normalizeScannedCode(value) {
  const parsed = parseCenCode(value);
  if (parsed) return parsed;
  return String(value ?? '').trim();
}
