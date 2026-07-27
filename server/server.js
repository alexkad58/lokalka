import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { PDFParse } from 'pdf-parse';
import http from 'node:http';
import https from 'node:https';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import PDFDocument from 'pdfkit';

const app = Fastify({
  logger: {
    base: null,
    formatters: {
      level() {
        return {};
      }
    }
  }
});

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const AUTOSAVE_MIN_INTERVAL_MS = 3000;
const barcodeResolutionCache = new Map();
const DATA_FILE_URL = new URL('./storage.json', import.meta.url);
const TOKEN_STORAGE_KEY = 'bearer';
const ADMIN_LOGIN = normalizeLogin(process.env.ADMIN_LOGIN || 'admin');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'admin');

const db = {
  users: [],
  recounts: [],
  sessions: []
};

const sessions = new Map();
const MAX_AUDIT_LOGS = Number.parseInt(process.env.MAX_AUDIT_LOGS || '2000', 10);
const auditLogs = [];
const KNOWN_LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug', 'trace', 'fatal'];
const SESSION_TTL_DAYS = Number.parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const SESSION_TTL_MS = Math.max(1, Number.isFinite(SESSION_TTL_DAYS) ? SESSION_TTL_DAYS : 30) * 24 * 60 * 60 * 1000;

const SHOP_API_URL = process.env.SHOP_API_URL || '';
const SHOP_API_METHOD = (process.env.SHOP_API_METHOD || 'GET').toUpperCase();
const SHOP_API_TOKEN_HEADER = process.env.SHOP_API_TOKEN_HEADER || 'Authorization';
const SHOP_API_REFRESH_HEADER = process.env.SHOP_API_REFRESH_HEADER || '';
const SHOP_API_TOKEN_PREFIX = process.env.SHOP_API_TOKEN_PREFIX || 'Bearer';
const SHOP_API_USER_AGENT = process.env.SHOP_API_USER_AGENT || '';
const SHOP_API_CITY_ID = process.env.SHOP_API_CITY_ID || '';
const SHOP_API_SHOP_ID = process.env.SHOP_API_SHOP_ID || '';
const SHOP_API_STDOUT_LOGS = process.env.SHOP_API_STDOUT_LOGS === '1';

const tokenState = {
  accessToken: process.env.SHOP_API_TOKEN || '',
  refreshToken: process.env.SHOP_API_REFRESH_TOKEN || '',
  updatedAt: Date.now()
};

function createId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function toIsoNow() {
  return new Date().toISOString();
}

function sanitizeLogLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (KNOWN_LOG_LEVELS.includes(normalized) && normalized !== 'all') {
    return normalized;
  }
  return 'info';
}

function clipLogString(value, maxLength = 300) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function sanitizeLogMetaValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return clipLogString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[depth-limit]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map(item => sanitizeLogMetaValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      result[key] = sanitizeLogMetaValue(item, depth + 1);
    }
    return result;
  }

  return clipLogString(value);
}

function sanitizeLogMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    result[key] = sanitizeLogMetaValue(value);
  }
  return result;
}

function getRequestIp(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request?.ip || null;
}

function appendAuditLog(level, event, vars = {}) {
  const meta = sanitizeLogMeta(vars);
  const entry = {
    id: createId('log'),
    ts: toIsoNow(),
    level,
    event: String(event || 'unknown-event'),
    actorLogin: typeof meta.actorLogin === 'string' ? meta.actorLogin : null,
    actorId: typeof meta.actorId === 'string' ? meta.actorId : null,
    path: typeof meta.path === 'string' ? meta.path : null,
    method: typeof meta.method === 'string' ? meta.method : null,
    ip: typeof meta.ip === 'string' ? meta.ip : null,
    meta
  };

  auditLogs.push(entry);

  const maxSize = Number.isFinite(MAX_AUDIT_LOGS) && MAX_AUDIT_LOGS > 100
    ? MAX_AUDIT_LOGS
    : 2000;

  if (auditLogs.length > maxSize) {
    auditLogs.splice(0, auditLogs.length - maxSize);
  }
}

function buildRequestLogMeta(request, extra = {}) {
  return {
    actorId: request?.user?.id || null,
    actorLogin: request?.user?.login || null,
    actorIsAdmin: Boolean(request?.user?.isAdmin),
    method: request?.method || null,
    path: request?.url || null,
    ip: getRequestIp(request),
    ...extra
  };
}

function normalizeDeviceId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, 120);
}

function getDeviceIdFromRequest(request) {
  return normalizeDeviceId(request?.headers?.['x-device-id']);
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash || '').split(':');
  if (!salt || !expectedHex) return false;
  const actualHex = scryptSync(String(password || ''), salt, 64).toString('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

async function loadDb() {
  try {
    const raw = await readFile(DATA_FILE_URL, 'utf8');
    const parsed = JSON.parse(raw);

    db.users = Array.isArray(parsed?.users)
      ? parsed.users.map(user => ({
        ...user,
        login: normalizeLogin(user.login),
        isAdmin: Boolean(user.isAdmin || normalizeLogin(user.login) === ADMIN_LOGIN),
        subscriptionUntil: user.subscriptionUntil ? String(user.subscriptionUntil) : null,
        deviceId: user?.deviceId ? normalizeDeviceId(user.deviceId) : null
      }))
      : [];
    db.recounts = Array.isArray(parsed?.recounts) ? parsed.recounts : [];
    db.sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions.map(item => ({
        token: String(item?.token || '').trim(),
        userId: String(item?.userId || '').trim(),
        createdAt: item?.createdAt ? String(item.createdAt) : toIsoNow(),
        updatedAt: item?.updatedAt ? String(item.updatedAt) : toIsoNow(),
        expiresAt: item?.expiresAt ? String(item.expiresAt) : new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        ip: item?.ip ? clipLogString(item.ip, 120) : null,
        userAgent: item?.userAgent ? clipLogString(item.userAgent, 240) : null,
        deviceId: item?.deviceId ? normalizeDeviceId(item.deviceId) : null
      }))
      : [];

    const didChange = ensureAdminUser() || hydrateSessionsFromDb();
    if (didChange) {
      await saveDb();
    }
  } catch {
    db.users = [];
    db.recounts = [];
    db.sessions = [];
    ensureAdminUser();
    hydrateSessionsFromDb();
    await saveDb();
  }
}

async function saveDb() {
  await writeFile(DATA_FILE_URL, JSON.stringify(db, null, 2), 'utf8');
}

function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    createdAt: user.createdAt,
    isAdmin: Boolean(user.isAdmin),
    subscriptionUntil: user.subscriptionUntil || null,
    subscriptionActive: hasActiveSubscription(user),
    deviceBound: Boolean(user.deviceId)
  };
}

function ensureAdminUser() {
  const existing = db.users.find(user => normalizeLogin(user.login) === ADMIN_LOGIN);
  if (existing) {
    let changed = false;

    if (normalizeLogin(existing.login) !== ADMIN_LOGIN) {
      existing.login = ADMIN_LOGIN;
      changed = true;
    }

    if (!existing.isAdmin) {
      existing.isAdmin = true;
      changed = true;
    }

    if (!verifyPassword(ADMIN_PASSWORD, existing.passwordHash)) {
      existing.passwordHash = hashPassword(ADMIN_PASSWORD);
      changed = true;
    }

    return changed;
  }

  db.users.push({
    id: createId('u'),
    login: ADMIN_LOGIN,
    passwordHash: hashPassword(ADMIN_PASSWORD),
    createdAt: toIsoNow(),
    isAdmin: true,
    subscriptionUntil: null,
    deviceId: null
  });
  return true;
}

