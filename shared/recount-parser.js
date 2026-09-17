function normalizeNumber(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseDocumentLines(text) {
  const items = [];
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!/^\d+\s+\d{4,6}/.test(line)) continue;

    const match = line.match(/^(\d+)\s+(\d{4,6})\s+(.+?)\s+(\d+\*\d+)?\s+([\d.,]+)\s+(.*)$/i);
    if (!match) continue;

    const tail = match[6] || '';
    const qtyMatches = [...tail.matchAll(/(\d+)\s*шт/gi)];
    const packageMatch = tail.match(/(\d+)\s*(?:кор|упак)/i);
    const docQty = qtyMatches.length ? Number.parseInt(qtyMatches[qtyMatches.length - 1][1], 10) : null;
    const pieceQty = qtyMatches.length >= 2
      ? Number.parseInt(qtyMatches[0][1], 10)
      : qtyMatches.length === 1 ? Number.parseInt(qtyMatches[0][1], 10) : null;

    items.push({
      code: match[2],
      name: match[3].trim(),
      unit: match[4] || '',
      price: normalizeNumber(match[5]),
      docQty,
      packageQty: packageMatch ? Number.parseInt(packageMatch[1], 10) : null,
      pieceQty
    });
  }

  return items;
}

export function extractRecountMeta(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const storeLine = lines.find(line => /^По\s+магазину:/i.test(line)) || '';
  const storePart = storeLine.split(/(?:Сформировано:|Просчет\s+с)/i)[0] || '';
  const storeLabel = storePart.replace(/^По\s+магазину:\s*/i, '').trim();
  const storeNumberMatch = storeLabel.match(/№\s*(\d+)/i);
  const storeAddressMatch = storeLabel.match(/\(([^)]+)\)/);

  return {
    storeLabel,
    storeNumber: storeNumberMatch?.[1] || '',
    storeAddress: storeAddressMatch?.[1] || ''
  };
}