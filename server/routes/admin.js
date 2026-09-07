export function createAdminRoutes({
  db,
  authenticate,
  requireAdmin,
  publicUser,
  buildSubscriptionStatus,
  hasActiveSubscription,
  saveDb,
  logEvent,
  buildRequestLogMeta,
  getLogs,
  tokenState,
  shopApiService,
  sessions
}) {
  return async function adminRoutes(app) {
    app.get('/api/admin/users', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      users: db.users
        .slice()
        .sort((a, b) => a.login.localeCompare(b.login))
        .map(user => {
          const status = buildSubscriptionStatus(user);
          return {
            id: user.id,
            login: user.login,
            createdAt: user.createdAt,
            isAdmin: Boolean(user.isAdmin),
            subscriptionUntil: user.subscriptionUntil || null,
            subscriptionActive: hasActiveSubscription(user),
            deviceBound: Boolean(user.deviceId),
            deviceBindingDisabled: Boolean(user.deviceBindingDisabled),
            subscriptionStatusKey: status.key,
            subscriptionStatusLabel: status.label
          };
        })
    }));

    app.get('/api/admin/shop-api', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      configured: Boolean(tokenState.accessToken),
      tokenLast5: shopApiService.lastTokenChars(tokenState.accessToken),
      tokenUpdatedAt: tokenState.updatedAt
    }));

    app.post('/api/admin/shop-api', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const token = String(body.token || '').trim();
      if (!token) return reply.code(400).send({ ok: false, error: 'Укажите токен API магазина' });

      tokenState.accessToken = token;
      tokenState.updatedAt = Date.now();
      db.settings.shopApiAccessToken = token;
      await saveDb();
      logEvent('warn', 'admin-shop-api-token-updated', buildRequestLogMeta(request, {
        tokenLast5: shopApiService.lastTokenChars(token)
      }));

      return {
        ok: true,
        configured: true,
        tokenLast5: shopApiService.lastTokenChars(token),
        tokenUpdatedAt: tokenState.updatedAt
      };
    });

    app.get('/api/admin/logs', { preHandler: [authenticate, requireAdmin] }, async request => {
      const query = request.query && typeof request.query === 'object' ? request.query : {};
      return { ok: true, ...getLogs(query.level, query.limit) };
    });

    app.post('/api/admin/users/:id/subscription', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const target = db.users.find(user => user.id === id);
      if (!target) {
        logEvent('warn', 'subscription-activate-user-not-found', buildRequestLogMeta(request, { targetUserId: id }));
        return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
      }
      if (target.isAdmin) {
        logEvent('warn', 'subscription-activate-admin-blocked', buildRequestLogMeta(request, { targetUserId: id, targetLogin: target.login }));
        return reply.code(400).send({ ok: false, error: 'Подписка для администратора не требуется' });
      }

      let nextUntil = null;
      if (typeof body.until === 'string' && body.until.trim()) {
        const parsedTs = Date.parse(body.until);
        if (Number.isNaN(parsedTs)) {
          logEvent('warn', 'subscription-activate-invalid-date', buildRequestLogMeta(request, { targetUserId: id, until: body.until }));
          return reply.code(400).send({ ok: false, error: 'Некорректная дата подписки' });
        }
        nextUntil = new Date(parsedTs).toISOString();
      } else {
        const daysRaw = Number.parseInt(String(body.days ?? 30), 10);
        const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 3650)) : 30;
        nextUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      }

      target.subscriptionUntil = nextUntil;
      await saveDb();
      logEvent('info', 'subscription-activated', buildRequestLogMeta(request, { targetUserId: target.id, targetLogin: target.login, subscriptionUntil: nextUntil }));
      const status = buildSubscriptionStatus(target);
      return {
        ok: true,
        user: {
          id: target.id,
          login: target.login,
          createdAt: target.createdAt,
          isAdmin: Boolean(target.isAdmin),
          subscriptionUntil: target.subscriptionUntil,
          subscriptionActive: hasActiveSubscription(target),
          subscriptionStatusKey: status.key,
          subscriptionStatusLabel: status.label
        }
      };
    });

    app.post('/api/admin/users/:id/device/reset', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const target = db.users.find(user => user.id === id);
      if (!target) return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });

      target.deviceId = null;
      const removedTokens = [];
      for (const [token, session] of sessions.entries()) {
        if (session?.userId === target.id) {
          removedTokens.push(token);
          sessions.delete(token);
        }
      }
      db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).filter(session => session.userId !== target.id);
      await saveDb();
      logEvent('warn', 'admin-reset-device-binding', buildRequestLogMeta(request, { targetUserId: target.id, targetLogin: target.login, removedSessions: removedTokens.length }));
      return { ok: true, user: publicUser(target) };
    });

    app.post('/api/admin/users/:id/device-binding', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const target = db.users.find(user => user.id === id);
      if (!target) return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
      const disabled = Boolean(body.disabled);
      target.deviceBindingDisabled = disabled;
      await saveDb();
      logEvent('warn', disabled ? 'admin-device-binding-disabled' : 'admin-device-binding-enabled', buildRequestLogMeta(request, { targetUserId: target.id, targetLogin: target.login, deviceBindingDisabled: disabled }));
      return { ok: true, user: publicUser(target) };
    });

    app.delete('/api/admin/users/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const target = db.users.find(user => user.id === id);
      if (!target) return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
      if (target.isAdmin) {
        logEvent('warn', 'admin-delete-user-blocked', buildRequestLogMeta(request, { targetUserId: id }));
        return reply.code(400).send({ ok: false, error: 'Нельзя удалить администратора' });
      }

      db.users = db.users.filter(user => user.id !== target.id);
      db.recounts = db.recounts.filter(item => item.userId !== target.id);
      for (const [token, session] of sessions.entries()) {
        if (session?.userId === target.id) sessions.delete(token);
      }
      db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).filter(session => session.userId !== target.id);
      await saveDb();
      logEvent('warn', 'admin-delete-user-success', buildRequestLogMeta(request, { targetUserId: target.id, targetLogin: target.login }));
      return { ok: true };
    });
  };
}
