import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { PDFParse } from 'pdf-parse';
import { sanitizeFactExpression as sanitizeFactExpressionUtil, sumFactExpression as sumFactExpressionUtil } from '../shared/recount-utils.js';
import { randomBytes } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { config } from './config/env.js';
import { createBarcodeCacheStore } from './db/barcode-cache-store.js';
import { createPatchNotesStore } from './db/patchnotes-store.js';
import { createJsonStore } from './db/json-store.js';
import { createAuditLogService } from './services/audit-log-service.js';
import { createPatchNotesService } from './services/patchnotes-service.js';
import { createUsersService } from './services/users-service.js';
import { createRecountService } from './services/recount-service.js';
import { createReferralService } from './services/referral-service.js';
import { createShopApiService } from './services/shop-api-service.js';
import { createTsdBotService } from './services/tsd-bot-service.js';
import { configurePdfFont } from './pdf/fonts.js';
import { buildTableRows, drawCell } from './pdf/table.js';
import { createPdfService } from './services/pdf-service.js';
import healthRoutes from './routes/health.js';
import { createAuthRoutes } from './routes/auth.js';
import { createAccountRoutes } from './routes/account.js';
import { createAdminRoutes } from './routes/admin.js';
import { createBarcodeRoutes } from './routes/barcode.js';
import { createPatchNotesRoutes } from './routes/patchnotes.js';
import { createRecountRoutes } from './routes/recounts.js';
import { createReferralRoutes } from './routes/referrals.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { createSessionManager } from './auth/sessions.js';
import { createAuthMiddleware } from './auth/middleware.js';
import { toIsoNow, formatRuDate, formatRuTime } from './utils/dates.js';
import { asNumber, normalizeNumber, formatMoney } from './utils/numbers.js';
import { getDeviceIdFromRequest, getRequestIp, normalizeDeviceId, normalizeLogin } from './utils/request.js';
import { clipLogString, sanitizeLogLevel, sanitizeLogMeta } from './utils/logging.js';
import { parseDocumentLines, extractRecountMeta } from '../shared/recount-parser.js';

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

PDFParse.setWorker('pdfjs-dist/legacy/build/pdf.worker.min.mjs');

const {
  maxFileSize: MAX_FILE_SIZE,
  autosaveMinIntervalMs: AUTOSAVE_MIN_INTERVAL_MS,
  tokenStorageKey: TOKEN_STORAGE_KEY,
  adminLogin: ADMIN_LOGIN,
  adminPassword: ADMIN_PASSWORD,
  maxAuditLogs: MAX_AUDIT_LOGS,
  knownLogLevels: KNOWN_LOG_LEVELS,
  sessionTtlMs: SESSION_TTL_MS,
  dataFileUrl: DATA_FILE_URL,
  barcodeCacheFileUrl: BARCODE_CACHE_FILE_URL,
  patchNotesFileUrl: PATCH_NOTES_FILE_URL,
  port: SERVER_PORT,
  shopApi: {
    url: SHOP_API_URL,
    method: SHOP_API_METHOD,
    tokenHeader: SHOP_API_TOKEN_HEADER,
    refreshHeader: SHOP_API_REFRESH_HEADER,
    tokenPrefix: SHOP_API_TOKEN_PREFIX,
    userAgent: SHOP_API_USER_AGENT,
    cityId: SHOP_API_CITY_ID,
    shopId: SHOP_API_SHOP_ID,
    stdoutLogs: SHOP_API_STDOUT_LOGS,
    accessToken: SHOP_API_ACCESS_TOKEN,
    refreshToken: SHOP_API_REFRESH_TOKEN
  }
} = config;
const barcodeResolutionCache = new Map();
const patchNotesState = { items: [] };

const db = {
  users: [],
  recounts: [],
  sessions: [],
  settings: {},
  referrals: {
    codes: [],
    activations: []
  }
};

const sessions = new Map();
let usersService;
const ensureAdminUser = () => usersService.ensureAdminUser();
const hasActiveSubscription = user => usersService.hasActiveSubscription(user);
const buildSubscriptionStatus = user => usersService.buildSubscriptionStatus(user);
const publicUser = user => usersService.publicUser(user);
const getSupportLinks = () => usersService.getSupportLinks();

const normalizeSession = item => ({
  token: String(item?.token || '').trim(),
  userId: String(item?.userId || '').trim(),
  createdAt: item?.createdAt ? String(item.createdAt) : toIsoNow(),
  updatedAt: item?.updatedAt ? String(item.updatedAt) : toIsoNow(),
  expiresAt: item?.expiresAt ? String(item.expiresAt) : new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  ip: item?.ip ? clipLogString(item.ip, 120) : null,
  userAgent: item?.userAgent ? clipLogString(item.userAgent, 240) : null,
  deviceId: item?.deviceId ? normalizeDeviceId(item.deviceId) : null
});

