import http from 'node:http';
import https from 'node:https';

function normalizeBarcode(value) {
  return String(value || '').trim();
}

function extractArticleCode(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload.article || payload.code || payload.sku || payload.vendorCode;
  if (direct) return String(direct).trim();
  const nested = payload.data || payload.product || payload.item || payload.result;
  return nested && typeof nested === 'object' ? extractArticleCode(nested) : null;
}

function extractArticleCodeFromText(text) {
  const match = String(text || '').match(/\/products\/(\d+)(?:\/|\?|$)/i);
  return match?.[1] || null;
}

function extractArticleCodeFromLocationHeader(response) {
  const location = response.headers.get('location') || response.url;
  if (!location) return null;
  try {
    const parsed = new URL(location);
    return parsed.pathname.match(/\/products\/(\d+)(?:\/)?$/i)?.[1]
      || extractArticleCodeFromText(location);
  } catch {
    return extractArticleCodeFromText(location);
  }
}

function extractArticleCodeFromRedirectBody(response) {
  const body = String(response.bodyText || '');
  const meta = body.match(/url=['"]?([^'"\s>]+)['"]?/i)?.[1];
  const href = body.match(/href=['"]([^'"]+)['"]/i)?.[1];
  return extractArticleCodeFromText(meta || href || body);
}

function extractTokenData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { accessToken: null, refreshToken: null, refreshed: false };
  }
  const accessToken = payload.accessToken || payload.access_token || payload.token || payload.jwt || payload.newToken || null;
  const refreshToken = payload.refreshToken || payload.refresh_token || payload.newRefreshToken || null;
  const refreshed = payload.refreshed_token === true || payload.refreshedToken === true;
  const nested = payload.data || payload.result || payload.auth || payload.tokens;
  if (!nested || typeof nested !== 'object') return { accessToken, refreshToken, refreshed };
  const nestedTokens = extractTokenData(nested);
  return {
    accessToken: accessToken || nestedTokens.accessToken,
    refreshToken: refreshToken || nestedTokens.refreshToken,
    refreshed: refreshed || nestedTokens.refreshed
  };
}

function hasResultRefreshedTokenFlag(payload) {
  return payload?.result?.refreshed_token === true;
}

function extractResponseTokens(response, payload, shopApi) {
  const headerAccess = getHeaderToken(response, shopApi.tokenHeader)
    || getHeaderToken(response, 'Authorization')
    || getHeaderToken(response, 'AuthorizationX')
    || getHeaderToken(response, 'X-Access-Token')
    || getHeaderToken(response, 'X-Token');

  const headerRefresh = getHeaderToken(response, shopApi.refreshHeader)
    || getHeaderToken(response, 'X-Refresh-Token')
    || getHeaderToken(response, 'Refresh-Token');

  const payloadTokens = extractTokenData(payload);

  return {
    accessToken: headerAccess || payloadTokens.accessToken || null,
    refreshToken: headerRefresh || payloadTokens.refreshToken || null,
    refreshed: payloadTokens.refreshed || hasResultRefreshedTokenFlag(payload)
  };
}

function createHeaderReader(rawHeaders) {
  const store = new Map();
  for (const [name, value] of Object.entries(rawHeaders || {})) {
    store.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? ''));
  }
  return { get: name => store.get(String(name || '').toLowerCase()) || null };
}

function buildTokenHeaderValue(rawToken, prefix) {
  const token = String(rawToken || '').trim();
  if (!token) return '';
  const normalizedPrefix = String(prefix || '').trim();
  if (!normalizedPrefix || token.toLowerCase().startsWith(`${normalizedPrefix.toLowerCase()} `)) return token;
  return `${normalizedPrefix} ${token}`;
}

function lastTokenChars(value, size = 5) {
  const token = String(value || '').trim();
  return token ? token.slice(-size) : null;
}

function getHeaderToken(response, headerName) {
  if (!headerName) return null;
  const value = response.headers.get(headerName);
  if (!value) return null;
  return value.toLowerCase().startsWith('bearer ')
    ? value.slice(7).trim()
    : value.trim();
}

function buildShopCodeUrl(shopApi, code, storeNumber = '') {
  if (!shopApi.url) return '';
  const normalizedCode = String(code || '').trim();
  const encodedCode = encodeURIComponent(normalizedCode);
  let url = shopApi.url
    .replace(/\{barcode\}/gi, encodedCode)
    .replace(/\{code\}/gi, encodedCode)
    .replace(/\{product\}/gi, encodedCode);

  if (!shopApi.url.includes('{barcode}') && !shopApi.url.includes('{code}') && !shopApi.url.includes('{product}') && !url.includes('?')) {
    if (!url.endsWith('/')) url += '/';
    url += `${encodedCode}/`;
  }

  const query = [];
  if (shopApi.cityId) query.push(`city_id=${encodeURIComponent(shopApi.cityId)}`);
  const shopId = String(storeNumber || shopApi.shopId || '').trim();
  if (shopId) query.push(`shop_id=${encodeURIComponent(shopId)}`);
  if (query.length) url += `${url.includes('?') ? '&' : '?'}${query.join('&')}`;
  return url;
}

