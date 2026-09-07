export function createAuthRoutes({
  db,
  normalizeLogin,
  getDeviceIdFromRequest,
  getRequestIp,
  logEvent,
  createId,
  hashPassword,
  verifyPassword,
  toIsoNow,
  saveDb,
  sessionManager,
  tokenStorageKey,
  publicUser,
  authenticate,
  buildRequestLogMeta
}) {
  return async function authRoutes(app) {
    app.post('/api/auth/register', async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const login = normalizeLogin(body.login);
      const password = String(body.password || '');
      const deviceId = getDeviceIdFromRequest(request);

      if (!deviceId) {
        return reply.code(400).send({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'Не удалось определить устройство. Обновите приложение.' });
      }
      if (login.length < 3) {
        logEvent('warn', 'register-invalid-login', { login, loginLength: login.length, ip: getRequestIp(request) });
        return reply.code(400).send({ ok: false, error: 'Логин должен быть не короче 3 символов' });
      }
      if (password.length < 4) {
        logEvent('warn', 'register-invalid-password', { login, passwordLength: password.length, ip: getRequestIp(request) });
        return reply.code(400).send({ ok: false, error: 'Пароль должен быть не короче 4 символов' });
      }
      if (db.users.some(user => user.login === login)) {
        logEvent('warn', 'register-duplicate-login', { login, ip: getRequestIp(request) });
        return reply.code(409).send({ ok: false, error: 'Пользователь уже существует' });
      }

      const user = {
        id: createId('u'),
        login,
        passwordHash: hashPassword(password),
        createdAt: toIsoNow(),
        isAdmin: false,
        subscriptionUntil: null,
        deviceId,
        deviceBindingDisabled: false
      };
      db.users.push(user);
      await saveDb();
      logEvent('info', 'register-success', { login: user.login, userId: user.id, ip: getRequestIp(request) });

      const token = await sessionManager.createForUser(user, request);
      return { ok: true, token, tokenType: tokenStorageKey, user: publicUser(user) };
    });

    app.post('/api/auth/login', async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const login = normalizeLogin(body.login);
      const password = String(body.password || '');
      const deviceId = getDeviceIdFromRequest(request);
      const user = db.users.find(item => item.login === login);

      if (!deviceId) {
        return reply.code(400).send({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'Не удалось определить устройство. Обновите приложение.' });
      }
      if (!user || !verifyPassword(password, user.passwordHash)) {
        logEvent('warn', 'login-failed', { login, ip: getRequestIp(request) });
        return reply.code(401).send({ ok: false, error: 'Неверный логин или пароль' });
      }

      if (!user.isAdmin && !user.deviceBindingDisabled && user.deviceId && user.deviceId !== deviceId) {
        logEvent('warn', 'login-device-mismatch', { actorId: user.id, actorLogin: user.login, expectedDeviceId: user.deviceId, gotDeviceId: deviceId, ip: getRequestIp(request) });
        return reply.code(403).send({ ok: false, code: 'DEVICE_MISMATCH', error: 'Аккаунт уже привязан к другому устройству. Обратитесь в Telegram: https://t.me/alekseikb58' });
      }

      if (!user.isAdmin && (!user.deviceId || user.deviceBindingDisabled)) {
        user.deviceId = deviceId;
        await saveDb();
        logEvent('info', 'device-bound-on-login', { actorId: user.id, actorLogin: user.login, deviceId, deviceBindingDisabled: Boolean(user.deviceBindingDisabled), ip: getRequestIp(request) });
      }

      const token = await sessionManager.createForUser(user, request);
      logEvent('info', 'login-success', { actorId: user.id, actorLogin: user.login, actorIsAdmin: Boolean(user.isAdmin), ip: getRequestIp(request) });
      return { ok: true, token, tokenType: tokenStorageKey, user: publicUser(user) };
    });

    app.get('/api/auth/me', { preHandler: authenticate }, async request => ({
      ok: true,
      user: publicUser(request.user)
    }));

    app.post('/api/auth/logout', { preHandler: authenticate }, async request => {
      logEvent('info', 'logout', buildRequestLogMeta(request));
      if (request.authToken) await sessionManager.revokeByToken(request.authToken);
      return { ok: true };
    });
  };
}
