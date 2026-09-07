export function createAuthMiddleware({
  db,
  sessionManager,
  usersService,
  getDeviceIdFromRequest,
  getRequestIp,
  logEvent,
  buildRequestLogMeta
}) {
  function getTokenFromRequest(request) {
    const raw = String(request.headers.authorization || '').trim();
    if (!raw.toLowerCase().startsWith('bearer ')) return '';
    return raw.slice(7).trim();
  }

  async function authenticate(request, reply) {
    const token = getTokenFromRequest(request);
    const requestDeviceId = getDeviceIdFromRequest(request);
    const session = sessionManager.get(token);

    if (session) {
      const expiresTs = Date.parse(String(session.expiresAt || ''));
      if (Number.isNaN(expiresTs) || expiresTs <= Date.now()) {
        await sessionManager.revokeByToken(token);
        logEvent('warn', 'session-expired', {
          method: request.method,
          path: request.url,
          ip: getRequestIp(request)
        });
        reply.code(401).send({ ok: false, error: 'Сессия истекла. Войдите снова.' });
        return;
      }
    }

    const user = session?.userId
      ? db.users.find(item => item.id === session.userId)
      : null;

    if (!user) {
      logEvent('warn', 'auth-required', {
        method: request.method,
        path: request.url,
        ip: getRequestIp(request)
      });
      reply.code(401).send({ ok: false, error: 'Требуется авторизация' });
      return;
    }

    if (user.isAdmin) {
      request.authToken = token;
      request.user = user;
      return;
    }

    if (!requestDeviceId) {
      logEvent('warn', 'device-id-required', {
        method: request.method,
        path: request.url,
        actorId: user.id,
        actorLogin: user.login,
        ip: getRequestIp(request)
      });
      reply.code(401).send({
        ok: false,
        code: 'DEVICE_ID_REQUIRED',
        error: 'Не удалось определить устройство. Обновите приложение.'
      });
      return;
    }

    const deviceBindingDisabled = Boolean(user.deviceBindingDisabled);

    if (!deviceBindingDisabled && user.deviceId && user.deviceId !== requestDeviceId) {
      logEvent('warn', 'device-mismatch-auth', {
        method: request.method,
        path: request.url,
        actorId: user.id,
        actorLogin: user.login,
        expectedDeviceId: user.deviceId,
        gotDeviceId: requestDeviceId,
        ip: getRequestIp(request)
      });
      reply.code(403).send({
        ok: false,
        code: 'DEVICE_MISMATCH',
        error: 'Аккаунт привязан к другому устройству. Обратитесь в Telegram: https://t.me/alekseikb58'
      });
      return;
    }

    if (!deviceBindingDisabled && session?.deviceId && session.deviceId !== requestDeviceId) {
      logEvent('warn', 'session-device-mismatch', {
        method: request.method,
        path: request.url,
        actorId: user.id,
        actorLogin: user.login,
        sessionDeviceId: session.deviceId,
        gotDeviceId: requestDeviceId,
        ip: getRequestIp(request)
      });
      reply.code(401).send({
        ok: false,
        code: 'SESSION_DEVICE_MISMATCH',
        error: 'Сессия недействительна для этого устройства. Войдите снова.'
      });
      return;
    }

    if (!user.deviceId || deviceBindingDisabled) {
      user.deviceId = requestDeviceId;
      await sessionManager.updateDevice(token, requestDeviceId);

      logEvent('info', 'device-bound-on-auth', {
        actorId: user.id,
        actorLogin: user.login,
        deviceId: requestDeviceId,
        deviceBindingDisabled,
        ip: getRequestIp(request)
      });
    }

    request.authToken = token;
    request.user = user;
  }

  async function requireServiceAccess(request, reply) {
    if (request.user?.isAdmin) return;
    if (usersService.hasActiveSubscription(request.user)) return;

    logEvent('warn', 'service-access-denied', buildRequestLogMeta(request, {
      subscriptionUntil: request.user?.subscriptionUntil || null
    }));

    reply.code(403).send({
      ok: false,
      code: 'SUBSCRIPTION_REQUIRED',
      error: 'Подписка не активна. Обратитесь в Telegram: https://t.me/alekseikb58'
    });
  }

  async function requireAdmin(request, reply) {
    if (request.user?.isAdmin) return;
    logEvent('warn', 'admin-access-denied', buildRequestLogMeta(request));
    reply.code(403).send({ ok: false, error: 'Доступ только для администратора' });
  }

  return { getTokenFromRequest, authenticate, requireServiceAccess, requireAdmin };
}
