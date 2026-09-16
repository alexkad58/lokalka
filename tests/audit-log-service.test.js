import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuditLogService } from '../server/services/audit-log-service.js';
import { toIsoNow } from '../server/utils/dates.js';
import { getRequestIp } from '../server/utils/request.js';
import { sanitizeLogLevel, sanitizeLogMeta } from '../server/utils/logging.js';

test('audit service keeps normalized entries and admin log query contract', () => {
  const logger = {
    infoCalls: [],
    info(payload) {
      this.infoCalls.push(payload);
    }
  };
  let id = 0;
  const service = createAuditLogService({
    logger,
    maxAuditLogs: 200,
    knownLogLevels: ['all', 'error', 'warn', 'info'],
    createId: prefix => `${prefix}_${++id}`,
    toIsoNow,
    sanitizeLogLevel,
    sanitizeLogMeta,
    getRequestIp,
    shopApiStdoutLogs: false
  });

  service.logEvent('WARN', 'test-event', {
    actorLogin: 'tester',
    nested: { keep: true },
    ignored: undefined
  });

  const result = service.getLogs('warn', 20);
  assert.equal(result.selectedLevel, 'warn');
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].id, 'log_1');
  assert.equal(result.entries[0].actorLogin, 'tester');
  assert.deepEqual(result.entries[0].meta.nested, { keep: true });
  assert.equal(result.entries[0].meta.ignored, undefined);
  assert.equal(logger.infoCalls.length, 1);
});

test('audit service groups noisy scanner logs and filters by actor', () => {
  let id = 0;
  const service = createAuditLogService({
    logger: {},
    maxAuditLogs: 200,
    knownLogLevels: ['all', 'error', 'warn', 'info'],
    createId: prefix => `${prefix}_${++id}`,
    toIsoNow,
    sanitizeLogLevel,
    sanitizeLogMeta,
    getRequestIp,
    shopApiStdoutLogs: false
  });

  service.logEvent('info', 'resolve-barcode-request', { actorId: 'u1', actorLogin: 'anna', barcode: '111' });
  service.logEvent('info', 'shop-api-response', { actorId: 'u1', actorLogin: 'anna', status: 200 });
  service.logEvent('info', 'recount-create-success', { actorId: 'u2', actorLogin: 'boris', recountId: 'r1' });
  service.logEvent('warn', 'login-failed', { login: 'boris' });

  const scannerLogs = service.getLogs('all', 20, 'scanner');
  assert.equal(scannerLogs.selectedGroup, 'scanner');
  assert.equal(scannerLogs.total, 2);
  assert.equal(scannerLogs.groupCounts.scanner, 2);
  assert.equal(scannerLogs.groupCounts.recount, 1);
  assert.equal(scannerLogs.entries.every(entry => entry.group === 'scanner'), true);

  const userLogs = service.getLogs('all', 20, 'all', 'u2');
  assert.equal(userLogs.selectedActorKeys[0], 'u2');
  assert.equal(userLogs.total, 1);
  assert.equal(userLogs.entries[0].event, 'recount-create-success');
  assert.deepEqual(userLogs.users.map(item => item.login), ['anna', 'boris', 'система']);
});

test('audit service builds request metadata without exposing unrelated fields', () => {
  const service = createAuditLogService({
    logger: {},
    maxAuditLogs: 200,
    knownLogLevels: ['all', 'info'],
    createId: prefix => prefix,
    toIsoNow,
    sanitizeLogLevel,
    sanitizeLogMeta,
    getRequestIp,
    shopApiStdoutLogs: false
  });

  assert.deepEqual(service.buildRequestLogMeta({
    user: { id: 'u1', login: 'tester', isAdmin: true },
    method: 'GET',
    url: '/health',
    headers: { 'x-forwarded-for': '203.0.113.5' },
    ip: '127.0.0.1'
  }, { scope: 'smoke' }), {
    actorId: 'u1',
    actorLogin: 'tester',
    actorIsAdmin: true,
    method: 'GET',
    path: '/health',
    ip: '203.0.113.5',
    scope: 'smoke'
  });
});
