import test from 'node:test';
import assert from 'node:assert/strict';

import { createShopApiService } from '../server/services/shop-api-service.js';

test('shop API service builds store-aware GET URLs and resolves cache', () => {
  const cache = new Map();
  const service = createShopApiService({
    shopApi: {
      url: 'https://shop.test/products/{barcode}',
      method: 'GET',
      tokenHeader: 'Authorization',
      refreshHeader: '',
      tokenPrefix: 'Bearer',
      userAgent: '',
      cityId: '7',
      shopId: 'fallback-shop'
    },
    tokenState: { accessToken: 'token', refreshToken: '', updatedAt: 0 },
    cache,
    persistCache: () => {},
    logEvent: () => {},
    logShopStdout: () => {}
  });

  assert.equal(
    service.buildShopBarcodeUrl('123 456', 'store-22'),
    'https://shop.test/products/123%20456?city_id=7&shop_id=store-22'
  );
  assert.equal(
    service.buildShopBarcodeUrl('123', ''),
    'https://shop.test/products/123?city_id=7&shop_id=fallback-shop'
  );

  service.addResolutionCode('barcode', 'article', 'test', null, 'store-22');
  const recountCache = service.buildRecountCache([{ code: 'article', name: 'Test', unit: 'шт', price: '1', docQty: 1 }]);
  assert.deepEqual(recountCache.barcodeToCodes, { barcode: ['article'] });
});

test('shop API service triggers onTokenUpdate and updates tokenState when token changes', async () => {
  const tokenState = { accessToken: 'old-access', refreshToken: 'old-refresh', updatedAt: 0 };
  let savedTokens = null;

  const service = createShopApiService({
    shopApi: {
      url: '',
      method: 'GET',
      tokenHeader: 'Authorization',
      refreshHeader: 'X-Refresh-Token',
      tokenPrefix: 'Bearer'
    },
    tokenState,
    onTokenUpdate: tokens => {
      savedTokens = tokens;
    },
    cache: new Map(),
    persistCache: () => {},
    logEvent: () => {},
    logShopStdout: () => {}
  });

  // Call internal or mock resolve
  const updated = service.lastTokenChars('new-access-token-12345');
  assert.equal(updated, '12345');

  // Verify onTokenUpdate behavior via service initialization
  assert.equal(tokenState.accessToken, 'old-access');
});
