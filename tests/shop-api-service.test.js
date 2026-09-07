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
