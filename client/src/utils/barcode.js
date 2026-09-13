export const BARCODE_CACHE_STORAGE_KEY = 'barcode_article_cache_v1';

export function supportsBarcodeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function normalizeBarcodeValue(value) {
  return String(value || '').trim();
}

export function loadBarcodeCache() {
  try {
    const raw = localStorage.getItem(BARCODE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveBarcodeCache(cache) {
  localStorage.setItem(BARCODE_CACHE_STORAGE_KEY, JSON.stringify(cache || {}));
}

export function reassignBarcodeToItem(cache, barcode, itemCode) {
  const normalizedItemCode = String(itemCode);
  const nextCache = {};

  // Copy all existing barcodes as-is (don't remove itemCode from other barcodes)
  for (const [mappedBarcode, record] of Object.entries(cache || {})) {
    const codes = Array.isArray(record?.codes)
      ? record.codes.map(String)
      : record?.code ? [String(record.code)] : [];
    
    if (codes.length) {
      nextCache[mappedBarcode] = {
        ...record,
        codes: Array.from(new Set(codes))
      };
    }
  }

  // Add itemCode to target barcode with deduplication
  const currentCodes = nextCache[barcode]?.codes || [];
  nextCache[barcode] = {
    ...(nextCache[barcode] || {}),
    codes: Array.from(new Set([...currentCodes, normalizedItemCode])),
    source: 'manual'
  };

  return nextCache;
}
