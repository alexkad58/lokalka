import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTableRows } from '../server/pdf/table.js';
import { asNumber } from '../server/utils/numbers.js';
import { sanitizeFactExpression, sumFactExpression } from '../shared/recount-utils.js';

test('PDF table preparation preserves fact expressions and mismatch rows', () => {
  const result = buildTableRows({
    values: { a: '3+1', b: '' },
    items: [
      { code: 'a', name: 'Товар A', unit: 'шт', price: '10', docQty: 2 },
      { code: 'b', name: 'Товар B', unit: 'шт', price: '5', docQty: 4 }
    ]
  }, { asNumber, sanitizeFactExpression, sumFactExpression });

  assert.equal(result.rows[0].factTotal, '3+1');
  assert.equal(result.rows[0].discrepancy, '+2');
  assert.equal(result.mismatchRows.length, 2);
  assert.equal(result.mismatchRows[0].code, 'a');
  assert.equal(result.plusSum, 20);
  assert.equal(result.minusSum, 20);
});
