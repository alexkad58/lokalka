export function createReferralRoutes({
  authenticate,
  referralService,
  getRequestIp,
  buildRequestLogMeta,
  logEvent
}) {
  return async function referralRoutes(app) {
    app.get('/api/referrals/me', { preHandler: authenticate }, async (request, reply) => {
      if (!request.user?.securityRole) {
        logEvent('warn', 'referral-stats-access-denied', buildRequestLogMeta(request));
        return reply.code(403).send({ ok: false, error: 'Доступ только для роли СБ' });
      }

      const referral = referralService.buildSecurityUserReferralStats(request.user.id);
      return { ok: true, referral };
    });

    app.post('/api/referrals/activate', { preHandler: authenticate }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const rawCode = body.code;
      const source = String(body.source || 'manual').trim() || 'manual';

      try {
        const result = await referralService.activateCode({
          user: request.user,
          rawCode,
          ip: getRequestIp(request),
          source,
          requestMeta: buildRequestLogMeta(request)
        });
        return result;
      } catch (error) {
        const statusCode = Number(error?.statusCode) || 400;
        const errorCode = String(error?.code || '').trim();
        return reply.code(statusCode).send({
          ok: false,
          code: errorCode || undefined,
          error: error?.message || 'Не удалось активировать код приглашения'
        });
      }
    });
  };
}
