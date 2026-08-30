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

export async function getAdminLogs(level = 'all', limit = 200) {
  const params = new URLSearchParams();
  params.set('level', String(level || 'all'));
  params.set('limit', String(limit));

  const response = await fetch(`/api/admin/logs?${params.toString()}`, {
    headers: authHeaders()
  });
  return readJsonOrThrow(response, 'Не удалось загрузить логи');
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

export async function resolveBarcode(barcode, itemCodes = []) {
  const response = await fetch('/api/recount/resolve-barcode', {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({ barcode, itemCodes })
  });

  return readJsonOrThrow(response, 'Не удалось обработать штрихкод');
}

export async function finishRecountWithoutPdf(id, payload) {
  const response = await fetch(`/api/recounts/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...payload, withoutPdf: true })
  });
  return readJsonOrThrow(response, 'Не удалось завершить просчет');
}
