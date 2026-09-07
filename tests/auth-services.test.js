import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../server/auth/password.js';
import { createUsersService } from '../server/services/users-service.js';
import { formatRuDate, toIsoNow } from '../server/utils/dates.js';
import { normalizeLogin } from '../server/utils/request.js';

test('password service hashes and verifies passwords', () => {
  const hash = hashPassword('secret-password');
  assert.notEqual(hash, 'secret-password');
  assert.equal(verifyPassword('secret-password', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('users service preserves admin and subscription policies', () => {
  const db = { users: [] };
  const service = createUsersService({
    db,
    adminLogin: 'admin',
    adminPassword: 'admin-password',
    hashPassword,
    verifyPassword,
    normalizeLogin,
    createId: prefix => `${prefix}_1`,
    toIsoNow,
    formatRuDate
  });

  assert.equal(service.ensureAdminUser(), true);
  assert.equal(db.users[0].isAdmin, true);
  assert.equal(service.hasActiveSubscription(db.users[0]), true);
  assert.equal(service.publicUser(db.users[0]).subscriptionActive, true);
});