function hasActiveSubscription(user) {
  if (user?.isAdmin) return true;
  const rawUntil = user?.subscriptionUntil;
  if (!rawUntil) return false;
  const untilTs = Date.parse(String(rawUntil));
  if (Number.isNaN(untilTs)) return false;
  return untilTs >= Date.now();
}

function buildSubscriptionStatus(user) {
  if (user?.isAdmin) {
    return {
      key: 'admin',
      label: 'администратор'
    };
  }

  const active = hasActiveSubscription(user);
  if (!active || !user?.subscriptionUntil) {
    return {
      key: 'inactive',
      label: 'неактивный'
    };
  }

  return {
    key: 'active',
    label: `активный до ${formatRuDate(user.subscriptionUntil)}`
  };
}

function issueToken(userId) {
  const token = randomBytes(24).toString('hex');
  return token;
}

function hydrateSessionsFromDb() {
  const userIds = new Set(db.users.map(user => user.id));
  const nowTs = Date.now();
  const candidates = Array.isArray(db.sessions) ? db.sessions : [];

  const valid = candidates
    .map(item => ({
      token: String(item?.token || '').trim(),
      userId: String(item?.userId || '').trim(),
      createdAt: item?.createdAt ? String(item.createdAt) : toIsoNow(),
      updatedAt: item?.updatedAt ? String(item.updatedAt) : toIsoNow(),
      expiresAt: item?.expiresAt ? String(item.expiresAt) : new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      ip: item?.ip ? clipLogString(item.ip, 120) : null,
      userAgent: item?.userAgent ? clipLogString(item.userAgent, 240) : null,
      deviceId: item?.deviceId ? normalizeDeviceId(item.deviceId) : null
    }))
    .filter(item => item.token && item.userId && userIds.has(item.userId))
    .filter(item => {
      const expiresTs = Date.parse(item.expiresAt);
      return !Number.isNaN(expiresTs) && expiresTs > nowTs;
    })
    .sort((a, b) => {
      const aTs = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const bTs = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return bTs - aTs;
    });

  const byUser = new Map();
  for (const session of valid) {
    if (!byUser.has(session.userId)) {
      byUser.set(session.userId, session);
    }
  }

  const next = Array.from(byUser.values());
  sessions.clear();
  for (const session of next) {
    sessions.set(session.token, session);
  }

  const changed = JSON.stringify(next) !== JSON.stringify(db.sessions || []);
  db.sessions = next;
  return changed;
}

async function createSessionForUser(user, request) {
  const nowIso = toIsoNow();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const token = issueToken(user.id);
  const deviceId = getDeviceIdFromRequest(request);

  for (const [existingToken, session] of sessions.entries()) {
    if (session?.userId === user.id) {
      sessions.delete(existingToken);
    }
  }

  db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).filter(session => session.userId !== user.id);

  const nextSession = {
    token,
    userId: user.id,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt,
    ip: getRequestIp(request),
    userAgent: clipLogString(request?.headers?.['user-agent'] || '', 240),
    deviceId: deviceId || null
  };

  db.sessions.push(nextSession);
  sessions.set(token, nextSession);
  await saveDb();
  return token;
}

async function revokeSessionByToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return false;

  sessions.delete(normalized);
  const current = Array.isArray(db.sessions) ? db.sessions : [];
  const next = current.filter(session => session.token !== normalized);
  if (next.length === current.length) return false;

  db.sessions = next;
  await saveDb();
  return true;
}

function getTokenFromRequest(request) {
  const raw = String(request.headers.authorization || '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) return '';
  return raw.slice(7).trim();
}

async function authenticate(request, reply) {
  const token = getTokenFromRequest(request);
  const requestDeviceId = getDeviceIdFromRequest(request);
  const session = token ? sessions.get(token) : null;
  if (session) {
    const expiresTs = Date.parse(String(session.expiresAt || ''));
    if (Number.isNaN(expiresTs) || expiresTs <= Date.now()) {
      await revokeSessionByToken(token);
      logEvent('warn', 'session-expired', {
        method: request.method,
        path: request.url,
        ip: getRequestIp(request)
      });
      reply.code(401).send({ ok: false, error: 'Сессия истекла. Войдите снова.' });
      return;
    }
  }

  const userId = session?.userId || null;
  const user = userId ? db.users.find(item => item.id === userId) : null;

  if (!user) {
    logEvent('warn', 'auth-required', {
      method: request.method,
      path: request.url,
      ip: getRequestIp(request)
    });
    reply.code(401).send({ ok: false, error: 'Требуется авторизация' });
    return;
  }

  if (!requestDeviceId) {
    logEvent('warn', 'device-id-required', {
      method: request.method,
      path: request.url,
      actorId: user.id,
      actorLogin: user.login,
      ip: getRequestIp(request)
    });
    reply.code(401).send({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'Не удалось определить устройство. Обновите приложение.' });
    return;
  }

  if (user.deviceId && user.deviceId !== requestDeviceId) {
    logEvent('warn', 'device-mismatch-auth', {
      method: request.method,
      path: request.url,
      actorId: user.id,
      actorLogin: user.login,
      expectedDeviceId: user.deviceId,
      gotDeviceId: requestDeviceId,
      ip: getRequestIp(request)
    });
    reply.code(403).send({ ok: false, code: 'DEVICE_MISMATCH', error: 'Аккаунт привязан к другому устройству. Обратитесь к администратору.' });
    return;
  }

  if (session?.deviceId && session.deviceId !== requestDeviceId) {
    logEvent('warn', 'session-device-mismatch', {
      method: request.method,
      path: request.url,
      actorId: user.id,
      actorLogin: user.login,
      sessionDeviceId: session.deviceId,
      gotDeviceId: requestDeviceId,
      ip: getRequestIp(request)
    });
    reply.code(401).send({ ok: false, code: 'SESSION_DEVICE_MISMATCH', error: 'Сессия недействительна для этого устройства. Войдите снова.' });
    return;
  }

  if (!user.deviceId) {
    user.deviceId = requestDeviceId;
    if (session && !session.deviceId) {
      session.deviceId = requestDeviceId;
      session.updatedAt = toIsoNow();
      const sessionIndex = (Array.isArray(db.sessions) ? db.sessions : [])
        .findIndex(item => item.token === token);
      if (sessionIndex >= 0) {
        db.sessions[sessionIndex] = {
          ...db.sessions[sessionIndex],
          deviceId: requestDeviceId,
          updatedAt: session.updatedAt
        };
      }
    }
    await saveDb();

    logEvent('info', 'device-bound-on-auth', {
      actorId: user.id,
      actorLogin: user.login,
      deviceId: requestDeviceId,
      ip: getRequestIp(request)
    });
  }

  request.authToken = token;
  request.user = user;
}

async function requireServiceAccess(request, reply) {
  if (request.user?.isAdmin) return;
  if (hasActiveSubscription(request.user)) return;

  logEvent('warn', 'service-access-denied', buildRequestLogMeta(request, {
    subscriptionUntil: request.user?.subscriptionUntil || null
  }));

  reply.code(403).send({
    ok: false,
    code: 'SUBSCRIPTION_REQUIRED',
    error: 'Подписка не активна. Обратитесь к администратору.'
  });
}

async function requireAdmin(request, reply) {
  if (request.user?.isAdmin) return;
  logEvent('warn', 'admin-access-denied', buildRequestLogMeta(request));
  reply.code(403).send({ ok: false, error: 'Доступ только для администратора' });
}

function computeItemFact(item, values, options = {}) {
  const treatEmptyAsZero = Boolean(options.treatEmptyAsZero);
  const raw = values?.[item.code];
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    return sumFactExpression(raw);
  }
  if (treatEmptyAsZero) {
    return 0;
  }
  return null;
}

