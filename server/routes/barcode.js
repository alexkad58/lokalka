export function createBarcodeRoutes({
  authenticate,
  requireServiceAccess,
  db,
  shopApiService,
  shopApiUrl,
  shopApiTokenState,
  shopIdFallback,
  logEvent,
  logShopStdout,
  buildRequestLogMeta
}) {
  return async function barcodeRoutes(app) {
    app.post('/api/recount/bind-barcode', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const barcode = String(body.barcode || '').trim();
      const itemCode = String(body.itemCode || body.code || '').trim();
      const recount = body.recountId
        ? db.recounts.find(item => item.id === String(body.recountId) && item.userId === request.user.id)
        : null;
      const storeNumber = String(recount?.storeNumber || shopIdFallback || '').trim();

      if (!barcode || !itemCode) {
        return reply.code(400).send({ ok: false, error: 'barcode and itemCode are required' });
      }
      if (!recount) {
        return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
      }
      if (!recount.items.some(item => String(item.code) === itemCode)) {
        return reply.code(400).send({ ok: false, error: 'Код товара отсутствует в просчете' });
      }

      const existingBarcodes = shopApiService.findBarcodesForCode(itemCode, barcode);
      if (existingBarcodes.length && body.confirm !== true) {
        logEvent('info', 'bind-barcode-conflict', buildRequestLogMeta(request, {
          barcode,
          itemCode,
          existingBarcodes
        }));
        return reply.code(409).send({
          ok: false,
          conflict: true,
          barcode,
          itemCode,
          existingBarcodes,
          error: `Код товара уже привязан к штрихкоду ${existingBarcodes.join(', ')}`
        });
      }

      const result = shopApiService.reassignResolutionCode(barcode, itemCode, 'manual', storeNumber);
      logEvent('info', 'bind-barcode-success', buildRequestLogMeta(request, {
        barcode,
        itemCode,
        previousBarcodes: result.previousBarcodes,
        confirmed: body.confirm === true
      }));
      return {
        ok: true,
        conflict: false,
        barcode,
        itemCode,
        previousBarcodes: result.previousBarcodes
      };
    });

    app.post('/api/recount/resolve-barcode', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
      const body = request.body && typeof request.body === 'object' ? request.body : {};
      const barcode = String(body.barcode || '').trim();
      const itemCodes = Array.isArray(body.itemCodes) ? body.itemCodes.map(code => String(code)) : [];
      const recount = body.recountId
        ? db.recounts.find(item => item.id === String(body.recountId) && item.userId === request.user.id)
        : null;
      const storeNumber = String(recount?.storeNumber || shopIdFallback || '').trim();

      const requestMeta = {
        barcode,
        itemCodesCount: itemCodes.length,
        storeNumber: storeNumber || null,
        hasShopApiUrl: Boolean(shopApiUrl),
        hasAccessToken: Boolean(shopApiTokenState.accessToken)
      };
      logEvent('info', 'resolve-barcode-request', requestMeta);
      logShopStdout('resolve-barcode-request', requestMeta);

      if (!barcode) {
        logEvent('warn', 'resolve-barcode-invalid', { reason: 'empty-barcode' });
        return reply.code(400).send({ ok: false, error: 'barcode is required' });
      }

      const cached = shopApiTokenState.cache.get(barcode);
      const cacheMatchesStore = cached?.storeNumber && storeNumber
        ? cached.storeNumber === storeNumber
        : !storeNumber || Boolean(cached?.storeNumber);
      if (cached?.codes?.length && cacheMatchesStore) {
        logEvent('info', 'resolve-barcode-cache-hit', { barcode, codes: cached.codes, source: cached.source || 'cache' });
        return { ok: true, resolved: true, fromCache: true, barcode, codes: cached.codes, source: cached.source || 'cache', product: cached.product || null };
      }

      logEvent('info', 'resolve-barcode-cache-miss', { barcode });
      const shopResult = await shopApiService.resolveBarcodeFromShopApi(barcode, storeNumber);
      if (shopResult.resolved && shopResult.code) {
        const code = String(shopResult.code);
        const product = shopResult.payload?.product || shopResult.payload?.item || null;
        shopApiService.addResolutionCode(barcode, code, shopResult.source, product, storeNumber);
        logEvent('info', 'resolve-barcode-shop-success', { barcode, code, source: shopResult.source });
        return { ok: true, resolved: true, fromCache: false, barcode, codes: [code], source: shopResult.source, product };
      }

      if (itemCodes.includes(barcode)) {
        shopApiService.addResolutionCode(barcode, barcode, 'item-code-fallback', null, storeNumber);
        logEvent('info', 'resolve-barcode-fallback', { barcode, code: barcode });
        return { ok: true, resolved: true, fromCache: false, barcode, codes: [barcode], source: 'item-code-fallback', product: null };
      }

      logEvent('warn', 'resolve-barcode-not-found', { barcode, source: shopResult.source || 'not-found', status: shopResult.status || null });
      return { ok: true, resolved: false, fromCache: false, barcode, codes: [], source: shopResult.source || 'not-found', product: null };
    });
  };
}
