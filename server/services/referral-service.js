const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_CODE_MIN_LENGTH = 6;
const REFERRAL_CODE_MAX_LENGTH = 20;

function normalizeReferralCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, REFERRAL_CODE_MAX_LENGTH);
}

function maskReferralCode(value) {
  const code = normalizeReferralCode(value);
  if (!code) return '';
  if (code.length <= 4) return `${code.slice(0, 1)}***${code.slice(-1)}`;
  return `${code.slice(0, 2)}***${code.slice(-2)}`;
}

function clampTrialDays(value) {
  return Number(value) === 3 ? 3 : 1;
}

function isDateInRange(value, startIso, endIso) {
  const ts = Date.parse(String(value || ''));
  const startTs = Date.parse(String(startIso || ''));
  const endTs = Date.parse(String(endIso || ''));
  if (Number.isNaN(ts) || Number.isNaN(startTs) || Number.isNaN(endTs)) return false;
  return ts >= startTs && ts <= endTs;
}

export function createReferralService({
  db,
  saveDb,
  usersService,
  createId,
  toIsoNow,
  randomBytes,
  logEvent,
  telegramLogService = null,
  rateLimitMaxAttempts = 8,
  rateLimitWindowMs = 10 * 60 * 1000,
  rateLimitBlockMs = 15 * 60 * 1000
}) {
  const attemptsByKey = new Map();

  function ensureReferralState() {
    if (!db.referrals || typeof db.referrals !== 'object') {
      db.referrals = { codes: [], activations: [] };
    }
    if (!Array.isArray(db.referrals.codes)) db.referrals.codes = [];
    if (!Array.isArray(db.referrals.activations)) db.referrals.activations = [];

    db.referrals.codes = db.referrals.codes
      .map(item => {
        const normalizedCode = normalizeReferralCode(item?.code);
        if (!normalizedCode || normalizedCode.length < REFERRAL_CODE_MIN_LENGTH) return null;
        const ownerUserId = String(item?.ownerUserId || '').trim();
        if (!ownerUserId) return null;
        return {
          id: String(item?.id || createId('refcode')),
          ownerUserId,
          code: normalizedCode,
          trialDays: clampTrialDays(item?.trialDays),
          createdAt: String(item?.createdAt || toIsoNow()),
          updatedAt: String(item?.updatedAt || item?.createdAt || toIsoNow()),
          revokedAt: item?.revokedAt ? String(item.revokedAt) : null,
          revokeReason: item?.revokeReason ? String(item.revokeReason) : null,
          expiresAt: item?.expiresAt ? String(item.expiresAt) : null
        };
      })
      .filter(Boolean);

    db.referrals.activations = db.referrals.activations
      .map(item => {
        const id = String(item?.id || '').trim();
        const codeId = String(item?.codeId || '').trim();
        const ownerUserId = String(item?.ownerUserId || '').trim();
        const activatedUserId = String(item?.activatedUserId || '').trim();
        const activatedAt = String(item?.activatedAt || '').trim();
        const trialUntil = String(item?.trialUntil || '').trim();
        if (!id || !codeId || !ownerUserId || !activatedUserId || !activatedAt || !trialUntil) return null;
        return {
          id,
          codeId,
          ownerUserId,
          activatedUserId,
          activatedAt,
          trialDays: clampTrialDays(item?.trialDays),
          trialUntil,
          source: String(item?.source || 'manual'),
          ip: item?.ip ? String(item.ip) : null
        };
      })
      .filter(Boolean);
  }

  function buildCode() {
    for (let index = 0; index < 32; index += 1) {
      const bytes = randomBytes(10);
      let code = '';
      for (const value of bytes) {
        code += REFERRAL_ALPHABET[value % REFERRAL_ALPHABET.length];
      }
      code = code.slice(0, 10);
      if (!findCodeRecord(code)) return code;
    }

    throw new Error('Не удалось сгенерировать уникальный код приглашения');
  }

  function findCodeRecord(rawCode) {
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized) return null;
    return db.referrals.codes.find(item => item.code === normalized) || null;
  }

  function getActiveCodeByOwner(ownerUserId) {
    return db.referrals.codes.find(item => item.ownerUserId === ownerUserId && !item.revokedAt) || null;
  }

  function buildAttemptKeys({ userId, ip }) {
    const keys = [];
    const normalizedUserId = String(userId || '').trim();
    const normalizedIp = String(ip || '').trim();
    if (normalizedUserId) keys.push(`user:${normalizedUserId}`);
    if (normalizedIp) keys.push(`ip:${normalizedIp}`);
    return keys;
  }

  function isRateLimited(identity) {
    const now = Date.now();
    const keys = buildAttemptKeys(identity);
    for (const key of keys) {
      const state = attemptsByKey.get(key);
      if (!state) continue;
      if (state.blockedUntilTs && state.blockedUntilTs > now) return true;
      if (state.windowStartedTs + rateLimitWindowMs < now) {
        attemptsByKey.delete(key);
      }
    }
    return false;
  }

  function registerFailedAttempt(identity) {
    const now = Date.now();
    const keys = buildAttemptKeys(identity);
    for (const key of keys) {
      const previous = attemptsByKey.get(key);
      if (!previous || previous.windowStartedTs + rateLimitWindowMs < now) {
        attemptsByKey.set(key, {
          count: 1,
          windowStartedTs: now,
          blockedUntilTs: 0
        });
        continue;
      }

      const nextCount = previous.count + 1;
      const blockedUntilTs = nextCount >= rateLimitMaxAttempts
        ? now + rateLimitBlockMs
        : previous.blockedUntilTs;
      attemptsByKey.set(key, {
        count: nextCount,
        windowStartedTs: previous.windowStartedTs,
        blockedUntilTs
      });
    }
  }

  function clearFailedAttempts(identity) {
    const keys = buildAttemptKeys(identity);
    for (const key of keys) attemptsByKey.delete(key);
  }

  function buildSecurityUserReferralStats(userId) {
    ensureReferralState();
    const codeRecord = getActiveCodeByOwner(userId);
    const activations = db.referrals.activations.filter(item => item.ownerUserId === userId);

    let completedRecountsTotal = 0;
    for (const activation of activations) {
      const matches = db.recounts.filter(recount => (
        recount.userId === activation.activatedUserId
        && recount.status === 'completed'
        && isDateInRange(recount.completedAt, activation.activatedAt, activation.trialUntil)
      ));
      completedRecountsTotal += matches.length;
    }

    return {
      code: codeRecord?.code || '',
      trialDays: clampTrialDays(codeRecord?.trialDays),
      activationsCount: activations.length,
      completedRecountsTotal
    };
  }

  function enrichUserRecord(user) {
    const target = user && typeof user === 'object' ? user : {};
    target.securityRole = Boolean(target.securityRole);
    target.referralUsedAt = target.referralUsedAt ? String(target.referralUsedAt) : null;
    target.referralActivationId = target.referralActivationId ? String(target.referralActivationId) : null;
    return target;
  }

  function enrichPublicUser(user) {
    const activeCode = getActiveCodeByOwner(user.id);
    return {
      securityRole: Boolean(user.securityRole),
      role: user.securityRole ? 'security' : 'user',
      referralUsedAt: user.referralUsedAt || null,
      referralActivationId: user.referralActivationId || null,
      referralCode: activeCode?.code || '',
      referralTrialDays: activeCode?.trialDays || null
    };
  }

  async function setSecurityRole({ actor, targetUser, enabled, requestMeta = {} }) {
    ensureReferralState();
    const nextEnabled = Boolean(enabled);
    targetUser.securityRole = nextEnabled;

    if (!nextEnabled) {
      const activeCode = getActiveCodeByOwner(targetUser.id);
      if (activeCode) {
        activeCode.revokedAt = toIsoNow();
        activeCode.revokeReason = 'security-role-removed';
      }
    }

    await saveDb();
    logEvent('warn', nextEnabled ? 'admin-security-role-enabled' : 'admin-security-role-disabled', {
      ...requestMeta,
      actorId: actor?.id || null,
      actorLogin: actor?.login || null,
      targetUserId: targetUser.id,
      targetLogin: targetUser.login
    });

    return targetUser;
  }

  async function issueCode({ actor, targetUser, trialDays, regenerate, requestMeta = {} }) {
    ensureReferralState();
    if (!targetUser.securityRole) {
      const error = new Error('Роль СБ не назначена пользователю');
      error.statusCode = 400;
      error.code = 'SECURITY_ROLE_REQUIRED';
      throw error;
    }

    const normalizedTrialDays = clampTrialDays(trialDays);
    const now = toIsoNow();
    const current = getActiveCodeByOwner(targetUser.id);

    if (current && !regenerate) {
      current.trialDays = normalizedTrialDays;
      current.updatedAt = now;
      await saveDb();
      logEvent('warn', 'admin-referral-code-updated', {
        ...requestMeta,
        actorId: actor?.id || null,
        actorLogin: actor?.login || null,
        targetUserId: targetUser.id,
        targetLogin: targetUser.login,
        trialDays: normalizedTrialDays,
        referralCodeMask: maskReferralCode(current.code)
      });
      return current;
    }

    if (current && regenerate) {
      current.revokedAt = now;
      current.revokeReason = 'regenerated';
    }

    const nextCode = {
      id: createId('refcode'),
      ownerUserId: targetUser.id,
      code: buildCode(),
      trialDays: normalizedTrialDays,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      revokeReason: null,
      expiresAt: null
    };

    db.referrals.codes.push(nextCode);
    await saveDb();
    logEvent('warn', regenerate ? 'admin-referral-code-regenerated' : 'admin-referral-code-issued', {
      ...requestMeta,
      actorId: actor?.id || null,
      actorLogin: actor?.login || null,
      targetUserId: targetUser.id,
      targetLogin: targetUser.login,
      trialDays: normalizedTrialDays,
      referralCodeMask: maskReferralCode(nextCode.code)
    });

    return nextCode;
  }

  function resolveCodeForActivation(rawCode) {
    ensureReferralState();
    const normalized = normalizeReferralCode(rawCode);
    if (!normalized || normalized.length < REFERRAL_CODE_MIN_LENGTH) {
      return { status: 'invalid', normalizedCode: normalized, codeRecord: null };
    }

    const exact = findCodeRecord(normalized);
    if (!exact) return { status: 'invalid', normalizedCode: normalized, codeRecord: null };
    if (exact.revokedAt) return { status: 'revoked', normalizedCode: normalized, codeRecord: exact };

    if (exact.expiresAt) {
      const expiresTs = Date.parse(String(exact.expiresAt));
      if (!Number.isNaN(expiresTs) && expiresTs < Date.now()) {
        return { status: 'expired', normalizedCode: normalized, codeRecord: exact };
      }
    }

    return { status: 'active', normalizedCode: normalized, codeRecord: exact };
  }

  function buildAlreadyAppliedResponse(user) {
    return {
      ok: true,
      alreadyApplied: true,
      user: usersService.publicUser(user),
      activation: {
        status: 'already-applied',
        activatedAt: user.referralUsedAt || null,
        trialUntil: user.subscriptionUntil || null
      }
    };
  }

  async function activateCode({ user, rawCode, ip, source = 'manual', requestMeta = {} }) {
    ensureReferralState();
    enrichUserRecord(user);
    const normalizedCode = normalizeReferralCode(rawCode);
    const identity = { userId: user.id, ip };

    if (isRateLimited(identity)) {
      logEvent('warn', 'referral-activation-rate-limited', {
        ...requestMeta,
        actorId: user.id,
        actorLogin: user.login,
        referralCodeMask: maskReferralCode(normalizedCode),
        activationSource: source
      });
      const error = new Error('Слишком много попыток. Попробуйте позже.');
      error.statusCode = 429;
      error.code = 'REFERRAL_RATE_LIMIT';
      throw error;
    }

    if (user.referralActivationId || user.referralUsedAt) {
      logEvent('info', 'referral-activation-idempotent', {
        ...requestMeta,
        actorId: user.id,
        actorLogin: user.login,
        activationSource: source
      });
      return buildAlreadyAppliedResponse(user);
    }

    if (usersService.hasActiveSubscription(user)) {
      const error = new Error('Подписка уже активна');
      error.statusCode = 409;
      error.code = 'REFERRAL_SUBSCRIPTION_ACTIVE';
      throw error;
    }

    const resolution = resolveCodeForActivation(normalizedCode);
    if (resolution.status !== 'active') {
      registerFailedAttempt(identity);
      const mappedCode = resolution.status === 'revoked'
        ? 'REFERRAL_REVOKED'
        : resolution.status === 'expired'
          ? 'REFERRAL_EXPIRED'
          : 'REFERRAL_INVALID';
      logEvent('warn', 'referral-activation-failed', {
        ...requestMeta,
        actorId: user.id,
        actorLogin: user.login,
        referralCodeMask: maskReferralCode(normalizedCode),
        activationSource: source,
        reason: mappedCode
      });
      const error = new Error('Код недействителен или недоступен.');
      error.statusCode = mappedCode === 'REFERRAL_INVALID' ? 404 : 409;
      error.code = mappedCode;
      throw error;
    }

    const codeRecord = resolution.codeRecord;
    if (codeRecord.ownerUserId === user.id) {
      registerFailedAttempt(identity);
      logEvent('warn', 'referral-activation-self-code-blocked', {
        ...requestMeta,
        actorId: user.id,
        actorLogin: user.login,
        referralCodeMask: maskReferralCode(codeRecord.code),
        activationSource: source
      });
      const error = new Error('Код недействителен или недоступен.');
      error.statusCode = 404;
      error.code = 'REFERRAL_INVALID';
      throw error;
    }

    const owner = db.users.find(item => item.id === codeRecord.ownerUserId);
    if (!owner || !owner.securityRole) {
      registerFailedAttempt(identity);
      logEvent('warn', 'referral-activation-owner-invalid', {
        ...requestMeta,
        actorId: user.id,
        actorLogin: user.login,
        ownerUserId: codeRecord.ownerUserId,
        referralCodeMask: maskReferralCode(codeRecord.code),
        activationSource: source
      });
      const error = new Error('Код недействителен или недоступен.');
      error.statusCode = 404;
      error.code = 'REFERRAL_INVALID';
      throw error;
    }

    const activatedAt = toIsoNow();
    const trialDays = clampTrialDays(codeRecord.trialDays);
    const trialUntil = new Date(Date.parse(activatedAt) + trialDays * 24 * 60 * 60 * 1000).toISOString();
    const activation = {
      id: createId('refact'),
      codeId: codeRecord.id,
      ownerUserId: codeRecord.ownerUserId,
      activatedUserId: user.id,
      activatedAt,
      trialDays,
      trialUntil,
      source: String(source || 'manual'),
      ip: String(ip || '').trim() || null
    };

    db.referrals.activations.push(activation);
    user.subscriptionUntil = trialUntil;
    user.referralUsedAt = activatedAt;
    user.referralActivationId = activation.id;

    await saveDb();
    clearFailedAttempts(identity);

    logEvent('info', 'referral-activation-success', {
      ...requestMeta,
      actorId: user.id,
      actorLogin: user.login,
      ownerUserId: owner.id,
      ownerLogin: owner.login,
      referralCodeMask: maskReferralCode(codeRecord.code),
      activationSource: source,
      trialDays,
      trialUntil
    });
    telegramLogService?.notifyReferralActivation({
      user,
      owner,
      activation,
      referralCodeMask: maskReferralCode(codeRecord.code)
    });

    return {
      ok: true,
      alreadyApplied: false,
      user: usersService.publicUser(user),
      activation: {
        status: 'applied',
        activatedAt,
        trialDays,
        trialUntil
      }
    };
  }

  return {
    ensureReferralState,
    normalizeReferralCode,
    maskReferralCode,
    clampTrialDays,
    enrichUserRecord,
    enrichPublicUser,
    setSecurityRole,
    issueCode,
    activateCode,
    buildSecurityUserReferralStats
  };
}
