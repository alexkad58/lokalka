let authToken = '';
const DEVICE_ID_KEY = 'lokalka_device_id';

function createDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `dev_${Date.now()}_${randomPart}`;
}

function getOrCreateDeviceId() {
  if (typeof localStorage === 'undefined') return 'dev_unknown';

  const existing = String(localStorage.getItem(DEVICE_ID_KEY) || '').trim();
  if (existing) return existing;

  const next = createDeviceId();
  localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

const deviceId = getOrCreateDeviceId();

function authHeaders(extra = {}) {
  const base = { ...extra, 'X-Device-Id': deviceId };
  return authToken
    ? { ...base, Authorization: `Bearer ${authToken}` }
    : base;
}

async function readJsonOrThrow(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data.error || fallbackError);
  }
  return data;
}

async function readJsonWithErrorDetails(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.ok !== false) return data;

  const error = new Error(data.error || fallbackError);
  error.status = response.status;
  error.payload = data;
  throw error;
}

export function setAuthToken(token) {
  authToken = String(token || '').trim();
}

export async function register(login, password) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ login, password })
  });
  return readJsonOrThrow(response, 'Не удалось зарегистрироваться');
}

export async function login(loginValue, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ login: loginValue, password })
  });
  return readJsonOrThrow(response, 'Не удалось войти');
}

export async function me() {
  const response = await fetch('/api/auth/me', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Сессия недействительна');
}

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось выйти');
}

export async function getAdminUsers() {
  const response = await fetch('/api/admin/users', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить пользователей');
}

export async function getAdminLogs(level = 'all', limit = 200, options = {}) {
  const params = new URLSearchParams();
  params.set('level', String(level || 'all'));
  params.set('limit', String(limit));
  if (options.group && options.group !== 'all') params.set('group', String(options.group));
  if (Array.isArray(options.users) && options.users.length > 0) params.set('users', options.users.join(','));

  const response = await fetch(`/api/admin/logs?${params.toString()}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить логи');
}

export async function getAdminShopApiSettings() {
  const response = await fetch('/api/admin/shop-api', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить настройки API магазина');
}

export async function getAdminContactLinks() {
  const response = await fetch('/api/admin/contact-links', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить ссылки для связи');
}

export async function updateAdminContactLinks(payload = {}) {
  const response = await fetch('/api/admin/contact-links', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });
  return readJsonOrThrow(response, 'Не удалось сохранить ссылки для связи');
}

export async function getPatchNotes() {
  const response = await fetch('/api/patchnotes', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить патчноуты');
}

export async function getAdminPatchNotes() {
  const response = await fetch('/api/admin/patchnotes', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить патчноуты для админки');
}

export async function createAdminPatchNote(payload) {
  const response = await fetch('/api/admin/patchnotes', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });
  return readJsonOrThrow(response, 'Не удалось создать патчноут');
}

export async function updateAdminPatchNote(id, payload) {
  const response = await fetch(`/api/admin/patchnotes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });
  return readJsonOrThrow(response, 'Не удалось обновить патчноут');
}

export async function deleteAdminPatchNote(id) {
  const response = await fetch(`/api/admin/patchnotes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось удалить патчноут');
}

export async function updateAdminShopApiToken(token) {
  const response = await fetch('/api/admin/shop-api', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ token })
  });
  return readJsonOrThrow(response, 'Не удалось сохранить токен API магазина');
}

export async function getAdminProductByCode(code, storeNumber = '') {
  const params = new URLSearchParams();
  if (storeNumber) params.set('storeNumber', String(storeNumber));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`/api/admin/products/${encodeURIComponent(code)}${suffix}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить товар по артикулу');
}

export async function getSecurityProductByCode(code, storeNumber = '') {
  const params = new URLSearchParams();
  if (storeNumber) params.set('storeNumber', String(storeNumber));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`/api/referrals/products/${encodeURIComponent(code)}${suffix}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить товар по артикулу');
}

export async function getAdminCodebook(filter = 'all', page = 1, limit = 12) {
  const params = new URLSearchParams({ filter: String(filter || 'all'), page: String(page), limit: String(limit) });
  const response = await fetch(`/api/admin/barcode-cache?${params.toString()}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить справочник кодов');
}

export async function getSecurityCodebook(filter = 'all', page = 1, limit = 12) {
  const params = new URLSearchParams({ filter: String(filter || 'all'), page: String(page), limit: String(limit) });
  const response = await fetch(`/api/referrals/barcode-cache?${params.toString()}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить справочник кодов');
}

export async function updateAdminCodebookEntry(code, barcodes) {
  const response = await fetch(`/api/admin/barcode-cache/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ barcodes })
  });
  return readJsonOrThrow(response, 'Не удалось сохранить связь кода товара');
}