const auditLogService = createAuditLogService({
  logger: app.log,
  maxAuditLogs: MAX_AUDIT_LOGS,
  knownLogLevels: KNOWN_LOG_LEVELS,
  createId,
  toIsoNow,
  sanitizeLogLevel,
  sanitizeLogMeta,
  getRequestIp,
  shopApiStdoutLogs: SHOP_API_STDOUT_LOGS
});
const {
  appendAuditLog,
  buildRequestLogMeta,
  logEvent,
  logShopStdout,
  getLogs
} = auditLogService;

const tokenState = {
  accessToken: SHOP_API_ACCESS_TOKEN,
  refreshToken: SHOP_API_REFRESH_TOKEN,
  updatedAt: Date.now()
};

const databaseStore = createJsonStore({
  fileUrl: DATA_FILE_URL,
  normalizeUser: user => ({
    ...user,
    login: normalizeLogin(user.login),
    isAdmin: Boolean(user.isAdmin || normalizeLogin(user.login) === ADMIN_LOGIN),
    securityRole: Boolean(user.securityRole),
    subscriptionUntil: user.subscriptionUntil ? String(user.subscriptionUntil) : null,
    deviceId: user?.deviceId ? normalizeDeviceId(user.deviceId) : null,
    referralUsedAt: user?.referralUsedAt ? String(user.referralUsedAt) : null,
    referralActivationId: user?.referralActivationId ? String(user.referralActivationId) : null
  }),
  normalizeSession,
  onLoad: state => {
    if (!state.referrals || typeof state.referrals !== 'object') {
      state.referrals = { codes: [], activations: [] };
    }
    if (!Array.isArray(state.referrals.codes)) state.referrals.codes = [];
    if (!Array.isArray(state.referrals.activations)) state.referrals.activations = [];

    if (state.settings.shopApiAccessToken) {
      tokenState.accessToken = String(state.settings.shopApiAccessToken).trim();
    }
    if (state.settings.shopApiRefreshToken) {
      tokenState.refreshToken = String(state.settings.shopApiRefreshToken).trim();
    }
    return ensureAdminUser() || hydrateSessionsFromDb();
  },
  onReset: state => {
    state.referrals = { codes: [], activations: [] };
    ensureAdminUser();
    hydrateSessionsFromDb();
  }
});

const barcodeCacheStore = createBarcodeCacheStore({
  fileUrl: BARCODE_CACHE_FILE_URL,
  cache: barcodeResolutionCache,
  onError: error => logEvent('error', 'barcode-cache-save-failed', { message: error?.message || String(error) })
});

function normalizePatchNoteRecord(note) {
  const dateRaw = String(note?.date || '').trim();
  const parsedDate = new Date(dateRaw);
  const date = Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10);
  const title = String(note?.title || '').trim().slice(0, 160);
  const text = String(note?.text || '').trim().slice(0, 12000);
  const id = String(note?.id || createId('pn')).trim();
  const createdAt = String(note?.createdAt || toIsoNow());
  const updatedAt = String(note?.updatedAt || toIsoNow());
  if (!id || !date || !title || !text) return null;
  return { id, date, title, text, createdAt, updatedAt };
}

const patchNotesStore = createPatchNotesStore({
  fileUrl: PATCH_NOTES_FILE_URL,
  normalizePatchNote: normalizePatchNoteRecord
});

const shopApiService = createShopApiService({
  shopApi: {
    url: SHOP_API_URL,
    method: SHOP_API_METHOD,
    tokenHeader: SHOP_API_TOKEN_HEADER,
    refreshHeader: SHOP_API_REFRESH_HEADER,
    tokenPrefix: SHOP_API_TOKEN_PREFIX,
    userAgent: SHOP_API_USER_AGENT,
    cityId: SHOP_API_CITY_ID,
    shopId: SHOP_API_SHOP_ID
  },
  tokenState,
  onTokenUpdate: async ({ accessToken, refreshToken }) => {
    let changed = false;
    if (accessToken !== undefined && db.settings.shopApiAccessToken !== accessToken) {
      db.settings.shopApiAccessToken = accessToken;
      changed = true;
    }
    if (refreshToken !== undefined && db.settings.shopApiRefreshToken !== refreshToken) {
      db.settings.shopApiRefreshToken = refreshToken;
      changed = true;
    }
    if (changed) {
      try {
        await databaseStore.save(db);
      } catch (err) {
        logEvent('error', 'shop-api-token-save-failed', { message: err?.message || String(err) });
      }
    }
  },
  cache: barcodeResolutionCache,
  persistCache: () => barcodeCacheStore.persist(),
  logEvent,
  logShopStdout
});

const patchNotesService = createPatchNotesService({
  state: patchNotesState,
  savePatchNotes: items => patchNotesStore.save(items),
  createId,
  toIsoNow
});

const tsdBotService = createTsdBotService({
  config: { ...config.tsd, environment: config.environment },
  logEvent
});

const pdfService = createPdfService({
  configurePdfFont,
  drawCell,
  buildTableRows,
  asNumber,
  sanitizeFactExpression,
  sumFactExpression,
  toIsoNow,
  formatRuDate,
  formatRuTime,
  formatMoney
});

function createId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

