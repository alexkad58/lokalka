import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFactExpression, sumFactExpression, parseCenCode } from '../shared/recount-utils.js';

test('sanitizeFactExpression keeps expression format and removes invalid chars', () => {
  assert.equal(sanitizeFactExpression('3+7+12'), '3+7+12');
  assert.equal(sanitizeFactExpression('3 + 7 + 12'), '3+7+12');
  assert.equal(sanitizeFactExpression('abc3+7x'), '3+7');
  assert.equal(sanitizeFactExpression('3+'), '3+');
});

test('sumFactExpression totals added values', () => {
  assert.equal(sumFactExpression('3+7+12'), 22);
  assert.equal(sumFactExpression('0+0'), 0);
});

test('parseCenCode extracts second semicolon-delimited token', () => {
  assert.equal(parseCenCode('CEN;123123;55;66'), '123123');
  assert.equal(parseCenCode('CEN;123123'), '123123');
  assert.equal(parseCenCode('ABC;123123;55'), null);
});
