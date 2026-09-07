import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFactExpression, sumFactExpression, parseCenCode } from '../shared/recount-utils.js';
import { createShopApiService } from '../server/services/shop-api-service.js';
import { createBarcodeRoutes } from '../server/routes/barcode.js';

test('sanitizeFactExpression keeps expression format and removes invalid chars', () => {
  assert.equal(sanitizeFactExpression('3+7+12'), '3+7+12');
  assert.equal(sanitizeFactExpression('3 + 7 + 12'), '3+7+12');
  assert.equal(sanitizeFactExpression('abc3+7x'), '3+7');
  assert.equal(sanitizeFactExpression('3+'), '3+');
});

test('sumFactExpression totals added values', () => {
  assert.equal(sumFactExpression('3+7+12'), 22);
  assert.equal(sumFactExpression('0+0'), 0);
});

test('parseCenCode extracts second semicolon-delimited token', () => {
  assert.equal(parseCenCode('CEN;123123;55;66'), '123123');
  assert.equal(parseCenCode('CEN;123123'), '123123');
  assert.equal(parseCenCode('ABC;123123;55'), null);
});

test('barcode ownership lookup and reassignment keep one owner without duplicates', () => {
  const cache = new Map([
    ['barcode-old', { codes: ['29390', '39054'], source: 'manual' }],
    ['barcode-current', { codes: ['41464', '29390'], source: 'shop-api' }]
  ]);
  let persistCount = 0;
  const service = createShopApiService({
    shopApi: { url: '' },
    tokenState: {},
    cache,
    persistCache: () => { persistCount += 1; },
    logEvent: () => {},
    logShopStdout: () => {}
  });

  assert.deepEqual(service.findBarcodesForCode('29390', 'barcode-new'), ['barcode-old', 'barcode-current']);

  const result = service.reassignResolutionCode('barcode-new', '29390', 'manual', '22021');

  assert.deepEqual(result.previousBarcodes, ['barcode-old', 'barcode-current']);
  assert.equal(cache.has('barcode-old'), true);
  assert.deepEqual(cache.get('barcode-old').codes, ['39054']);
  assert.deepEqual(cache.get('barcode-current').codes, ['41464']);
  assert.deepEqual(cache.get('barcode-new').codes, ['29390']);
  assert.equal(cache.get('barcode-new').storeNumber, '22021');
  assert.equal(persistCount, 1);
});

test('barcode binding route requires confirmation before moving an existing ownership', async () => {
  let bindHandler;
  const fakeApp = {
    post(path, options, handler) {
      if (path === '/api/recount/bind-barcode') bindHandler = handler;
    }
  };
  const cache = new Map([
    ['barcode-old', { codes: ['29390'], source: 'manual' }]
  ]);
  const service = createShopApiService({
    shopApi: { url: '' },
    tokenState: {},
    cache,
    persistCache: () => {},
    logEvent: () => {},
    logShopStdout: () => {}
  });
  await createBarcodeRoutes({
    authenticate: async () => {},
    requireServiceAccess: async () => {},
    db: {
      recounts: [{
        id: 'recount-1',
        userId: 'user-1',
        storeNumber: '22021',
        items: [{ code: '29390' }]
      }]
    },
    shopApiService: service,
    shopApiUrl: '',
    shopApiTokenState: { accessToken: '' },
    shopIdFallback: '',
    logEvent: () => {},
    logShopStdout: () => {},
    buildRequestLogMeta: () => ({})
  })(fakeApp);

  const request = {
    user: { id: 'user-1' },
    body: { barcode: 'barcode-new', itemCode: '29390', recountId: 'recount-1' }
  };
  const reply = {
    statusCode: 200,
    code(status) { this.statusCode = status; return this; },
    send(payload) { this.payload = payload; return payload; }
  };

  await bindHandler(request, reply);
  assert.equal(reply.statusCode, 409);
  assert.deepEqual(reply.payload.existingBarcodes, ['barcode-old']);
  assert.deepEqual(cache.get('barcode-old').codes, ['29390']);
  assert.equal(cache.has('barcode-new'), false);

  const confirmedReply = {
    statusCode: 200,
    code(status) { this.statusCode = status; return this; },
    send(payload) { this.payload = payload; return payload; }
  };
  const confirmed = await bindHandler({
    ...request,
    body: { ...request.body, confirm: true }
  }, confirmedReply);

  assert.equal(confirmed.ok, true);
  assert.deepEqual(confirmed.previousBarcodes, ['barcode-old']);
  assert.deepEqual(cache.get('barcode-new').codes, ['29390']);
  assert.equal(cache.has('barcode-old'), false);
});
