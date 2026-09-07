import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMoney, normalizeNumber } from '../server/utils/numbers.js';
import { formatRuDate, formatRuTime, toIsoNow } from '../server/utils/dates.js';
import { getDeviceIdFromRequest, getRequestIp, normalizeDeviceId, normalizeLogin } from '../server/utils/request.js';
import { clipLogString, sanitizeLogLevel, sanitizeLogMeta } from '../server/utils/logging.js';

test('date and number utilities preserve server formatting', () => {
  assert.match(toIsoNow(), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(normalizeNumber('12,50'), 12.5);
  assert.equal(normalizeNumber('invalid'), null);
  assert.equal(formatMoney('12,5'), '12.50 руб.');
  assert.match(formatRuDate('2026-09-07'), /2026/);
  assert.match(formatRuTime('2026-09-07T12:34:56Z'), /\d{2}:\d{2}:\d{2}/);
});

test('request utilities normalize device and forwarded client data', () => {
  assert.equal(normalizeLogin('  User.Name '), 'user.name');
  assert.equal(normalizeDeviceId(' device abc/123 '), 'deviceabc123');
  assert.equal(getDeviceIdFromRequest({ headers: { 'x-device-id': ' phone-1 ' } }), 'phone-1');
  assert.equal(getRequestIp({ headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }, ip: '127.0.0.1' }), '203.0.113.10');
});

test('logging utilities clip and sanitize nested metadata', () => {
  assert.equal(clipLogString('abcdef', 3), 'abc...');
  assert.equal(sanitizeLogLevel('WARN', ['all', 'warn', 'info']), 'warn');
  assert.equal(sanitizeLogLevel('unknown', ['all', 'warn', 'info']), 'info');
  assert.deepEqual(sanitizeLogMeta({ keep: 'value', omit: undefined, nested: { value: true } }), {
    keep: 'value',
    nested: { value: true }
  });
});
