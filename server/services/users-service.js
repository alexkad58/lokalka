export function createUsersService({
  db,
  adminLogin,
  adminPassword,
  hashPassword,
  verifyPassword,
  normalizeLogin,
  createId,
  toIsoNow,
  formatRuDate
}) {
  const defaultSupportLinks = {
    telegramUrl: 'https://t.me/alekseikb58',
    maxUrl: 'https://www.max.ru/'
  };

  function normalizeSupportLink(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;

    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('@')) return `https://t.me/${raw.slice(1)}`;
    if (raw.startsWith('t.me/')) return `https://${raw}`;
    if (raw.startsWith('https://t.me/')) return raw;
    if (raw.startsWith('http://t.me/')) return raw.replace(/^http:\/\//i, 'https://');

    return fallback;
  }

  function getSupportLinks() {
    const stored = db.settings?.contactLinks && typeof db.settings.contactLinks === 'object' ? db.settings.contactLinks : {};
    return {
      telegramUrl: normalizeSupportLink(stored.telegramUrl, defaultSupportLinks.telegramUrl),
      maxUrl: normalizeSupportLink(stored.maxUrl, defaultSupportLinks.maxUrl)
    };
  }

  function ensureAdminUser() {
    const existing = db.users.find(user => normalizeLogin(user.login) === adminLogin);
    if (existing) {
      let changed = false;

      if (normalizeLogin(existing.login) !== adminLogin) {
        existing.login = adminLogin;
        changed = true;
      }

      if (!existing.isAdmin) {
        existing.isAdmin = true;
        changed = true;
      }

      if (!verifyPassword(adminPassword, existing.passwordHash)) {
        existing.passwordHash = hashPassword(adminPassword);
        changed = true;
      }

      return changed;
    }

    db.users.push({
      id: createId('u'),
      login: adminLogin,
      passwordHash: hashPassword(adminPassword),
      createdAt: toIsoNow(),
      isAdmin: true,
      securityRole: false,
      subscriptionUntil: null,
      deviceId: null,
      referralUsedAt: null,
      referralActivationId: null
    });
    return true;
  }

  function hasActiveSubscription(user) {
    if (user?.isAdmin) return true;
    const rawUntil = user?.subscriptionUntil;
    if (!rawUntil) return false;
    const untilTs = Date.parse(String(rawUntil));
    if (Number.isNaN(untilTs)) return false;
    return untilTs >= Date.now();
  }

  function buildSubscriptionStatus(user) {
    if (user?.isAdmin) {
      return { key: 'admin', label: 'администратор' };
    }

    if (!hasActiveSubscription(user) || !user?.subscriptionUntil) {
      return { key: 'inactive', label: 'неактивный' };
    }

    return {
      key: 'active',
      label: `активный до ${formatRuDate(user.subscriptionUntil)}`
    };
  }

  function publicUser(user) {
    return {
      id: user.id,
      login: user.login,
      createdAt: user.createdAt,
      isAdmin: Boolean(user.isAdmin),
      securityRole: Boolean(user.securityRole),
      role: user.securityRole ? 'security' : 'user',
      subscriptionUntil: user.subscriptionUntil || null,
      subscriptionActive: hasActiveSubscription(user),
      deviceBound: Boolean(user.deviceId),
      deviceBindingDisabled: Boolean(user.deviceBindingDisabled),
      defaultCounterName: user.defaultCounterName || '',
      referralUsedAt: user.referralUsedAt || null,
      referralActivationId: user.referralActivationId || null,
      supportLinks: getSupportLinks()
    };
  }

  return {
    ensureAdminUser,
    hasActiveSubscription,
    buildSubscriptionStatus,
    publicUser,
    getSupportLinks
  };
}