const loadDb = () => databaseStore.load(db);
const saveDb = () => databaseStore.save(db);
const loadBarcodeResolutionCache = () => barcodeCacheStore.load();
const persistBarcodeResolutionCache = () => barcodeCacheStore.persist();
const loadPatchNotes = async () => {
  patchNotesState.items = await patchNotesStore.load();
};

let sessionManager;
const hydrateSessionsFromDb = () => sessionManager.hydrateFromDb();

sessionManager = createSessionManager({
  db,
  sessions,
  sessionTtlMs: SESSION_TTL_MS,
  saveDb,
  toIsoNow,
  normalizeSession,
  getDeviceIdFromRequest,
  getRequestIp,
  clipLogString
});

usersService = createUsersService({
  db,
  adminLogin: ADMIN_LOGIN,
  adminPassword: ADMIN_PASSWORD,
  hashPassword,
  verifyPassword,
  normalizeLogin,
  createId,
  toIsoNow,
  formatRuDate
});

const referralService = createReferralService({
  db,
  saveDb,
  usersService,
  createId,
  toIsoNow,
  randomBytes,
  logEvent
});
referralService.ensureReferralState();

const authMiddleware = createAuthMiddleware({
  db,
  sessionManager,
  usersService,
  getDeviceIdFromRequest,
  getRequestIp,
  logEvent,
  buildRequestLogMeta
});
const { getTokenFromRequest, authenticate, requireServiceAccess, requireAdmin } = authMiddleware;

const recountService = createRecountService({
  db,
  saveDb,
  createId,
  createDocId: () => `loc_${new Date().toISOString().slice(0, 10)}_${randomBytes(2).toString('hex')}`,
  toIsoNow,
  sanitizeFactExpression,
  sumFactExpression,
  asNumber,
  parseDocumentLines,
  extractRecountMeta
});

function sanitizeFactExpression(value) {
  return sanitizeFactExpressionUtil(value);
}

function sumFactExpression(value) {
  return sumFactExpressionUtil(value);
}

function computeItemFact(item, values, options = {}) {
  return recountService.computeItemFact(item, values, options);
}

function buildRecountSummary(recount) {
  return recountService.buildSummary(recount);
}

function sanitizeActiveRecount(recount) {
  return recountService.sanitize(recount);
}

function findUserActiveRecount(userId) {
  return recountService.findActive(userId);
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

const startTsdBotProcess = () => tsdBotService.start();
const stopTsdBotProcess = () => tsdBotService.stop();

async function readPdfBuffer(file) {
  const chunks = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

app.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE }
});

app.register(healthRoutes);
app.register(createAuthRoutes({
  db,
  normalizeLogin,
  getDeviceIdFromRequest,
  getRequestIp,
  logEvent,
  createId,
  hashPassword,
  verifyPassword,
  toIsoNow,
  saveDb,
  sessionManager,
  tokenStorageKey: TOKEN_STORAGE_KEY,
  publicUser,
  authenticate,
  buildRequestLogMeta,
  referralService
}));
app.register(createAccountRoutes({
  authenticate,
  saveDb,
  logEvent,
  buildRequestLogMeta,
  publicUser
}));
app.register(createAdminRoutes({
  db,
  authenticate,
  requireAdmin,
  publicUser,
  buildSubscriptionStatus,
  hasActiveSubscription,
  saveDb,
  logEvent,
  buildRequestLogMeta,
  getLogs,
  tokenState,
  shopApiService,
  sessions,
  getSupportLinks,
  referralService
}));
app.register(createReferralRoutes({
  authenticate,
  referralService,
  getRequestIp,
  buildRequestLogMeta,
  logEvent,
  shopApiService
}));
app.register(createBarcodeRoutes({
  authenticate,
  requireServiceAccess,
  db,
  shopApiService,
  shopApiUrl: SHOP_API_URL,
  shopApiTokenState: { accessToken: tokenState.accessToken, get cache() { return shopApiService.cache; } },
  shopIdFallback: SHOP_API_SHOP_ID,
  logEvent,
  logShopStdout,
  buildRequestLogMeta
}));
app.register(createPatchNotesRoutes({
  authenticate,
  requireAdmin,
  patchNotesService,
  logEvent,
  buildRequestLogMeta
}));
app.register(createRecountRoutes({
  authenticate,
  requireServiceAccess,
  db,
  recountService,
  buildRecountSummary,
  sanitizeActiveRecount,
  findUserActiveRecount,
  saveDb,
  logEvent,
  buildRequestLogMeta,
  autosaveMinIntervalMs: AUTOSAVE_MIN_INTERVAL_MS,
  readPdfBuffer,
  PDFParse,
  buildPdfBufferFromRecount: pdfService.buildPdfBufferFromRecount,
  parseDocumentLines,
  shopApiService
}));

export async function initializeServer() {
  await loadDb();
  await loadBarcodeResolutionCache();
  await loadPatchNotes();
  logShopApiStartupConfig();
}

export async function startServer() {
  await initializeServer();
  await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
  startTsdBotProcess();
}

for (const signal of ['SIGINT', 'SIGTERM', 'exit']) {
  process.on(signal, () => {
    stopTsdBotProcess();
  });
}

export { app };

if (config.nodeEnvironment !== 'test') {
  startServer().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
