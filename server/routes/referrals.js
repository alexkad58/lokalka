export function createReferralRoutes({
  authenticate,
  referralService,
  getRequestIp,
  buildRequestLogMeta,
  logEvent,
  shopApiService
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

    app.get('/api/referrals/barcode-cache', { preHandler: authenticate }, async (request, reply) => {
      if (!request.user?.securityRole) {
        logEvent('warn', 'barcode-cache-access-denied', buildRequestLogMeta(request));
        return reply.code(403).send({ ok: false, error: 'Доступ только для роли СБ' });
      }

      const query = request.query && typeof request.query === 'object' ? request.query : {};
      const filter = String(query.filter || 'all').trim();
      const page = Number.parseInt(String(query.page || '1'), 10);
      const limit = Number.parseInt(String(query.limit || '12'), 10);
      return { ok: true, ...(shopApiService.buildCodebookEntries({ filter, page, limit })) };
    });

    app.patch('/api/referrals/barcode-cache/:code', { preHandler: authenticate }, async (request, reply) => {
      if (!request.user?.securityRole) return reply.code(403).send({ ok: false, error: 'Доступ только для роли СБ' });
      const code = String(request.params?.code || '').trim();
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      if (!code || !Array.isArray(body.barcodes)) {
        return reply.code(400).send({ ok: false, error: 'Код и массив штрихкодов обязательны' });
      }
      return { ok: true, ...shopApiService.updateCodebookEntry(code, body.barcodes) };
    });

    app.delete('/api/referrals/barcode-cache/:code', { preHandler: authenticate }, async (request, reply) => {
      if (!request.user?.securityRole) return reply.code(403).send({ ok: false, error: 'Доступ только для роли СБ' });
      const code = String(request.params?.code || '').trim();
      if (!code) return reply.code(400).send({ ok: false, error: 'Не указан код товара' });
      return { ok: true, ...shopApiService.deleteCodebookEntry(code) };
    });

    app.get('/api/referrals/products/:code', { preHandler: authenticate }, async (request, reply) => {
      if (!request.user?.securityRole) {
        logEvent('warn', 'barcode-product-access-denied', buildRequestLogMeta(request));
        return reply.code(403).send({ ok: false, error: 'Доступ только для роли СБ' });
      }

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
