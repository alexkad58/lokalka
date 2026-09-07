import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecountService } from '../server/services/recount-service.js';
import { sanitizeFactExpression, sumFactExpression } from '../shared/recount-utils.js';
import { asNumber } from '../server/utils/numbers.js';
import { toIsoNow } from '../server/utils/dates.js';

function createFixture() {
  const db = { recounts: [] };
  let saveCount = 0;
  let id = 0;
  const service = createRecountService({
    db,
    saveDb: async () => { saveCount += 1; },
    createId: prefix => `${prefix}_${++id}`,
    createDocId: () => 'loc_test',
    toIsoNow,
    sanitizeFactExpression,
    sumFactExpression,
    asNumber,
    parseDocumentLines: () => [{ code: '1234', name: 'Test', price: '10', docQty: 2 }],
    extractRecountMeta: () => ({ storeLabel: '№1', storeNumber: '1', storeAddress: '' })
  });
  return { db, service, getSaveCount: () => saveCount };
}

test('recount service creates and summarizes fact expressions', async () => {
  const fixture = createFixture();
  const recount = await fixture.service.createFromText({
    userId: 'user-1',
    sourceFileName: 'test.pdf',
    text: 'ignored'
  });

  recount.values = { '1234': '3+1' };
  const summary = fixture.service.buildSummary(recount);
  assert.equal(summary.totalItems, 1);
  assert.equal(summary.filledCount, 1);
  assert.equal(summary.mismatchCount, 1);
  assert.equal(summary.totalSumRub, 20);
});

test('recount service preserves lifecycle transitions and scoped deletion', async () => {
  const fixture = createFixture();
  const recount = await fixture.service.createFromText({ userId: 'user-1', sourceFileName: 'test.pdf', text: '' });

  const progress = await fixture.service.saveProgressForUser('user-1', recount.id, {
    values: { '1234': '2' },
    search: 'query'
  }, 0);
  assert.equal(progress.status, 'ok');
  assert.equal(recount.search, 'query');

  const completed = await fixture.service.completeForUser('user-1', recount.id, {
    values: { '1234': '3' },
    withoutPdf: true,
    updateCompletionTime: true
  });
  assert.equal(completed.status, 'ok');
  assert.equal(recount.status, 'completed');

  const deletedForOtherUser = await fixture.service.deleteForUser('other-user', recount.id);
  assert.equal(deletedForOtherUser, null);
  const deleted = await fixture.service.deleteForUser('user-1', recount.id);
  assert.equal(deleted.id, recount.id);
  assert.ok(fixture.getSaveCount() >= 3);
});
