export function formatTsdDate(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  });
}

export function normalizeTsdPrice(value) {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return '';
  return Number(normalized).toFixed(2);
}

export function parseTsdQr(value) {
  const parts = String(value || '').trim().split(';');
  if (parts[0] !== 'CEN' || parts.length < 6) return null;

  const price = normalizeTsdPrice(parts[2]);
  if (!parts[1] || !price || !parts[5]) return null;

  return {
    raw: String(value).trim(),
    barcode: parts[1],
    price,
    date: parts[5]
  };
}
