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

function buildShopBarcodeUrl(shopApi, barcode, storeNumber = '') {
  if (!shopApi.url) return '';
  const encodedBarcode = encodeURIComponent(barcode);
  let url = shopApi.url.replace('{barcode}', encodedBarcode);
  if (!shopApi.url.includes('{barcode}') && !url.includes('?')) {
    if (!url.endsWith('/')) url += '/';
    url += `${encodedBarcode}/`;
  }
  const query = [];
  if (shopApi.cityId) query.push(`city_id=${encodeURIComponent(shopApi.cityId)}`);
  const shopId = String(storeNumber || shopApi.shopId || '').trim();
  if (shopId) query.push(`shop_id=${encodeURIComponent(shopId)}`);
  if (query.length) url += `${url.includes('?') ? '&' : '?'}${query.join('&')}`;
  return url;
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
      const headerAccess = getHeaderToken(response, shopApi.tokenHeader);
      const headerRefresh = getHeaderToken(response, shopApi.refreshHeader);
      const payloadTokens = extractTokenData(payload);
      const refreshed = hasResultRefreshedTokenFlag(payload);
      const tokenUpdate = updateTokenState({ accessToken: headerAccess, refreshToken: headerRefresh || payloadTokens.refreshToken });
      if (response.status === 401 || (response.status === 205 && refreshed)) {
        logEvent('info', 'shop-api-retry', { reason: response.status === 401 ? '401' : '205-with-token-refresh' });
        response = await requestShop();
        payload = await parseJson(response);
        updateTokenState({
          accessToken: getHeaderToken(response, shopApi.tokenHeader),
          refreshToken: getHeaderToken(response, shopApi.refreshHeader) || extractTokenData(payload).refreshToken
        });
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

  function addResolutionCode(barcode, code, source, product, storeNumber = '') {
    const existing = cache.get(barcode);
    const codes = new Set(existing?.codes || []);
    codes.add(String(code));
    cache.set(barcode, { codes: Array.from(codes), source: source || existing?.source || 'cache', product: product || existing?.product || null, storeNumber: String(storeNumber || existing?.storeNumber || '').trim(), updatedAt: Date.now() });
    persistCache();
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
    addResolutionCode,
    buildRecountCache,
    cache,
    buildShopBarcodeUrl: (barcode, storeNumber = '') => buildShopBarcodeUrl(shopApi, barcode, storeNumber),
    lastTokenChars
  };
}
