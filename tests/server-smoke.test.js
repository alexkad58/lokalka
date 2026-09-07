import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PDFDocument from 'pdfkit';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lokalka-server-test-'));
process.env.NODE_ENV = 'test';
process.env.TSD_BOT_ENABLED = '0';
process.env.ADMIN_LOGIN = 'admin';
process.env.ADMIN_PASSWORD = 'admin-test-password';
process.env.LOKALKA_DATA_FILE = path.join(tempDir, 'storage.json');
process.env.LOKALKA_BARCODE_CACHE_FILE = path.join(tempDir, 'barcode-cache.json');

const { app, initializeServer } = await import('../server/server.js');

function jsonRequest(method, url, body, headers = {}) {
  return app.inject({
    method,
    url,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    payload: JSON.stringify(body)
  });
}

function authHeaders(token, deviceId = 'test-device') {
  return {
    authorization: `Bearer ${token}`,
    'x-device-id': deviceId
  };
}

function responseJson(response) {
  return JSON.parse(response.body);
}

function createSmokePdf() {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument();
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.text('Локалка smoke test');
    document.end();
  });
}

function multipartFilePayload(fileBuffer) {
  const boundary = '----lokalka-smoke-boundary';
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="smoke.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    payload: Buffer.concat([prefix, fileBuffer, suffix])
  };
}

let adminToken;
let userToken;
let userId;

before(async () => {
  await initializeServer();
  await app.ready();
});

after(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

test('health endpoint keeps the public contract', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(responseJson(response), { ok: true });
});

test('register, login, wrong password and auth/me contracts', async () => {
  const registerResponse = await jsonRequest(
    'POST',
    '/api/auth/register',
    { login: 'smoke-user', password: 'user-password' },
    { 'x-device-id': 'device-a' }
  );
  const registered = responseJson(registerResponse);

  assert.equal(registerResponse.statusCode, 200);
  assert.equal(registered.ok, true);
  assert.ok(registered.token);
  assert.equal(registered.user.login, 'smoke-user');
  userToken = registered.token;
  userId = registered.user.id;

  const wrongPasswordResponse = await jsonRequest(
    'POST',
    '/api/auth/login',
    { login: 'smoke-user', password: 'wrong-password' },
    { 'x-device-id': 'device-a' }
  );
  assert.equal(wrongPasswordResponse.statusCode, 401);
  assert.equal(responseJson(wrongPasswordResponse).error, 'Неверный логин или пароль');

  const meResponse = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(meResponse.statusCode, 200);
  assert.equal(responseJson(meResponse).user.id, userId);
});

