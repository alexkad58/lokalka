export function drawCell(document, x, y, width, height, text, options = {}) {
  document.save();
  document.lineWidth(0.3);
  document.rect(x, y, width, height).stroke();
  document.restore();
  document.fontSize(options.fontSize || 7);
  document.text(String(text ?? ''), x + 2, y + 2, {
    width: width - 2,
    height: height - 2,
    align: options.align || 'left'
  });
}

export function buildTableRows(recount, { asNumber, sanitizeFactExpression, sumFactExpression }) {
  const rows = [];
  const mismatchRows = [];
  const values = recount.values || {};
  let plusSum = 0;
  let minusSum = 0;
  let index = 1;

  for (const item of recount.items || []) {
    const docQty = asNumber(item.docQty);
    const rawExpression = sanitizeFactExpression(values?.[item.code] ?? '');
    const fact = rawExpression ? sumFactExpression(rawExpression) : 0;
    const factNumber = fact === null ? null : asNumber(fact);
    const delta = factNumber === null ? null : factNumber - docQty;

    if (delta !== null && delta > 0) plusSum += delta * asNumber(item.price);
    if (delta !== null && delta < 0) minusSum += Math.abs(delta) * asNumber(item.price);

    const row = {
      index,
      code: item.code,
      name: item.name,
      unit: item.unit || '',
      price: asNumber(item.price).toFixed(2),
      docPack: '',
      docUnits: docQty || '',
      factTotal: factNumber === null ? '' : (rawExpression || String(factNumber)),
      discrepancy: delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`
    };
    rows.push(row);

    if (delta !== null && delta !== 0) {
      mismatchRows.push({
        index,
        name: item.name,
        code: item.code,
        discrepancy: row.discrepancy
      });
    }

    index += 1;
  }

  return {
    rows,
    mismatchRows,
    plusSum,
    minusSum,
    totalSum: plusSum - minusSum
  };
}