function buildShopBarcodeUrl(shopApi, barcode, storeNumber = '') {
  return buildShopCodeUrl(shopApi, barcode, storeNumber);
}

function normalizeProductPayload(payload) {
  const responseError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  const hasSuccessFlag = payload && typeof payload === 'object' && payload.success === false;
  if (hasSuccessFlag || responseError) {
    return {
      ok: false,
      error: {
        code: responseError?.code ?? payload?.code ?? null,
        message: responseError?.message || payload?.message || 'Не удалось получить товар по артикулу'
      },
      payload
    };
  }

  const result = payload?.result && typeof payload.result === 'object'
    ? payload.result
    : (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null);

  if (!result) {
    return { ok: false, error: { code: null, message: 'Пустой ответ API магазина' }, payload };
  }

  const productId = result.product_id ?? result.productId ?? result.article ?? result.code ?? result.id ?? null;
  const normalized = {
    productId: productId === null || productId === undefined ? null : String(productId).trim(),
    name: String(result.name || '').trim(),
    description: String(result.description || '').trim(),
    measure: String(result.measure || '').trim(),
    img: String(result.img || '').trim(),
    labelImg: String(result.label_img || result.labelImg || '').trim(),
    backLabelImg: String(result.back_label_img || result.backLabelImg || '').trim(),
    quantity: Number.isFinite(Number(result.quantity)) ? Number(result.quantity) : null,
    countryFlag: String(result.country_flag || result.countryFlag || '').trim(),
    type: String(result.type || '').trim(),
    imgPreview: String(result.img_preview || result.imgPreview || '').trim(),
    labelImgPreview: String(result.label_img_preview || result.labelImgPreview || '').trim(),
    backLabelImgPreview: String(result.back_label_img_preview || result.backLabelImgPreview || '').trim()
  };

  if (!normalized.productId && !normalized.name && !normalized.img && !normalized.imgPreview) {
    return { ok: false, error: { code: null, message: 'Не удалось распознать товар в ответе API' }, payload };
  }

  return { ok: true, product: normalized, payload };
}