test('admin can activate a user, enforce device binding, then disable it', async () => {
  const adminLoginResponse = await jsonRequest(
    'POST',
    '/api/auth/login',
    { login: 'admin', password: 'admin-test-password' },
    { 'x-device-id': 'admin-device' }
  );
  adminToken = responseJson(adminLoginResponse).token;
  assert.equal(adminLoginResponse.statusCode, 200);

  const activateResponse = await jsonRequest(
    'POST',
    `/api/admin/users/${userId}/subscription`,
    { days: 30 },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(activateResponse.statusCode, 200);
  assert.equal(responseJson(activateResponse).user.subscriptionActive, true);

  const mismatchResponse = await jsonRequest(
    'POST',
    '/api/auth/login',
    { login: 'smoke-user', password: 'user-password' },
    { 'x-device-id': 'device-b' }
  );
  assert.equal(mismatchResponse.statusCode, 403);
  assert.equal(responseJson(mismatchResponse).code, 'DEVICE_MISMATCH');

  const disableResponse = await jsonRequest(
    'POST',
    `/api/admin/users/${userId}/device-binding`,
    { disabled: true },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(disableResponse.statusCode, 200);
  assert.equal(responseJson(disableResponse).user.deviceBindingDisabled, true);

  const otherDeviceLoginResponse = await jsonRequest(
    'POST',
    '/api/auth/login',
    { login: 'smoke-user', password: 'user-password' },
    { 'x-device-id': 'device-b' }
  );
  assert.equal(otherDeviceLoginResponse.statusCode, 200);
  userToken = responseJson(otherDeviceLoginResponse).token;
});

test('admin token settings never return the full token', async () => {
  const updateResponse = await jsonRequest(
    'POST',
    '/api/admin/shop-api',
    { token: 'smoke-shop-api-token-12345' },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(responseJson(updateResponse).tokenLast5, '12345');
  assert.equal(responseJson(updateResponse).token, undefined);

  const readResponse = await app.inject({
    method: 'GET',
    url: '/api/admin/shop-api',
    headers: authHeaders(adminToken, 'admin-device')
  });
  assert.equal(readResponse.statusCode, 200);
  assert.equal(responseJson(readResponse).tokenLast5, '12345');
  assert.equal(responseJson(readResponse).token, undefined);
});

test('patch notes support authorized read and admin CRUD with validation', async () => {
  const unauthorizedRead = await app.inject({ method: 'GET', url: '/api/patchnotes' });
  assert.equal(unauthorizedRead.statusCode, 401);

  const userReadEmpty = await app.inject({
    method: 'GET',
    url: '/api/patchnotes',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(userReadEmpty.statusCode, 200);
  assert.deepEqual(responseJson(userReadEmpty).items, []);

  const userAdminDenied = await app.inject({
    method: 'GET',
    url: '/api/admin/patchnotes',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(userAdminDenied.statusCode, 403);

  const invalidCreate = await jsonRequest(
    'POST',
    '/api/admin/patchnotes',
    { date: '', title: '', text: '' },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(invalidCreate.statusCode, 400);

  const createOne = await jsonRequest(
    'POST',
    '/api/admin/patchnotes',
    { date: '2026-09-08', title: 'Alpha', text: 'First release note' },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(createOne.statusCode, 200);
  const noteOne = responseJson(createOne).item;
  assert.ok(noteOne.id);

  const createTwo = await jsonRequest(
    'POST',
    '/api/admin/patchnotes',
    { date: '2026-09-09', title: 'Beta', text: 'Second release note' },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(createTwo.statusCode, 200);
  const noteTwo = responseJson(createTwo).item;

  const adminList = await app.inject({
    method: 'GET',
    url: '/api/admin/patchnotes',
    headers: authHeaders(adminToken, 'admin-device')
  });
  assert.equal(adminList.statusCode, 200);
  assert.deepEqual(responseJson(adminList).items.map(item => item.id), [noteTwo.id, noteOne.id]);

  const updateOne = await jsonRequest(
    'PUT',
    `/api/admin/patchnotes/${encodeURIComponent(noteOne.id)}`,
    { date: '2026-09-10', title: 'Alpha updated', text: 'Updated release note text' },
    authHeaders(adminToken, 'admin-device')
  );
  assert.equal(updateOne.statusCode, 200);
  assert.equal(responseJson(updateOne).item.title, 'Alpha updated');

  const userReadFilled = await app.inject({
    method: 'GET',
    url: '/api/patchnotes',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(userReadFilled.statusCode, 200);
  assert.deepEqual(responseJson(userReadFilled).items.map(item => item.title), ['Alpha updated', 'Beta']);

  const deleteMissing = await app.inject({
    method: 'DELETE',
    url: '/api/admin/patchnotes/missing-id',
    headers: authHeaders(adminToken, 'admin-device')
  });
  assert.equal(deleteMissing.statusCode, 404);

  const deleteTwo = await app.inject({
    method: 'DELETE',
    url: `/api/admin/patchnotes/${encodeURIComponent(noteTwo.id)}`,
    headers: authHeaders(adminToken, 'admin-device')
  });
  assert.equal(deleteTwo.statusCode, 200);

  const deleteOne = await app.inject({
    method: 'DELETE',
    url: `/api/admin/patchnotes/${encodeURIComponent(noteOne.id)}`,
    headers: authHeaders(adminToken, 'admin-device')
  });
  assert.equal(deleteOne.statusCode, 200);

  const userReadAfterDelete = await app.inject({
    method: 'GET',
    url: '/api/patchnotes',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(userReadAfterDelete.statusCode, 200);
  assert.deepEqual(responseJson(userReadAfterDelete).items, []);
});

test('service and validation errors keep their status codes', async () => {
  const inactiveResponse = await app.inject({
    method: 'GET',
    url: '/api/recounts',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(inactiveResponse.statusCode, 200);

  const missingRecountResponse = await app.inject({
    method: 'GET',
    url: '/api/recounts/missing-recount',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(missingRecountResponse.statusCode, 404);
  assert.equal(responseJson(missingRecountResponse).error, 'Просчет не найден');

  const emptyBarcodeResponse = await jsonRequest(
    'POST',
    '/api/recount/resolve-barcode',
    { barcode: '', itemCodes: [] },
    authHeaders(userToken, 'device-a')
  );
  assert.equal(emptyBarcodeResponse.statusCode, 400);
  assert.equal(responseJson(emptyBarcodeResponse).error, 'barcode is required');

  const missingPdfResponse = await app.inject({
    method: 'POST',
    url: '/api/recount/parse-pdf',
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(missingPdfResponse.statusCode, 406);
});

test('recount lifecycle supports create, progress, complete, reopen and delete', async () => {
  const multipart = multipartFilePayload(await createSmokePdf());
  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/recounts/from-pdf',
    headers: {
      ...authHeaders(userToken, 'device-a'),
      'content-type': `multipart/form-data; boundary=${multipart.boundary}`
    },
    payload: multipart.payload
  });
  const created = responseJson(createResponse);

  assert.equal(createResponse.statusCode, 200);
  assert.equal(created.ok, true);
  assert.ok(created.recount.id);
  const recountId = created.recount.id;

  const progressResponse = await jsonRequest(
    'POST',
    `/api/recounts/${recountId}/progress`,
    { values: {}, search: 'smoke' },
    authHeaders(userToken, 'device-a')
  );
  assert.equal(progressResponse.statusCode, 200);
  assert.equal(responseJson(progressResponse).recount.search, 'smoke');

  const completeResponse = await jsonRequest(
    'POST',
    `/api/recounts/${recountId}/complete`,
    { values: {}, search: 'smoke', withoutPdf: true },
    authHeaders(userToken, 'device-a')
  );
  assert.equal(completeResponse.statusCode, 200);
  assert.equal(responseJson(completeResponse).recount.status, 'completed');

  const reopenResponse = await app.inject({
    method: 'POST',
    url: `/api/recounts/${recountId}/reopen`,
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(reopenResponse.statusCode, 200);
  assert.equal(responseJson(reopenResponse).recount.status, 'active');

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/api/recounts/${recountId}`,
    headers: authHeaders(userToken, 'device-a')
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(responseJson(deleteResponse), { ok: true });
});

test('recount completion returns a PDF with discrepancy table enabled', async () => {
  const multipart = multipartFilePayload(await createSmokePdf());
  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/recounts/from-pdf',
    headers: {
      ...authHeaders(userToken, 'device-a'),
      'content-type': `multipart/form-data; boundary=${multipart.boundary}`
    },
    payload: multipart.payload
  });
  const recountId = responseJson(createResponse).recount.id;

  const completeResponse = await jsonRequest(
    'POST',
    `/api/recounts/${recountId}/complete`,
    {
      counterName: 'Smoke counter',
      groupName: 'Smoke group',
      includeTotalSummary: true,
      includeDiscrepancyTable: true,
      values: {},
      withoutPdf: false
    },
    authHeaders(userToken, 'device-a')
  );

  assert.equal(completeResponse.statusCode, 200);
  assert.equal(completeResponse.headers['content-type'], 'application/pdf');
  assert.ok(completeResponse.rawPayload.length > 100);
});
