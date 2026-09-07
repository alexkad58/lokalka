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
      subscriptionUntil: null,
      deviceId: null
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
      subscriptionUntil: user.subscriptionUntil || null,
      subscriptionActive: hasActiveSubscription(user),
      deviceBound: Boolean(user.deviceId),
      deviceBindingDisabled: Boolean(user.deviceBindingDisabled),
      defaultCounterName: user.defaultCounterName || ''
    };
  }

  return {
    ensureAdminUser,
    hasActiveSubscription,
    buildSubscriptionStatus,
    publicUser
  };
}
