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
  sessions,
  getSupportLinks,
  referralService
}) {
  function normalizeSupportUrl(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('@')) return `https://t.me/${raw.slice(1)}`;
    if (raw.startsWith('t.me/')) return `https://${raw}`;
    return fallback;
  }

  return async function adminRoutes(app) {
    app.get('/api/admin/users', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      users: db.users
        .slice()
        .sort((a, b) => a.login.localeCompare(b.login))
        .map(user => {
          const status = buildSubscriptionStatus(user);
          const referral = referralService.enrichPublicUser(user);
          return {
            id: user.id,
            login: user.login,
            createdAt: user.createdAt,
            isAdmin: Boolean(user.isAdmin),
            securityRole: referral.securityRole,
            role: referral.role,
            subscriptionUntil: user.subscriptionUntil || null,
            subscriptionActive: hasActiveSubscription(user),
            deviceBound: Boolean(user.deviceId),
            deviceBindingDisabled: Boolean(user.deviceBindingDisabled),
            referralUsedAt: referral.referralUsedAt,
            referralActivationId: referral.referralActivationId,
            referralCode: referral.referralCode,
            referralTrialDays: referral.referralTrialDays,
            subscriptionStatusKey: status.key,
            subscriptionStatusLabel: status.label
          };
        })
    }));

    app.post('/api/admin/users/:id/security-role', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const target = db.users.find(user => user.id === id);
      if (!target) return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
      if (target.isAdmin) return reply.code(400).send({ ok: false, error: 'Нельзя назначить роль СБ администратору' });

      const enabled = Boolean(body.enabled);
      await referralService.setSecurityRole({
        actor: request.user,
        targetUser: target,
        enabled,
        requestMeta: buildRequestLogMeta(request)
      });
      return { ok: true, user: publicUser(target) };
    });

    app.post('/api/admin/users/:id/referral-code', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const { id } = request.params;
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const target = db.users.find(user => user.id === id);
      if (!target) return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
      if (target.isAdmin) return reply.code(400).send({ ok: false, error: 'Для администратора код не требуется' });

      try {
        const codeRecord = await referralService.issueCode({
          actor: request.user,
          targetUser: target,
          trialDays: body.trialDays,
          regenerate: Boolean(body.regenerate),
          requestMeta: buildRequestLogMeta(request)
        });
        return {
          ok: true,
          referral: {
            code: codeRecord.code,
            trialDays: codeRecord.trialDays,
            revokedAt: codeRecord.revokedAt || null
          },
          user: publicUser(target)
        };
      } catch (error) {
        return reply.code(Number(error?.statusCode) || 400).send({
          ok: false,
          code: error?.code || undefined,
          error: error?.message || 'Не удалось выдать код приглашения'
        });
      }
    });

    app.get('/api/admin/shop-api', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      configured: Boolean(tokenState.accessToken),
      tokenLast5: shopApiService.lastTokenChars(tokenState.accessToken),
      tokenUpdatedAt: tokenState.updatedAt
    }));

    app.get('/api/admin/barcode-cache', { preHandler: [authenticate, requireAdmin] }, async request => {
      const query = request.query && typeof request.query === 'object' ? request.query : {};
      const filter = String(query.filter || 'all').trim();
      const page = Number.parseInt(String(query.page || '1'), 10);
      const limit = Number.parseInt(String(query.limit || '12'), 10);
      return { ok: true, ...(shopApiService.buildCodebookEntries({ filter, page, limit })) };
    });

    app.patch('/api/admin/barcode-cache/:code', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const code = String(request.params?.code || '').trim();
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      if (!code || !Array.isArray(body.barcodes)) {
        return reply.code(400).send({ ok: false, error: 'Код и массив штрихкодов обязательны' });
      }
      return { ok: true, ...shopApiService.updateCodebookEntry(code, body.barcodes) };
    });

    app.delete('/api/admin/barcode-cache/:code', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const code = String(request.params?.code || '').trim();
      if (!code) return reply.code(400).send({ ok: false, error: 'Не указан код товара' });
      return { ok: true, ...shopApiService.deleteCodebookEntry(code) };
    });

    app.get('/api/admin/products/:code', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const code = String(request.params?.code || '').trim();
      const storeNumber = String(request.query?.storeNumber || request.query?.shop_id || '').trim();
      if (!code) {
        return reply.code(400).send({ ok: false, error: 'Не указан код товара' });
      }

      const result = await shopApiService.fetchProductByArticle(code, storeNumber);
      if (!result.ok) {
        return reply.code(Number(result.status) || 502).send({
          ok: false,
          error: result.error?.message || 'Не удалось получить товар по артикулу',
          details: result.error || null
        });
      }

      return {
        ok: true,
        product: result.product,
        payload: result.payload,
        articleCode: result.articleCode,
        source: result.source
      };
    });

    app.get('/api/admin/contact-links', { preHandler: [authenticate, requireAdmin] }, async () => ({
      ok: true,
      links: getSupportLinks()
    }));

    app.post('/api/admin/contact-links', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const current = getSupportLinks();
      const next = {
        telegramUrl: normalizeSupportUrl(body.telegramUrl, current.telegramUrl),
        maxUrl: normalizeSupportUrl(body.maxUrl, current.maxUrl)
      };

      db.settings.contactLinks = next;
      await saveDb();
      logEvent('info', 'admin-contact-links-updated', buildRequestLogMeta(request, {
        telegramUrl: next.telegramUrl,
        maxUrl: next.maxUrl
      }));

      return { ok: true, links: next };
    });

    app.post('/api/admin/shop-api', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const token = String(body.token || '').trim().replace(/^Bearer\s+/i, '').trim();
      const refreshToken = String(body.refreshToken || '').trim();
      if (!token) return reply.code(400).send({ ok: false, error: 'Укажите токен API магазина' });

      tokenState.accessToken = token;
      if (refreshToken) tokenState.refreshToken = refreshToken;
      tokenState.updatedAt = Date.now();
      db.settings.shopApiAccessToken = token;
      if (refreshToken) db.settings.shopApiRefreshToken = refreshToken;
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
      return { ok: true, ...getLogs(query.level, query.limit, query.group, query.users) };
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
      if (db.referrals?.codes) {
        const now = new Date().toISOString();
        for (const code of db.referrals.codes) {
          if (code.ownerUserId === target.id && !code.revokedAt) {
            code.revokedAt = now;
            code.revokeReason = 'owner-deleted';
          }
        }
      }
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