function sanitizeFactExpression(value) {
  let normalized = String(value || '').replace(/[^\d+]/g, '');
  normalized = normalized.replace(/\++/g, '+');
  normalized = normalized.replace(/^\+/, '');
  return normalized;
}

function sumFactExpression(value) {
  const normalized = sanitizeFactExpression(value);
  const parts = normalized.split('+').filter(Boolean);
  if (!parts.length) return null;

  return parts.reduce((acc, part) => acc + asNumber(part), 0);
}

function buildRecountSummary(recount) {
  const items = Array.isArray(recount.items) ? recount.items : [];
  const values = recount.values && typeof recount.values === 'object' ? recount.values : {};
  const treatEmptyAsZero = recount.status === 'completed';

  let mismatchCount = 0;
  let filledCount = 0;
  let totalSum = 0;

  for (const item of items) {
    const docQty = Number.parseFloat(String(item.docQty ?? 0).replace(',', '.')) || 0;
    const fact = computeItemFact(item, values, { treatEmptyAsZero });
    const price = asNumber(item.price);
    if (fact !== null) filledCount += 1;
    if (fact !== null) {
      const delta = fact - docQty;
      totalSum += delta * price;
      if (delta !== 0) mismatchCount += 1;
    }
  }

  return {
    id: recount.id,
    status: recount.status,
    docId: recount.docId,
    sourceFileName: recount.sourceFileName,
    createdAt: recount.createdAt,
    updatedAt: recount.updatedAt,
    completedAt: recount.completedAt || null,
    totalItems: items.length,
    filledCount,
    mismatchCount,
    totalSumRub: Number(totalSum.toFixed(2)),
    counterName: recount.counterName || null,
    groupName: recount.groupName || null
  };
}

function sanitizeActiveRecount(recount) {
  return {
    id: recount.id,
    status: recount.status,
    docId: recount.docId,
    sourceFileName: recount.sourceFileName,
    storeLabel: recount.storeLabel || '',
    storeNumber: recount.storeNumber || '',
    storeAddress: recount.storeAddress || '',
    createdAt: recount.createdAt,
    updatedAt: recount.updatedAt,
    items: recount.items || [],
    values: recount.values || {},
    search: recount.search || '',
    barcodeCache: recount.barcodeCache || {}
  };
}

function findUserActiveRecount(userId) {
  return db.recounts.find(item => item.userId === userId && item.status === 'active') || null;
}