async function sendShopApiRequest(url, options = {}) {
  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const bodyString = typeof options.body === 'string' ? options.body : '';
  return new Promise((resolve, reject) => {
    const request = client.request(parsedUrl, { method: options.method || 'GET', headers: options.headers || {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('error', reject);
      response.on('end', () => {
        const bodyText = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
        const status = Number(response.statusCode || 0);
        resolve({
          status,
          statusText: response.statusMessage || '',
          ok: status >= 200 && status < 300,
          url,
          headers: createHeaderReader(response.headers),
          bodyText,
          async json() { return bodyText ? JSON.parse(bodyText) : null; }
        });
      });
    });
    request.on('error', reject);
    if (bodyString) request.write(bodyString);
    request.end();
  });
}

export function createShopApiService({
  shopApi,
  tokenState,
  onTokenUpdate,
  cache,
  persistCache,
  logEvent,
  logShopStdout
}) {
  function updateTokenState(next) {
    const accessToken = next?.accessToken ? String(next.accessToken).trim() : '';
    const refreshToken = next?.refreshToken ? String(next.refreshToken).trim() : '';
    const accessChanged = Boolean(accessToken && accessToken !== tokenState.accessToken);
    const refreshChanged = Boolean(refreshToken && refreshToken !== tokenState.refreshToken);
    if (accessChanged) tokenState.accessToken = accessToken;
    if (refreshChanged) tokenState.refreshToken = refreshToken;
    if (accessChanged || refreshChanged) {
      tokenState.updatedAt = Date.now();
      logEvent('info', 'shop-api-token-state-updated', { accessChanged, refreshChanged });
      if (typeof onTokenUpdate === 'function') {
        try {
          Promise.resolve(onTokenUpdate({
            accessToken: accessChanged ? accessToken : undefined,
            refreshToken: refreshChanged ? refreshToken : undefined
          })).catch(err => {
            logEvent('error', 'shop-api-on-token-update-failed', { message: err?.message || String(err) });
          });
        } catch (err) {
          logEvent('error', 'shop-api-on-token-update-failed', { message: err?.message || String(err) });
        }
      }
    }
    return { changed: accessChanged || refreshChanged, accessChanged, refreshChanged };
  }

  async function parseJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) return null;
    try { return await response.json(); } catch { return null; }
  }

  async function resolveBarcodeFromShopApi(barcode, storeNumber = '') {
    if (!shopApi.url) return { resolved: false, source: 'unconfigured' };
    const url = shopApi.method === 'GET' ? buildShopBarcodeUrl(shopApi, barcode, storeNumber) : shopApi.url;

    async function requestShop() {
      const headers = { Accept: 'application/json' };
      if (shopApi.userAgent) headers['User-Agent'] = shopApi.userAgent;
      if (tokenState.accessToken) headers[shopApi.tokenHeader] = buildTokenHeaderValue(tokenState.accessToken, shopApi.tokenPrefix);
      if (shopApi.refreshHeader && tokenState.refreshToken) headers[shopApi.refreshHeader] = tokenState.refreshToken;
      if (shopApi.method === 'POST') headers['Content-Type'] = 'application/json';
      const startedAt = Date.now();
      const meta = { method: shopApi.method, url, hasAccessToken: Boolean(tokenState.accessToken), accessTokenLast5: lastTokenChars(tokenState.accessToken), hasRefreshToken: Boolean(tokenState.refreshToken), hasBody: shopApi.method === 'POST' };
      logEvent('info', 'shop-api-request', meta); logShopStdout('request', meta);
      const response = await sendShopApiRequest(url, {
        method: shopApi.method,
        headers,
        body: shopApi.method === 'POST' ? JSON.stringify({ barcode, shop_id: String(storeNumber || shopApi.shopId || '').trim() || undefined }) : undefined
      });
      const responseMeta = { method: shopApi.method, url, status: response.status, durationMs: Date.now() - startedAt };
      logEvent('info', 'shop-api-response', responseMeta); logShopStdout('response', responseMeta);
      return response;
    }

    try {
      let response = await requestShop();
      let payload = await parseJson(response);

      const tokens = extractResponseTokens(response, payload, shopApi);
      updateTokenState({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });

      if (response.status === 401 || response.status === 403 || (response.status === 205 && tokens.refreshed)) {
        logEvent('info', 'shop-api-retry', { reason: `${response.status}-retry`, refreshed: tokens.refreshed, hasUpdatedToken: Boolean(tokens.accessToken || tokens.refreshToken) });
        response = await requestShop();
        payload = await parseJson(response);
        const retryTokens = extractResponseTokens(response, payload, shopApi);
        updateTokenState({ accessToken: retryTokens.accessToken, refreshToken: retryTokens.refreshToken });
      }
      const locationCode = extractArticleCodeFromLocationHeader(response);
      const payloadCode = extractArticleCode(payload);
      const redirectBodyCode = extractArticleCodeFromRedirectBody(response);
      const code = locationCode || payloadCode || redirectBodyCode;
      logEvent('info', 'shop-api-resolve-result', { barcode, locationCode, payloadCode, redirectBodyCode, resolvedCode: code || null });
      logShopStdout('resolve-result', { barcode, resolvedCode: code || null });
      if (!response.ok && !code) return { resolved: false, source: 'shop-api', status: response.status };
      if (!code) return { resolved: false, source: 'shop-api', payload };
      return { resolved: true, source: response.ok ? 'shop-api' : 'shop-api-redirect', code, payload };
    } catch (error) {
      logEvent('error', 'shop-api-error', { method: shopApi.method, url, message: error instanceof Error ? error.message : String(error) });
      logShopStdout('error', { method: shopApi.method, url });
      return { resolved: false, source: 'shop-api-unreachable' };
    }
  }

  async function fetchProductByArticle(articleCode, storeNumber = '') {
    const normalizedCode = String(articleCode || '').trim();
    if (!normalizedCode) {
      return { ok: false, status: 400, error: { code: 400, message: 'Не указан код товара' } };
    }
    if (!shopApi.url) {
      return { ok: false, status: 503, error: { code: 503, message: 'API магазина не настроено' } };
    }

    const url = buildShopCodeUrl(shopApi, normalizedCode, storeNumber);
    const headers = { Accept: 'application/json' };
    if (shopApi.userAgent) headers['User-Agent'] = shopApi.userAgent;
    if (tokenState.accessToken) headers[shopApi.tokenHeader] = buildTokenHeaderValue(tokenState.accessToken, shopApi.tokenPrefix);
    if (shopApi.refreshHeader && tokenState.refreshToken) headers[shopApi.refreshHeader] = tokenState.refreshToken;
    const startedAt = Date.now();
    const meta = {
      method: shopApi.method,
      url,
      articleCode: normalizedCode,
      hasAccessToken: Boolean(tokenState.accessToken),
      accessTokenLast5: lastTokenChars(tokenState.accessToken),
      hasRefreshToken: Boolean(tokenState.refreshToken)
    };
    logEvent('info', 'shop-api-product-request', meta);
    logShopStdout('product-request', meta);

    try {
      const response = await sendShopApiRequest(url, { method: shopApi.method, headers });
      const payload = await parseJson(response);
      const tokens = extractResponseTokens(response, payload, shopApi);
      updateTokenState({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });

      const responseMeta = { method: shopApi.method, url, status: response.status, durationMs: Date.now() - startedAt };
      logEvent('info', 'shop-api-product-response', responseMeta);
      logShopStdout('product-response', responseMeta);

      const normalized = normalizeProductPayload(payload);
      if (normalized.ok) {
        return {
          ok: true,
          status: response.status,
          source: 'shop-api-product',
          articleCode: normalizedCode,
          product: normalized.product,
          payload: normalized.payload
        };
      }

      return {
        ok: false,
        status: response.status || 502,
        source: 'shop-api-product',
        articleCode: normalizedCode,
        error: normalized.error,
        payload: normalized.payload
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent('error', 'shop-api-product-error', { articleCode: normalizedCode, method: shopApi.method, url, message });
      logShopStdout('product-error', { articleCode: normalizedCode, method: shopApi.method, url });
      return { ok: false, status: 502, source: 'shop-api-unreachable', articleCode: normalizedCode, error: { code: 502, message } };
    }
  }

  function buildCodebookEntries({ filter = 'all', page = 1, limit = 20 } = {}) {
    const codeToBarcodes = new Map();
    const barcodeToCodes = new Map();

    for (const [barcode, record] of cache.entries()) {
      const normalizedBarcode = String(barcode || '').trim();
      if (!normalizedBarcode) continue;

      const codes = Array.isArray(record?.codes)
        ? record.codes.map(code => String(code || '').trim()).filter(Boolean)
        : (record?.code ? [String(record.code).trim()] : []);

      if (!codes.length) continue;

      const uniqueCodes = Array.from(new Set(codes));
      barcodeToCodes.set(normalizedBarcode, uniqueCodes);

      for (const code of uniqueCodes) {
        const set = codeToBarcodes.get(code) || new Set();
        set.add(normalizedBarcode);
        codeToBarcodes.set(code, set);
      }
    }

    const entries = Array.from(codeToBarcodes.entries()).map(([code, barcodes]) => {
      const normalizedBarcodes = Array.from(barcodes).sort();
      const directConflict = normalizedBarcodes.some(barcode => (barcodeToCodes.get(barcode) || []).length > 1);
      const conflict = normalizedBarcodes.length > 1 || directConflict;
      const relatedRecords = normalizedBarcodes
        .map(barcode => cache.get(barcode))
        .filter(Boolean)
        .map(record => ({
          barcode: String(record?.barcode || '').trim(),
          source: String(record?.source || '').trim(),
          storeNumber: String(record?.storeNumber || '').trim(),
          updatedAt: Number(record?.updatedAt || 0)
        }));

      const latestUpdatedAt = relatedRecords.reduce((max, item) => Math.max(max, Number(item.updatedAt || 0)), 0);
      const storeNumbers = Array.from(new Set(relatedRecords.map(item => item.storeNumber).filter(Boolean))).sort();
      const sources = Array.from(new Set(relatedRecords.map(item => item.source).filter(Boolean))).sort();

      return {
        code,
        barcodes: normalizedBarcodes,
        barcodeCount: normalizedBarcodes.length,
        storeNumbers,
        sources,
        updatedAt: latestUpdatedAt,
        conflict
      };
    }).sort((a, b) => {
      if (a.conflict !== b.conflict) return Number(b.conflict) - Number(a.conflict);
      return a.code.localeCompare(b.code, 'ru', { numeric: true });
    });

    const filtered = filter === 'conflict' ? entries.filter(entry => entry.conflict) : entries;
    const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 20;
    const startIndex = (safePage - 1) * safeLimit;
    const pageEntries = filtered.slice(startIndex, startIndex + safeLimit);

    return {
      entries: pageEntries,
      total: filtered.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(filtered.length / safeLimit)),
      stats: {
        totalCodes: entries.length,
        conflictCodes: entries.filter(entry => entry.conflict).length,
        totalLinks: Array.from(cache.entries()).reduce((sum, [, record]) => sum + (Array.isArray(record?.codes) ? record.codes.length : (record?.code ? 1 : 0)), 0)
      }
    };
  }

  function addResolutionCode(barcode, code, source, product, storeNumber = '') {
    const existing = cache.get(barcode);
    const codes = new Set(existing?.codes || []);
    codes.add(String(code));
    cache.set(barcode, { codes: Array.from(codes), source: source || existing?.source || 'cache', product: product || existing?.product || null, storeNumber: String(storeNumber || existing?.storeNumber || '').trim(), updatedAt: Date.now() });
    persistCache();
  }

  function findBarcodesForCode(code, excludedBarcode = '') {
    const normalizedCode = String(code || '').trim();
    const normalizedExcludedBarcode = String(excludedBarcode || '').trim();
    if (!normalizedCode) return [];

    return Array.from(cache.entries())
      .filter(([barcode, record]) => barcode !== normalizedExcludedBarcode && (record?.codes || []).map(String).includes(normalizedCode))
      .map(([barcode]) => barcode);
  }

  function reassignResolutionCode(barcode, code, source = 'manual', storeNumber = '') {
    const normalizedBarcode = String(barcode || '').trim();
    const normalizedCode = String(code || '').trim();
    if (!normalizedBarcode || !normalizedCode) {
      return { changed: false, barcode: normalizedBarcode, code: normalizedCode, previousBarcodes: [] };
    }

    const previousBarcodes = findBarcodesForCode(normalizedCode, normalizedBarcode);
    
    // Don't modify other barcodes - just add code to target barcode with deduplication
    const current = cache.get(normalizedBarcode);
    const currentCodes = (current?.codes || []).map(String);
    const codesSet = new Set(currentCodes);
    codesSet.add(normalizedCode);
    
    cache.set(normalizedBarcode, {
      ...(current || {}),
      codes: Array.from(codesSet),
      source,
      storeNumber: String(storeNumber || current?.storeNumber || '').trim(),
      updatedAt: Date.now()
    });
    persistCache();

    return { changed: true, barcode: normalizedBarcode, code: normalizedCode, previousBarcodes };
  }

  function updateCodebookEntry(code, barcodes, source = 'manual', storeNumber = '') {
    const normalizedCode = String(code || '').trim();
    const normalizedBarcodes = Array.from(new Set(
      (Array.isArray(barcodes) ? barcodes : [])
        .map(barcode => String(barcode || '').trim())
        .filter(Boolean)
    ));

    if (!normalizedCode) return { changed: false, code: '', barcodes: [] };

    for (const [barcode, record] of cache.entries()) {
      const codes = (record?.codes || []).map(String).filter(item => item !== normalizedCode);
      if (codes.length) {
        cache.set(barcode, { ...record, codes, updatedAt: Date.now() });
      } else {
        cache.delete(barcode);
      }
    }

    for (const barcode of normalizedBarcodes) {
      const current = cache.get(barcode);
      const codes = Array.from(new Set([...(current?.codes || []).map(String), normalizedCode]));
      cache.set(barcode, {
        ...(current || {}),
        codes,
        source: source || current?.source || 'manual',
        storeNumber: String(storeNumber || current?.storeNumber || '').trim(),
        updatedAt: Date.now()
      });
    }

    persistCache();
    return { changed: true, code: normalizedCode, barcodes: normalizedBarcodes };
  }

  function deleteCodebookEntry(code) {
    return updateCodebookEntry(code, []);
  }

  function buildRecountCache(items) {
    const itemByCode = {};
    const barcodeToCodes = {};
    for (const item of items) itemByCode[String(item.code)] = { code: item.code, name: item.name, unit: item.unit, price: item.price, docQty: item.docQty };
    for (const [barcode, record] of cache.entries()) {
      const codes = (record?.codes || []).filter(code => itemByCode[code]);
      if (codes.length) barcodeToCodes[barcode] = codes;
    }
    return { barcodeToCodes, itemByCode, builtAt: new Date().toISOString() };
  }

  return {
    resolveBarcodeFromShopApi,
    fetchProductByArticle,
    buildCodebookEntries,
    addResolutionCode,
    findBarcodesForCode,
    reassignResolutionCode,
    updateCodebookEntry,
    deleteCodebookEntry,
    buildRecountCache,
    cache,
    normalizeProductPayload,
    buildProductLookupUrl: (articleCode, storeNumber = '') => buildShopCodeUrl(shopApi, articleCode, storeNumber),
    buildShopBarcodeUrl: (barcode, storeNumber = '') => buildShopBarcodeUrl(shopApi, barcode, storeNumber),
    lastTokenChars
  };
}
