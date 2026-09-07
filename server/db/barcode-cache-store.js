import { readFile, writeFile } from 'node:fs/promises';

export function createBarcodeCacheStore({ fileUrl, cache, onError }) {
  async function load() {
    try {
      const raw = await readFile(fileUrl, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      for (const [barcode, record] of Object.entries(parsed)) {
        if (!record || typeof record !== 'object') continue;

        const codes = Array.isArray(record.codes)
          ? record.codes.map(String)
          : (record.code ? [String(record.code)] : []);

        cache.set(barcode, {
          codes: Array.from(new Set(codes)),
          source: record.source || 'cache',
          product: record.product || null,
          storeNumber: record.storeNumber ? String(record.storeNumber) : '',
          updatedAt: record.updatedAt || Date.now()
        });
      }
    } catch {
      // The cache is optional and may not exist on first startup.
    }
  }

  function persist() {
    const payload = Object.fromEntries(cache.entries());
    writeFile(fileUrl, JSON.stringify(payload, null, 2), 'utf8').catch(error => {
      onError?.(error);
    });
  }

  return { load, persist };
}