function asNumber(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRuDate(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatRuTime(dateValue) {
  const date = dateValue ? new Date(dateValue) : new Date();
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatMoney(value) {
  return `${asNumber(value).toFixed(2)} руб.`;
}

function configurePdfFont(doc) {
  const candidates = [
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial.ttf'
  ];

  const fontPath = candidates.find(path => existsSync(path));
  if (fontPath) doc.font(fontPath);
}

function drawCell(doc, x, y, width, height, text, options = {}) {
  doc.rect(x, y, width, height).stroke();
  doc.fontSize(options.fontSize || 7);
  doc.text(String(text ?? ''), x + 2, y + 2, {
    width: width - 4,
    height: height - 4,
    align: options.align || 'left'
  });
}

function buildTableRows(recount, options) {
  const rows = [];
  const values = recount.values || {};

  let plusSum = 0;
  let minusSum = 0;

  let index = 1;
  for (const item of recount.items || []) {
    const docQty = asNumber(item.docQty);
    const rawExpression = sanitizeFactExpression(values?.[item.code] ?? '');
    const fact = computeItemFact(item, values, { treatEmptyAsZero: true });
    const factNumber = fact === null ? null : asNumber(fact);
    const delta = factNumber === null ? null : factNumber - docQty;

    if (delta !== null && delta > 0) plusSum += delta * asNumber(item.price);
    if (delta !== null && delta < 0) minusSum += Math.abs(delta) * asNumber(item.price);

    rows.push({
      index,
      code: item.code,
      name: item.name,
      unit: item.unit || '',
      price: asNumber(item.price).toFixed(2),
      docQty: docQty || 0,
      fact: rawExpression || (factNumber === null ? '' : factNumber),
      delta: delta === null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`
    });

    index += 1;
  }

  return {
    rows,
    plusSum,
    minusSum,
    totalSum: plusSum - minusSum
  };
}

async function buildPdfBufferFromRecount(recount, options) {
  const doc = new PDFDocument({ margin: 20, size: 'A4' });
  const chunks = [];

  const done = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  configurePdfFont(doc);

  const includeTotalSummary = Boolean(options.includeTotalSummary);
  const completedAt = recount.completedAt || toIsoNow();
  const createdAt = recount.createdAt || toIsoNow();
  const tableData = buildTableRows(recount, options);

  doc.fontSize(12).text('Акт контрольно-ревизионной проверки по количеству и качеству', { align: 'center' });
  doc.fontSize(10).text(`от ${formatRuDate(new Date())} г.`, { align: 'center' });
  doc.moveDown(0.3);

  doc.fontSize(9).text('Проверка осуществлялась комиссией в составе:');
  doc.fontSize(9).text(String(options.counterName || '-'));
  doc.fontSize(9).text(`+ ${formatMoney(tableData.plusSum)}`);
  doc.fontSize(9).text(`- ${formatMoney(tableData.minusSum)}`);
  if (includeTotalSummary) {
    doc.fontSize(9).text(`Итого: ${formatMoney(tableData.totalSum)}`);
  }
  doc.moveDown(0.2);

  const storeLabel = recount.storeLabel || '№____ (адрес не определен)';
  doc.fontSize(9).text(`По магазину: ${storeLabel}`, { continued: true });
  doc.text(`  Просчет с ${formatRuTime(createdAt)} по ${formatRuTime(completedAt)}`, { align: 'right' });

  const tableLeft = doc.page.margins.left;
  const tableTopStart = doc.y + 6;
  const headerHeight = 16;
  const rowHeight = 12;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const columns = [
    { key: 'index', title: '№', width: 18, align: 'center' },
    { key: 'code', title: 'Код', width: 34, align: 'center' },
    { key: 'name', title: 'Товар', width: 220, align: 'left' },
    { key: 'unit', title: 'Размерность', width: 52, align: 'center' },
    { key: 'price', title: 'Цена', width: 52, align: 'right' },
    { key: 'docQty', title: 'По документам', width: 62, align: 'right' },
    { key: 'fact', title: 'Фактически', width: 62, align: 'right' },
    { key: 'delta', title: 'Расхождение', width: tableWidth - (18 + 34 + 220 + 52 + 52 + 62 + 62), align: 'right' }
  ];

  function drawHeader(y) {
    let x = tableLeft;
    for (const col of columns) {
      drawCell(doc, x, y, col.width, headerHeight, col.title, { align: 'center', fontSize: 6.5 });
      x += col.width;
    }
  }

  function drawRow(y, row) {
    let x = tableLeft;
    for (const col of columns) {
      drawCell(doc, x, y, col.width, rowHeight, row[col.key], { align: col.align, fontSize: 6.5 });
      x += col.width;
    }
  }

  let y = tableTopStart;
  drawHeader(y);
  y += headerHeight;

  for (const row of tableData.rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 80) {
      doc.addPage();
      configurePdfFont(doc);
      y = doc.page.margins.top;
      drawHeader(y);
      y += headerHeight;
    }

    drawRow(y, row);
    y += rowHeight;
  }

  doc.y = y + 8;
  doc.fontSize(9).text('Члены комиссии:');
  doc.fontSize(9).text(String(options.counterName || '-'));

  doc.end();
  return done;
}

function logEvent(level, event, vars = {}) {
  const normalizedLevel = sanitizeLogLevel(level);
  const payload = vars && typeof vars === 'object' ? vars : { value: vars };
  appendAuditLog(normalizedLevel, event, payload);

  const logger = typeof app.log?.[normalizedLevel] === 'function'
    ? app.log[normalizedLevel]
    : app.log.info;
  logger.call(app.log, { event, ...payload });
}

function logShopApiStartupConfig() {
  const summary = {
    hasShopApiUrl: Boolean(SHOP_API_URL),
    shopApiMethod: SHOP_API_METHOD,
    tokenHeader: SHOP_API_TOKEN_HEADER,
    hasAccessToken: Boolean(tokenState.accessToken),
    hasRefreshToken: Boolean(tokenState.refreshToken),
    cityId: SHOP_API_CITY_ID || null,
    shopId: SHOP_API_SHOP_ID || null
  };

  logEvent('info', 'shop-api-config', summary);
  logShopStdout('config', summary);

  if (!summary.hasShopApiUrl || !summary.hasAccessToken) {
    logEvent('warn', 'shop-api-config-missing', summary);
    logShopStdout('config-missing', summary);
  }
}

function logShopStdout(event, payload) {
  if (!SHOP_API_STDOUT_LOGS) return;
  try {
    console.log(`[SHOP_API] ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[SHOP_API] ${event}`);
  }
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDocumentLines(text) {
  const items = [];
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!/^\d+\s+\d{4,6}/.test(line)) continue;

    const match = line.match(/^(\d+)\s+(\d{4,6})\s+(.+?)\s+(\d+\*\d+)?\s+([\d.,]+)\s+(.*)$/i);
    if (!match) continue;

    const tail = match[6] || '';
    const qtyMatches = [...tail.matchAll(/(\d+)\s*шт/gi)];
    const packageMatch = tail.match(/(\d+)\s*(?:кор|упак)/i);
    const docQty = qtyMatches.length ? Number.parseInt(qtyMatches[qtyMatches.length - 1][1], 10) : null;
    const pieceQty = qtyMatches.length >= 2
      ? Number.parseInt(qtyMatches[0][1], 10)
      : qtyMatches.length === 1 ? Number.parseInt(qtyMatches[0][1], 10) : null;

    items.push({
      code: match[2],
      name: match[3].trim(),
      unit: match[4] || '',
      price: normalizeNumber(match[5]),
      docQty,
      packageQty: packageMatch ? Number.parseInt(packageMatch[1], 10) : null,
      pieceQty
    });
  }

  return items;
}

function extractRecountMeta(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const storeLine = lines.find(line => /^По\s+магазину:/i.test(line)) || '';
  const storePart = storeLine.split(/Сформировано:/i)[0] || '';
  const storeLabel = storePart.replace(/^По\s+магазину:\s*/i, '').trim();

  const storeNumberMatch = storeLabel.match(/№\s*(\d+)/i);
  const storeAddressMatch = storeLabel.match(/\(([^)]+)\)/);

  return {
    storeLabel,
    storeNumber: storeNumberMatch?.[1] || '',
    storeAddress: storeAddressMatch?.[1] || ''
  };
}

function normalizeBarcode(value) {
  return String(value || '').trim();
}

function extractArticleCode(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const direct = payload.article || payload.code || payload.sku || payload.vendorCode;
  if (direct) return String(direct).trim();

  const nested = payload.data || payload.product || payload.item || payload.result;
  if (nested && typeof nested === 'object') {
    return extractArticleCode(nested);
  }

  return null;
}

function extractArticleCodeFromLocationHeader(response) {
  const location =
    response.headers.get('location') ||
    response.headers.get('Location') ||
    response.url;
  if (!location) return null;

  try {
    const parsed = new URL(location);
    const match = parsed.pathname.match(/\/products\/(\d+)(?:\/)?$/i);
    if (match?.[1]) return match[1];

    const fallbackMatch = location.match(/\/products\/(\d+)(?:\/|\?|$)/i);
    return fallbackMatch?.[1] || null;
  } catch {
    const fallbackMatch = location.match(/\/products\/(\d+)(?:\/|\?|$)/i);
    return fallbackMatch?.[1] || null;
  }
}

function extractArticleCodeFromRedirectBody(response) {
  const body = String(response.bodyText || '');
  if (!body) return null;

  const metaRefreshMatch = body.match(/url=['"]?([^'"\s>]+)['"]?/i);
  if (metaRefreshMatch?.[1]) {
    const codeFromMeta = extractArticleCodeFromText(metaRefreshMatch[1]);
    if (codeFromMeta) return codeFromMeta;
  }

  const hrefMatch = body.match(/href=['"]([^'"]+)['"]/i);
  if (hrefMatch?.[1]) {
    const codeFromHref = extractArticleCodeFromText(hrefMatch[1]);
    if (codeFromHref) return codeFromHref;
  }

  return extractArticleCodeFromText(body);
}

function extractArticleCodeFromText(text) {
  const value = String(text || '');
  const match = value.match(/\/products\/(\d+)(?:\/|\?|$)/i);
  return match?.[1] || null;
}

function extractTokenData(payload) {
  if (!payload || typeof payload !== 'object') {
    return { accessToken: null, refreshToken: null, refreshed: false };
  }

  const accessToken = payload.accessToken || payload.access_token || payload.token || payload.jwt || payload.newToken || null;
  const refreshToken = payload.refreshToken || payload.refresh_token || payload.newRefreshToken || null;
  const refreshed = payload.refreshed_token === true || payload.refreshedToken === true;

  const nested = payload.data || payload.result || payload.auth || payload.tokens;
  if (nested && typeof nested === 'object') {
    const nestedTokens = extractTokenData(nested);
    return {
      accessToken: accessToken || nestedTokens.accessToken,
      refreshToken: refreshToken || nestedTokens.refreshToken,
      refreshed: refreshed || nestedTokens.refreshed
    };
  }

  return { accessToken, refreshToken, refreshed };
}

function hasResultRefreshedTokenFlag(payload) {
  return payload?.result?.refreshed_token === true;
}

function createHeaderReader(rawHeaders) {
  const store = new Map();
  for (const [name, value] of Object.entries(rawHeaders || {})) {
    if (Array.isArray(value)) {
      store.set(name.toLowerCase(), value.join(', '));
    } else if (value != null) {
      store.set(name.toLowerCase(), String(value));
    }
  }

  return {
    get(headerName) {
      if (!headerName) return null;
      return store.get(String(headerName).toLowerCase()) || null;
    }
  };
}

async function sendShopApiRequest(url, options = {}) {
  const parsedUrl = new URL(url);
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const bodyString = typeof options.body === 'string' ? options.body : '';

  return new Promise((resolve, reject) => {
    const req = client.request(
      parsedUrl,
      {
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      res => {
        const chunks = [];

        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => {
          const bodyText = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
          const status = Number(res.statusCode || 0);

          resolve({
            status,
            statusText: res.statusMessage || '',
            ok: status >= 200 && status < 300,
            redirected: false,
            type: 'basic',
            url,
            headers: createHeaderReader(res.headers),
            bodyText,
            async json() {
              if (!bodyText) return null;
              return JSON.parse(bodyText);
            }
          });
        });
      }
    );

    req.on('error', reject);

    if (bodyString) {
      req.write(bodyString);
    }

    req.end();
  });
}

function getHeaderToken(response, headerName) {
  if (!headerName) return null;
  const value = response.headers.get(headerName);
  if (!value) return null;
  if (value.toLowerCase().startsWith('bearer ')) {
    return value.slice(7).trim();
  }
  return value.trim();
}

function buildTokenHeaderValue(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return '';

  const prefix = String(SHOP_API_TOKEN_PREFIX || '').trim();
  if (!prefix) return token;

  if (token.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) {
    return token;
  }

  return `${prefix} ${token}`;
}

function lastTokenChars(value, size = 5) {
  const token = String(value || '').trim();
  if (!token) return null;
  return token.slice(-size);
}

function buildShopBarcodeUrl(barcode) {
  if (!SHOP_API_URL) return '';

  const encodedBarcode = encodeURIComponent(barcode);

  // If URL contains placeholder, replace it directly.
  if (SHOP_API_URL.includes('{barcode}')) {
    return SHOP_API_URL.replace('{barcode}', encodedBarcode);
  }

  // Support endpoint format: /products/barcode/{barcode}/
  let url = SHOP_API_URL;
  if (!url.includes('?')) {
    if (!url.endsWith('/')) url += '/';
    url += `${encodedBarcode}/`;
  }

  const hasQuery = url.includes('?');
  const glue = hasQuery ? '&' : '?';
  const query = [];
  if (SHOP_API_CITY_ID) query.push(`city_id=${encodeURIComponent(SHOP_API_CITY_ID)}`);
  if (SHOP_API_SHOP_ID) query.push(`shop_id=${encodeURIComponent(SHOP_API_SHOP_ID)}`);

  if (query.length > 0) {
    url += `${glue}${query.join('&')}`;
  }

  return url;
}

function updateTokenState(next) {
  const nextAccessToken = next?.accessToken ? String(next.accessToken).trim() : '';
  const nextRefreshToken = next?.refreshToken ? String(next.refreshToken).trim() : '';
  let changed = false;
  let accessChanged = false;
  let refreshChanged = false;

  if (nextAccessToken && nextAccessToken !== tokenState.accessToken) {
    tokenState.accessToken = nextAccessToken;
    changed = true;
    accessChanged = true;
  }

  if (nextRefreshToken && nextRefreshToken !== tokenState.refreshToken) {
    tokenState.refreshToken = nextRefreshToken;
    changed = true;
    refreshChanged = true;
  }

  if (changed) {
    tokenState.updatedAt = Date.now();
    logEvent('info', 'shop-api-token-state-updated', { accessChanged, refreshChanged });
  }

  return { changed, accessChanged, refreshChanged };
}

async function parseJsonResponseSafe(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getResponseBodyForLog(response, payload) {
  if (payload != null) return payload;
  const rawBody = String(response.bodyText || '').trim();
  return rawBody || null;
}

async function resolveBarcodeFromShopApi(barcode) {
  if (!SHOP_API_URL) return { resolved: false, source: 'unconfigured' };

  const url = SHOP_API_METHOD === 'GET'
    ? buildShopBarcodeUrl(barcode)
    : SHOP_API_URL;

  async function sendRequest() {
    const headers = { Accept: 'application/json' };
    if (SHOP_API_USER_AGENT) {
      headers['User-Agent'] = SHOP_API_USER_AGENT;
    }

    if (tokenState.accessToken) {
      headers[SHOP_API_TOKEN_HEADER] = buildTokenHeaderValue(tokenState.accessToken);
    }

    if (SHOP_API_REFRESH_HEADER && tokenState.refreshToken) {
      headers[SHOP_API_REFRESH_HEADER] = tokenState.refreshToken;
    }

    if (SHOP_API_METHOD === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const startedAt = Date.now();
    const requestMeta = {
      method: SHOP_API_METHOD,
      url,
      hasAccessToken: Boolean(tokenState.accessToken),
      accessTokenLast5: lastTokenChars(tokenState.accessToken),
      hasRefreshToken: Boolean(tokenState.refreshToken),
      hasBody: SHOP_API_METHOD === 'POST'
    };
    logEvent('info', 'shop-api-request', requestMeta);
    logShopStdout('request', requestMeta);

    const response = await sendShopApiRequest(url, {
      method: SHOP_API_METHOD,
      headers,
      body: SHOP_API_METHOD === 'POST' ? JSON.stringify({ barcode }) : undefined
    });

    const responseMeta = {
      method: SHOP_API_METHOD,
      url,
      status: response.status,
      durationMs: Date.now() - startedAt
    };
    logEvent('info', 'shop-api-response', responseMeta);
    logShopStdout('response', responseMeta);

    return response;
  }

  async function handleTokenUpdate(response, payload) {
    const headerAccess = getHeaderToken(response, SHOP_API_TOKEN_HEADER);
    const headerRefresh = SHOP_API_REFRESH_HEADER ? getHeaderToken(response, SHOP_API_REFRESH_HEADER) : null;
    const payloadTokens = extractTokenData(payload);
    const refreshed = hasResultRefreshedTokenFlag(payload);

    if (refreshed) {
      logEvent('info', 'shop-api-token-refreshed-flag', { refreshed: true });
      logShopStdout('token-refreshed-flag', { refreshed: true });
    }

    const stateUpdate = updateTokenState({
      accessToken: headerAccess || payloadTokens.accessToken,
      refreshToken: headerRefresh || payloadTokens.refreshToken
    });

    return {
      refreshed,
      tokenChanged: stateUpdate.changed,
      accessChanged: stateUpdate.accessChanged,
      refreshChanged: stateUpdate.refreshChanged
    };
  }

  try {
    let response = await sendRequest();
    let payload = await parseJsonResponseSafe(response);
    let tokenUpdate = await handleTokenUpdate(response, payload);

    const responseDetails = {
      method: SHOP_API_METHOD,
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || '',
      responseBody: getResponseBodyForLog(response, payload)
    };
    logEvent('info', 'shop-api-response-details', responseDetails);
    logShopStdout('response-details', responseDetails);

    // Retry once for explicit auth failure (401) or contract refresh signal in 205 response.
    const shouldRetry =
      response.status === 401 ||
      (response.status === 205 && tokenUpdate.refreshed);

    if (shouldRetry) {
      const retryReason = response.status === 401 ? '401' : '205-with-token-refresh';
      logEvent('info', 'shop-api-retry', { reason: retryReason });
      logShopStdout('retry', { reason: retryReason });

      response = await sendRequest();
      payload = await parseJsonResponseSafe(response);
      tokenUpdate = await handleTokenUpdate(response, payload);

      const retryDetails = {
        method: SHOP_API_METHOD,
        url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') || '',
        responseBody: getResponseBodyForLog(response, payload)
      };
      logEvent('info', 'shop-api-response-details-retry', retryDetails);
      logShopStdout('response-details-retry', retryDetails);
    }

    const locationCode = extractArticleCodeFromLocationHeader(response);
    const payloadCode = extractArticleCode(payload);
    const redirectBodyCode = extractArticleCodeFromRedirectBody(response);
    const code = locationCode || payloadCode || redirectBodyCode;

    if (!response.ok) {
      if (code) {
        const redirectedResolveMeta = {
          barcode,
          status: response.status,
          locationCode,
          payloadCode,
          redirectBodyCode,
          resolvedCode: code
        };
        logEvent('info', 'shop-api-resolve-result', redirectedResolveMeta);
        logShopStdout('resolve-result', redirectedResolveMeta);

        return {
          resolved: true,
          source: 'shop-api-redirect',
          code,
          payload
        };
      }

      return { resolved: false, source: 'shop-api', status: response.status };
    }

    const resolveMeta = {
      barcode,
      locationCode,
      payloadCode,
      redirectBodyCode,
      resolvedCode: code || null
    };
    logEvent('info', 'shop-api-resolve-result', resolveMeta);
    logShopStdout('resolve-result', resolveMeta);

    if (!code) {
      return { resolved: false, source: 'shop-api', payload };
    }

    return {
      resolved: true,
      source: 'shop-api',
      code,
      payload
    };
  } catch (error) {
    const errorMeta = {
      method: SHOP_API_METHOD,
      url,
      message: error instanceof Error ? error.message : String(error)
    };
    logEvent('error', 'shop-api-error', errorMeta);
    logShopStdout('error', errorMeta);
    return { resolved: false, source: 'shop-api-unreachable' };
  }
}

function buildRecountCache(items) {
  const itemByCode = {};
  const barcodeToCode = {};

  for (const item of items) {
    itemByCode[String(item.code)] = {
      code: item.code,
      name: item.name,
      unit: item.unit,
      price: item.price,
      docQty: item.docQty
    };
  }

  for (const [barcode, record] of barcodeResolutionCache.entries()) {
    if (record?.code && itemByCode[record.code]) {
      barcodeToCode[barcode] = record.code;
    }
  }

  return {
    barcodeToCode,
    itemByCode,
    builtAt: new Date().toISOString()
  };
}

async function readPdfBuffer(file) {
  const chunks = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS']
});

app.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE }
});

app.get('/health', async () => ({ ok: true }));

app.post('/api/auth/register', async (request, reply) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const login = normalizeLogin(body.login);
  const password = String(body.password || '');
  const deviceId = getDeviceIdFromRequest(request);

  if (!deviceId) {
    return reply.code(400).send({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'Не удалось определить устройство. Обновите приложение.' });
  }

  if (login.length < 3) {
    logEvent('warn', 'register-invalid-login', {
      login,
      loginLength: login.length,
      ip: getRequestIp(request)
    });
    return reply.code(400).send({ ok: false, error: 'Логин должен быть не короче 3 символов' });
  }

  if (password.length < 4) {
    logEvent('warn', 'register-invalid-password', {
      login,
      passwordLength: password.length,
      ip: getRequestIp(request)
    });
    return reply.code(400).send({ ok: false, error: 'Пароль должен быть не короче 4 символов' });
  }

  if (db.users.some(user => user.login === login)) {
    logEvent('warn', 'register-duplicate-login', {
      login,
      ip: getRequestIp(request)
    });
    return reply.code(409).send({ ok: false, error: 'Пользователь уже существует' });
  }

  const user = {
    id: createId('u'),
    login,
    passwordHash: hashPassword(password),
    createdAt: toIsoNow(),
    isAdmin: false,
    subscriptionUntil: null,
    deviceId
  };

  db.users.push(user);
  await saveDb();

  logEvent('info', 'register-success', {
    login: user.login,
    userId: user.id,
    ip: getRequestIp(request)
  });

  const token = await createSessionForUser(user, request);
  return {
    ok: true,
    token,
    tokenType: TOKEN_STORAGE_KEY,
    user: publicUser(user)
  };
});

app.post('/api/auth/login', async (request, reply) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const login = normalizeLogin(body.login);
  const password = String(body.password || '');
  const deviceId = getDeviceIdFromRequest(request);
  const user = db.users.find(item => item.login === login);

  if (!deviceId) {
    return reply.code(400).send({ ok: false, code: 'DEVICE_ID_REQUIRED', error: 'Не удалось определить устройство. Обновите приложение.' });
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    logEvent('warn', 'login-failed', {
      login,
      ip: getRequestIp(request)
    });
    return reply.code(401).send({ ok: false, error: 'Неверный логин или пароль' });
  }

  if (user.deviceId && user.deviceId !== deviceId) {
    logEvent('warn', 'login-device-mismatch', {
      actorId: user.id,
      actorLogin: user.login,
      expectedDeviceId: user.deviceId,
      gotDeviceId: deviceId,
      ip: getRequestIp(request)
    });
    return reply.code(403).send({
      ok: false,
      code: 'DEVICE_MISMATCH',
      error: 'Аккаунт уже привязан к другому устройству. Обратитесь к администратору.'
    });
  }

  if (!user.deviceId) {
    user.deviceId = deviceId;
    await saveDb();
    logEvent('info', 'device-bound-on-login', {
      actorId: user.id,
      actorLogin: user.login,
      deviceId,
      ip: getRequestIp(request)
    });
  }

  const token = await createSessionForUser(user, request);
  logEvent('info', 'login-success', {
    actorId: user.id,
    actorLogin: user.login,
    actorIsAdmin: Boolean(user.isAdmin),
    ip: getRequestIp(request)
  });
  return {
    ok: true,
    token,
    tokenType: TOKEN_STORAGE_KEY,
    user: publicUser(user)
  };
});

app.get('/api/auth/me', { preHandler: authenticate }, async request => {
  return {
    ok: true,
    user: publicUser(request.user)
  };
});

app.get('/api/admin/users', { preHandler: [authenticate, requireAdmin] }, async request => {
  const users = db.users
    .slice()
    .sort((a, b) => a.login.localeCompare(b.login))
    .map(user => {
      const status = buildSubscriptionStatus(user);
      return {
        id: user.id,
        login: user.login,
        createdAt: user.createdAt,
        isAdmin: Boolean(user.isAdmin),
        subscriptionUntil: user.subscriptionUntil || null,
        subscriptionActive: hasActiveSubscription(user),
        deviceBound: Boolean(user.deviceId),
        subscriptionStatusKey: status.key,
        subscriptionStatusLabel: status.label
      };
    });

  return {
    ok: true,
    users
  };
});

app.get('/api/admin/logs', { preHandler: [authenticate, requireAdmin] }, async request => {
  const query = request.query && typeof request.query === 'object' ? request.query : {};
  const levelRaw = String(query.level || 'all').trim().toLowerCase();
  const level = KNOWN_LOG_LEVELS.includes(levelRaw) ? levelRaw : 'all';

  const limitRaw = Number.parseInt(String(query.limit ?? 200), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(20, Math.min(limitRaw, 1000)) : 200;

  const filtered = level === 'all'
    ? auditLogs
    : auditLogs.filter(item => item.level === level);

  const entries = filtered.slice(-limit).reverse();
  const levelCounts = {
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0,
    fatal: 0
  };

  for (const item of auditLogs) {
    if (levelCounts[item.level] !== undefined) {
      levelCounts[item.level] += 1;
    }
  }

  return {
    ok: true,
    selectedLevel: level,
    total: filtered.length,
    limit,
    levelCounts,
    entries
  };
});

app.post('/api/admin/users/:id/subscription', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
  const { id } = request.params;
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const target = db.users.find(user => user.id === id);

  if (!target) {
    logEvent('warn', 'subscription-activate-user-not-found', buildRequestLogMeta(request, {
      targetUserId: id
    }));
    return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
  }

  if (target.isAdmin) {
    logEvent('warn', 'subscription-activate-admin-blocked', buildRequestLogMeta(request, {
      targetUserId: id,
      targetLogin: target.login
    }));
    return reply.code(400).send({ ok: false, error: 'Подписка для администратора не требуется' });
  }

  let nextUntil = null;
  if (typeof body.until === 'string' && body.until.trim()) {
    const parsedTs = Date.parse(body.until);
    if (Number.isNaN(parsedTs)) {
      logEvent('warn', 'subscription-activate-invalid-date', buildRequestLogMeta(request, {
        targetUserId: id,
        until: body.until
      }));
      return reply.code(400).send({ ok: false, error: 'Некорректная дата подписки' });
    }
    nextUntil = new Date(parsedTs).toISOString();
  } else {
    const daysRaw = Number.parseInt(String(body.days ?? 30), 10);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(daysRaw, 3650)) : 30;
    const nextTs = Date.now() + days * 24 * 60 * 60 * 1000;
    nextUntil = new Date(nextTs).toISOString();
  }

  target.subscriptionUntil = nextUntil;
  await saveDb();

  logEvent('info', 'subscription-activated', buildRequestLogMeta(request, {
    targetUserId: target.id,
    targetLogin: target.login,
    subscriptionUntil: nextUntil
  }));

  const status = buildSubscriptionStatus(target);
  return {
    ok: true,
    user: {
      id: target.id,
      login: target.login,
      createdAt: target.createdAt,
      isAdmin: Boolean(target.isAdmin),
      subscriptionUntil: target.subscriptionUntil,
      subscriptionActive: hasActiveSubscription(target),
      subscriptionStatusKey: status.key,
      subscriptionStatusLabel: status.label
    }
  };
});

app.post('/api/admin/users/:id/device/reset', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
  const { id } = request.params;
  const target = db.users.find(user => user.id === id);

  if (!target) {
    return reply.code(404).send({ ok: false, error: 'Пользователь не найден' });
  }

  target.deviceId = null;

  const removedTokens = [];
  for (const [token, session] of sessions.entries()) {
    if (session?.userId === target.id) {
      removedTokens.push(token);
      sessions.delete(token);
    }
  }

  db.sessions = (Array.isArray(db.sessions) ? db.sessions : [])
    .filter(session => session.userId !== target.id);

  await saveDb();

  logEvent('warn', 'admin-reset-device-binding', buildRequestLogMeta(request, {
    targetUserId: target.id,
    targetLogin: target.login,
    removedSessions: removedTokens.length
  }));

  return {
    ok: true,
    user: publicUser(target)
  };
});

app.post('/api/auth/logout', { preHandler: authenticate }, async request => {
  logEvent('info', 'logout', buildRequestLogMeta(request));
  if (request.authToken) {
    await revokeSessionByToken(request.authToken);
  }

  return { ok: true };
});

app.get('/api/recounts', { preHandler: [authenticate, requireServiceAccess] }, async request => {
  const userId = request.user.id;
  const userRecounts = db.recounts.filter(item => item.userId === userId);
  const active = userRecounts.find(item => item.status === 'active') || null;
  const previous = userRecounts
    .filter(item => item.status !== 'active')
    .sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
    .map(buildRecountSummary);

  return {
    ok: true,
    active: active ? buildRecountSummary(active) : null,
    previous
  };
});

app.get('/api/recounts/:id', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const { id } = request.params;
  const recount = db.recounts.find(item => item.id === id && item.userId === request.user.id);

  if (!recount) {
    logEvent('warn', 'recount-open-not-found', buildRequestLogMeta(request, { recountId: id }));
    return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
  }

  return {
    ok: true,
    recount: sanitizeActiveRecount(recount)
  };
});

app.post('/api/recounts/:id/reopen', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const { id } = request.params;
  const recount = db.recounts.find(item => item.id === id && item.userId === request.user.id);

  if (!recount) {
    logEvent('warn', 'recount-reopen-not-found', buildRequestLogMeta(request, { recountId: id }));
    return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
  }

  if (recount.status === 'active') {
    return {
      ok: true,
      recount: sanitizeActiveRecount(recount)
    };
  }

  const active = findUserActiveRecount(request.user.id);
  if (active && active.id !== recount.id) {
    logEvent('warn', 'recount-reopen-blocked-active-exists', buildRequestLogMeta(request, {
      recountId: id,
      activeRecountId: active.id
    }));
    return reply.code(409).send({ ok: false, error: 'Сначала завершите или закройте текущий активный просчет' });
  }

  recount.status = 'active';
  recount.completedAt = null;
  recount.updatedAt = toIsoNow();
  await saveDb();

  logEvent('info', 'recount-reopen-success', buildRequestLogMeta(request, {
    recountId: recount.id,
    docId: recount.docId
  }));

  return {
    ok: true,
    recount: sanitizeActiveRecount(recount)
  };
});

app.post('/api/recounts/from-pdf', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const active = findUserActiveRecount(request.user.id);
  if (active) {
    logEvent('warn', 'recount-create-blocked-active-exists', buildRequestLogMeta(request, {
      activeRecountId: active.id
    }));
    return reply.code(409).send({ ok: false, error: 'У вас уже есть активный просчет' });
  }

  const file = await request.file();
  if (!file) {
    logEvent('warn', 'recount-create-missing-file', buildRequestLogMeta(request));
    return reply.code(400).send({ ok: false, error: 'PDF file is required' });
  }

  const isPdfMime = file.mimetype === 'application/pdf';
  const isPdfName = file.filename?.toLowerCase().endsWith('.pdf');
  if (!isPdfMime && !isPdfName) {
    logEvent('warn', 'recount-create-invalid-file-type', buildRequestLogMeta(request, {
      fileName: file.filename,
      mimeType: file.mimetype
    }));
    return reply.code(400).send({ ok: false, error: 'Only PDF files are supported' });
  }

  const buffer = await readPdfBuffer(file);
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  await parser.destroy();

  const items = parseDocumentLines(textResult.text);
  const meta = extractRecountMeta(textResult.text);
  const recount = {
    id: createId('r'),
    userId: request.user.id,
    status: 'active',
    docId: `loc_${new Date().toISOString().slice(0, 10)}_${randomBytes(2).toString('hex')}`,
    sourceFileName: file.filename,
    storeLabel: meta.storeLabel,
    storeNumber: meta.storeNumber,
    storeAddress: meta.storeAddress,
    createdAt: toIsoNow(),
    updatedAt: toIsoNow(),
    completedAt: null,
    items,
    values: {},
    search: '',
    barcodeCache: {},
    counterName: null,
    groupName: null
  };

  db.recounts.push(recount);
  await saveDb();

  logEvent('info', 'recount-create-success', buildRequestLogMeta(request, {
    recountId: recount.id,
    docId: recount.docId,
    sourceFileName: recount.sourceFileName,
    itemsCount: recount.items.length
  }));

  return {
    ok: true,
    recount: sanitizeActiveRecount(recount)
  };
});

app.post('/api/recounts/:id/progress', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const { id } = request.params;
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const recount = db.recounts.find(item => item.id === id && item.userId === request.user.id);

  if (!recount) {
    logEvent('warn', 'recount-progress-not-found', buildRequestLogMeta(request, { recountId: id }));
    return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
  }

  if (recount.status !== 'active') {
    logEvent('warn', 'recount-progress-completed', buildRequestLogMeta(request, {
      recountId: recount.id,
      status: recount.status
    }));
    return reply.code(409).send({ ok: false, error: 'Просчет уже завершен' });
  }

  if (body.values && typeof body.values === 'object') {
    const normalizedValues = {};
    for (const [key, value] of Object.entries(body.values)) {
      normalizedValues[String(key)] = sanitizeFactExpression(value);
    }
    recount.values = normalizedValues;
  }

  if (typeof body.search === 'string') {
    recount.search = body.search;
  }

  if (body.barcodeCache && typeof body.barcodeCache === 'object') {
    recount.barcodeCache = body.barcodeCache;
  }

  const nowTs = Date.now();
  const lastSaveTs = Date.parse(recount.updatedAt || recount.createdAt || toIsoNow());
  if (!Number.isNaN(lastSaveTs) && nowTs - lastSaveTs < AUTOSAVE_MIN_INTERVAL_MS) {
    return {
      ok: true,
      recount: sanitizeActiveRecount(recount)
    };
  }

  recount.updatedAt = toIsoNow();
  await saveDb();

  return {
    ok: true,
    recount: sanitizeActiveRecount(recount)
  };
});

app.post('/api/recounts/:id/complete', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const { id } = request.params;
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const counterName = String(body.counterName || '').trim();
  const groupName = String(body.groupName || '').trim();
  const includeTotalSummary = Boolean(body.includeTotalSummary);

  if (!counterName || !groupName) {
    logEvent('warn', 'recount-complete-missing-fields', buildRequestLogMeta(request, {
      recountId: id,
      hasCounterName: Boolean(counterName),
      hasGroupName: Boolean(groupName)
    }));
    return reply.code(400).send({ ok: false, error: 'Укажите просчитывающего и товарную группу' });
  }

  const recount = db.recounts.find(item => item.id === id && item.userId === request.user.id);
  if (!recount) {
    logEvent('warn', 'recount-complete-not-found', buildRequestLogMeta(request, { recountId: id }));
    return reply.code(404).send({ ok: false, error: 'Просчет не найден' });
  }

  if (recount.status !== 'active') {
    logEvent('warn', 'recount-complete-already-completed', buildRequestLogMeta(request, {
      recountId: recount.id,
      status: recount.status
    }));
    return reply.code(409).send({ ok: false, error: 'Просчет уже завершен' });
  }

  if (body.values && typeof body.values === 'object') {
    const normalizedValues = {};
    for (const [key, value] of Object.entries(body.values)) {
      normalizedValues[String(key)] = sanitizeFactExpression(value);
    }
    recount.values = normalizedValues;
  }

  if (typeof body.search === 'string') {
    recount.search = body.search;
  }

  if (body.barcodeCache && typeof body.barcodeCache === 'object') {
    recount.barcodeCache = body.barcodeCache;
  }

  recount.counterName = counterName;
  recount.groupName = groupName;
  recount.status = 'completed';
  recount.completedAt = toIsoNow();
  recount.updatedAt = toIsoNow();
  await saveDb();

  logEvent('info', 'recount-complete-success', buildRequestLogMeta(request, {
    recountId: recount.id,
    docId: recount.docId,
    counterName,
    groupName,
    includeTotalSummary
  }));

  const pdfBuffer = await buildPdfBufferFromRecount(recount, {
    counterName,
    groupName,
    includeTotalSummary
  });

  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `attachment; filename="recount_${recount.docId || recount.id}.pdf"`);
  return reply.send(pdfBuffer);
});

app.post('/api/recount/resolve-barcode', { preHandler: [authenticate, requireServiceAccess] }, async (request, reply) => {
  const body = request.body && typeof request.body === 'object' ? request.body : {};
  const barcode = normalizeBarcode(body.barcode);
  const itemCodes = Array.isArray(body.itemCodes) ? body.itemCodes.map(code => String(code)) : [];

  const requestMeta = {
    barcode,
    itemCodesCount: itemCodes.length,
    hasShopApiUrl: Boolean(SHOP_API_URL),
    hasAccessToken: Boolean(tokenState.accessToken)
  };
  logEvent('info', 'resolve-barcode-request', requestMeta);
  logShopStdout('resolve-barcode-request', requestMeta);

  if (!barcode) {
    logEvent('warn', 'resolve-barcode-invalid', { reason: 'empty-barcode' });
    return reply.code(400).send({ ok: false, error: 'barcode is required' });
  }

  const cached = barcodeResolutionCache.get(barcode);
  if (cached) {
    logEvent('info', 'resolve-barcode-cache-hit', {
      barcode,
      code: cached.code,
      source: cached.source || 'cache'
    });

    return {
      ok: true,
      resolved: true,
      fromCache: true,
      barcode,
      code: cached.code,
      source: cached.source || 'cache',
      product: cached.product || null
    };
  }

  logEvent('info', 'resolve-barcode-cache-miss', { barcode });

  const shopResult = await resolveBarcodeFromShopApi(barcode);
  if (shopResult.resolved && shopResult.code) {
    const code = String(shopResult.code);
    const product = shopResult.payload?.product || shopResult.payload?.item || null;
    barcodeResolutionCache.set(barcode, {
      code,
      source: shopResult.source,
      product,
      updatedAt: Date.now()
    });

    logEvent('info', 'resolve-barcode-shop-success', {
      barcode,
      code,
      source: shopResult.source
    });

    return {
      ok: true,
      resolved: true,
      fromCache: false,
      barcode,
      code,
      source: shopResult.source,
      product
    };
  }

  // Fallback: for cases where barcode and article are identical in a document.
  if (itemCodes.includes(barcode)) {
    barcodeResolutionCache.set(barcode, {
      code: barcode,
      source: 'item-code-fallback',
      product: null,
      updatedAt: Date.now()
    });

    logEvent('info', 'resolve-barcode-fallback', {
      barcode,
      code: barcode
    });

    return {
      ok: true,
      resolved: true,
      fromCache: false,
      barcode,
      code: barcode,
      source: 'item-code-fallback',
      product: null
    };
  }

  logEvent('warn', 'resolve-barcode-not-found', {
    barcode,
    source: shopResult.source || 'not-found',
    status: shopResult.status || null
  });

  return {
    ok: true,
    resolved: false,
    fromCache: false,
    barcode,
    code: null,
    source: shopResult.source || 'not-found',
    product: null
  };
});

app.post('/api/recount/parse-pdf', { preHandler: authenticate }, async (request, reply) => {
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({ ok: false, error: 'PDF file is required' });
  }

  const isPdfMime = file.mimetype === 'application/pdf';
  const isPdfName = file.filename?.toLowerCase().endsWith('.pdf');
  if (!isPdfMime && !isPdfName) {
    return reply.code(400).send({ ok: false, error: 'Only PDF files are supported' });
  }

  const buffer = await readPdfBuffer(file);
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  await parser.destroy();

  const items = parseDocumentLines(textResult.text);
  const docId = `loc_${new Date().toISOString().slice(0, 10)}`;

  return {
    ok: true,
    docId,
    sourceFileName: file.filename,
    pages: textResult.total || textResult.pages?.length || null,
    items,
    summary: {
      totalItems: items.length,
      textLength: textResult.text?.length || 0
    },
    cache: buildRecountCache(items),
    warnings: items.length === 0 ? ['No items were parsed from the PDF text'] : []
  };
});

async function startServer() {
  await loadDb();
  logShopApiStartupConfig();
  await app.listen({ port: Number(process.env.PORT || 3000), host: '0.0.0.0' });
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