export async function deleteAdminCodebookEntry(code) {
  const response = await fetch(`/api/admin/barcode-cache/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось удалить связь кода товара');
}

export async function updateSecurityCodebookEntry(code, barcodes) {
  const response = await fetch(`/api/referrals/barcode-cache/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ barcodes })
  });
  return readJsonOrThrow(response, 'Не удалось сохранить связь кода товара');
}

export async function deleteSecurityCodebookEntry(code) {
  const response = await fetch(`/api/referrals/barcode-cache/${encodeURIComponent(code)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось удалить связь кода товара');
}

export async function activateUserSubscription(userId, payload = {}) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/subscription`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return readJsonOrThrow(response, 'Не удалось активировать подписку');
}

export async function resetUserDeviceBinding(userId) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/device/reset`, {
    method: 'POST',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось сбросить привязку устройства');
}

export async function setUserDeviceBindingDisabled(userId, disabled) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/device-binding`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ disabled })
  });
  return readJsonOrThrow(response, 'Не удалось изменить ограничение привязки');
}

export async function setUserSecurityRole(userId, enabled) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/security-role`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enabled })
  });
  return readJsonOrThrow(response, 'Не удалось изменить роль СБ');
}

export async function issueUserReferralCode(userId, payload = {}) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/referral-code`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });
  return readJsonOrThrow(response, 'Не удалось выдать код приглашения');
}

export async function getMyReferralStats() {
  const response = await fetch('/api/referrals/me', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить данные по коду СБ');
}

export async function activateReferralCode(payload = {}) {
  const response = await fetch('/api/referrals/activate', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });
  return readJsonWithErrorDetails(response, 'Не удалось активировать код приглашения');
}

export async function deleteRecount(id) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось удалить просчет');
}

export async function deleteAdminUser(userId) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось удалить пользователя');
}

export async function updateAccountSettings(payload) {
  const response = await fetch('/api/account/settings', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return readJsonOrThrow(response, 'Не удалось сохранить настройки');
}

export async function getRecounts() {
  const response = await fetch('/api/recounts', {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить список просчетов');
}

export async function getRecount(id) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось открыть просчет');
}

export async function reopenRecount(id) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось открыть просчет из истории');
}

export async function createRecountFromPdf(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/recounts/from-pdf', {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  });
  return readJsonOrThrow(response, 'Не удалось обработать PDF');
}

export async function createRecountFromQr(payload) {
  const response = await fetch('/api/recounts/from-qr', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return readJsonOrThrow(response, 'Не удалось создать просчет из QR');
}

export async function saveRecountProgress(id, payload) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}/progress`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  return readJsonOrThrow(response, 'Не удалось сохранить прогресс');
}

export async function completeRecount(id, payload) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Не удалось завершить просчет');
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);

  return {
    blob,
    fileName: fileNameMatch?.[1] || 'recount_report.pdf'
  };
}

export async function resolveBarcode(barcode, itemCodes = [], recountId = '') {
  const response = await fetch('/api/recount/resolve-barcode', {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ barcode, itemCodes, recountId })
  });

  return readJsonOrThrow(response, 'Не удалось обработать штрихкод');
}

export async function bindBarcodeToItem(payload) {
  const response = await fetch('/api/recount/bind-barcode', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {})
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok && data?.ok !== false) return data;

  const error = new Error(data.error || 'Не удалось привязать штрихкод');
  error.status = response.status;
  error.payload = data;
  throw error;
}

export async function finishRecountWithoutPdf(id, payload) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...payload, withoutPdf: true })
  });
  return readJsonOrThrow(response, 'Не удалось завершить просчет');
}
