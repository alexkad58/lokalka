import test from 'node:test';
import assert from 'node:assert/strict';

import { createReferralService } from '../server/services/referral-service.js';
import { createUsersService } from '../server/services/users-service.js';
import { hashPassword, verifyPassword } from '../server/auth/password.js';
import { normalizeLogin } from '../server/utils/request.js';

function createFixture() {
  const db = {
    users: [
      {
        id: 'u_owner',
        login: 'owner',
        isAdmin: false,
        securityRole: true,
        subscriptionUntil: null,
        referralUsedAt: null,
        referralActivationId: null
      },
      {
        id: 'u_target',
        login: 'target',
        isAdmin: false,
        securityRole: false,
        subscriptionUntil: null,
        referralUsedAt: null,
        referralActivationId: null
      }
    ],
    recounts: [],
    sessions: [],
    settings: {},
    referrals: {
      codes: [],
      activations: []
    }
  };

  let saveCount = 0;
  let idCounter = 0;
  const toIsoNow = () => '2026-09-16T10:00:00.000Z';

  const usersService = createUsersService({
    db,
    adminLogin: 'admin',
    adminPassword: 'admin',
    hashPassword,
    verifyPassword,
    normalizeLogin,
    createId: prefix => `${prefix}_${++idCounter}`,
    toIsoNow,
    formatRuDate: value => String(value)
  });

  const referralService = createReferralService({
    db,
    saveDb: async () => {
      saveCount += 1;
    },
    usersService,
    createId: prefix => `${prefix}_${++idCounter}`,
    toIsoNow,
    randomBytes: size => Buffer.alloc(size, 7),
    logEvent: () => {}
  });

  referralService.ensureReferralState();

  return {
    db,
    usersService,
    referralService,
    getSaveCount: () => saveCount
  };
}

test('referral service issues code, activates once and keeps idempotent repeat', async () => {
  const fixture = createFixture();
  const owner = fixture.db.users[0];
  const target = fixture.db.users[1];

  const codeRecord = await fixture.referralService.issueCode({
    actor: owner,
    targetUser: owner,
    trialDays: 3,
    regenerate: false,
    requestMeta: {}
  });

  assert.equal(codeRecord.trialDays, 3);
  assert.ok(codeRecord.code.length >= 6);

  const firstActivation = await fixture.referralService.activateCode({
    user: target,
    rawCode: codeRecord.code,
    ip: '203.0.113.1',
    source: 'manual',
    requestMeta: {}
  });

  assert.equal(firstActivation.ok, true);
  assert.equal(firstActivation.alreadyApplied, false);
  assert.equal(target.referralActivationId?.startsWith('refact_'), true);
  assert.equal(target.subscriptionUntil, '2026-09-19T10:00:00.000Z');

  const repeatedActivation = await fixture.referralService.activateCode({
    user: target,
    rawCode: codeRecord.code,
    ip: '203.0.113.1',
    source: 'invite-auto',
    requestMeta: {}
  });

  assert.equal(repeatedActivation.ok, true);
  assert.equal(repeatedActivation.alreadyApplied, true);
  assert.equal(fixture.db.referrals.activations.length, 1);
  assert.ok(fixture.getSaveCount() >= 2);
});

test('referral stats count completed recounts only inside activation windows', async () => {
  const fixture = createFixture();
  const owner = fixture.db.users[0];
  const target = fixture.db.users[1];

  const codeRecord = await fixture.referralService.issueCode({
    actor: owner,
    targetUser: owner,
    trialDays: 1,
    regenerate: false,
    requestMeta: {}
  });

  await fixture.referralService.activateCode({
    user: target,
    rawCode: codeRecord.code,
    ip: '198.51.100.22',
    source: 'manual',
    requestMeta: {}
  });

  fixture.db.recounts.push(
    {
      id: 'r_before',
      userId: target.id,
      status: 'completed',
      completedAt: '2026-09-16T09:59:59.999Z'
    },
    {
      id: 'r_inside_1',
      userId: target.id,
      status: 'completed',
      completedAt: '2026-09-16T10:00:00.000Z'
    },
    {
      id: 'r_inside_2',
      userId: target.id,
      status: 'completed',
      completedAt: '2026-09-17T10:00:00.000Z'
    },
    {
      id: 'r_after',
      userId: target.id,
      status: 'completed',
      completedAt: '2026-09-17T10:00:00.001Z'
    },
    {
      id: 'r_active',
      userId: target.id,
      status: 'active',
      completedAt: '2026-09-16T11:00:00.000Z'
    }
  );

  const stats = fixture.referralService.buildSecurityUserReferralStats(owner.id);
  assert.equal(stats.activationsCount, 1);
  assert.equal(stats.completedRecountsTotal, 2);
});
