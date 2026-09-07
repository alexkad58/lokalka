export function createAccountRoutes({ authenticate, saveDb, logEvent, buildRequestLogMeta, publicUser }) {
  return async function accountRoutes(app) {
    app.post('/api/account/settings', { preHandler: authenticate }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};

      if (typeof body.defaultCounterName === 'string') {
        request.user.defaultCounterName = body.defaultCounterName.trim().slice(0, 120);
      }

      await saveDb();
      logEvent('info', 'account-settings-updated', buildRequestLogMeta(request, {
        defaultCounterName: request.user.defaultCounterName || null
      }));

      return {
        ok: true,
        user: publicUser(request.user)
      };
    });
  };
}
