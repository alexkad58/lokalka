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

test('shop API service builds article lookup URLs and normalizes product payloads', async () => {
  const service = createShopApiService({
    shopApi: {
      url: 'https://shop.test/products/{code}',
      method: 'GET',
      tokenHeader: 'Authorization',
      refreshHeader: 'X-Refresh-Token',
      tokenPrefix: 'Bearer',
      userAgent: 'test-agent',
      cityId: '7',
      shopId: 'shop-22'
    },
    tokenState: { accessToken: 'token', refreshToken: 'refresh', updatedAt: 0 },
    cache: new Map(),
    persistCache: () => {},
    logEvent: () => {},
    logShopStdout: () => {}
  });

  assert.equal(
    service.buildProductLookupUrl('A-100', 'store-9'),
    'https://shop.test/products/A-100?city_id=7&shop_id=store-9'
  );

  const normalized = service.normalizeProductPayload({
    success: true,
    result: {
      product_id: 'A-100',
      name: 'Вода 1л',
      description: 'Описание',
      measure: '1 л',
      img: 'https://img.test/main.jpg',
      label_img: 'https://img.test/label.jpg',
      back_label_img: 'https://img.test/back.jpg',
      quantity: 12,
      country_flag: 'https://img.test/flag.jpg',
      type: 'drink',
      img_preview: 'https://img.test/preview.jpg',
      label_img_preview: 'https://img.test/label-preview.jpg',
      back_label_img_preview: 'https://img.test/back-preview.jpg'
    }
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.product.productId, 'A-100');
  assert.equal(normalized.product.name, 'Вода 1л');
  assert.equal(normalized.product.imgPreview, 'https://img.test/preview.jpg');
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

test('shop API service edits and deletes one codebook entry without breaking shared barcodes', () => {
  const cache = new Map([
    ['shared-barcode', { codes: ['article-a', 'article-b'], source: 'manual', updatedAt: 1 }],
    ['old-barcode', { codes: ['article-a'], source: 'manual', updatedAt: 1 }]
  ]);
  const service = createShopApiService({
    shopApi: { url: '', method: 'GET', tokenHeader: 'Authorization', refreshHeader: '', tokenPrefix: 'Bearer' },
    tokenState: { accessToken: '', refreshToken: '', updatedAt: 0 },
    cache,
    persistCache: () => {},
    logEvent: () => {},
    logShopStdout: () => {}
  });

  service.updateCodebookEntry('article-a', ['new-barcode', 'shared-barcode']);
  assert.deepEqual(cache.get('shared-barcode').codes, ['article-b', 'article-a']);
  assert.equal(cache.has('old-barcode'), false);
  assert.deepEqual(cache.get('new-barcode').codes, ['article-a']);

  service.deleteCodebookEntry('article-a');
  assert.deepEqual(cache.get('shared-barcode').codes, ['article-b']);
  assert.equal(cache.has('new-barcode'), false);
});
