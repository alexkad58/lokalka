import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDirectory = path.resolve(serverDirectory, '..');
const environment = { ...process.env };

function readString(name, fallback = '') {
  const value = environment[name];
  return value === undefined || value === null ? fallback : String(value);
}

function readInteger(name, fallback) {
  const parsed = Number.parseInt(readString(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveFileUrl(environmentName, fallbackFileName) {
  const configuredPath = readString(environmentName).trim();
  return configuredPath
    ? pathToFileURL(path.resolve(configuredPath))
    : new URL(`../${fallbackFileName}`, import.meta.url);
}

const sessionTtlDays = Math.max(1, readInteger('SESSION_TTL_DAYS', 30));

export const config = {
  environment,
  nodeEnvironment: readString('NODE_ENV', 'development'),
  port: readInteger('PORT', 3000),
  maxFileSize: 50 * 1024 * 1024,
  autosaveMinIntervalMs: 3000,
  tokenStorageKey: 'bearer',
  adminLogin: normalizeLogin(readString('ADMIN_LOGIN', 'admin')),
  adminPassword: readString('ADMIN_PASSWORD', 'admin'),
  maxAuditLogs: readInteger('MAX_AUDIT_LOGS', 2000),
  knownLogLevels: ['all', 'error', 'warn', 'info', 'debug', 'trace', 'fatal'],
  sessionTtlDays,
  sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
  dataFileUrl: resolveFileUrl('LOKALKA_DATA_FILE', 'storage.json'),
  barcodeCacheFileUrl: resolveFileUrl('LOKALKA_BARCODE_CACHE_FILE', 'barcode-cache.json'),
  shopApi: {
    url: readString('SHOP_API_URL'),
    method: readString('SHOP_API_METHOD', 'GET').toUpperCase(),
    tokenHeader: readString('SHOP_API_TOKEN_HEADER', 'Authorization'),
    refreshHeader: readString('SHOP_API_REFRESH_HEADER'),
    tokenPrefix: readString('SHOP_API_TOKEN_PREFIX', 'Bearer'),
    userAgent: readString('SHOP_API_USER_AGENT'),
    cityId: readString('SHOP_API_CITY_ID'),
    shopId: readString('SHOP_API_SHOP_ID'),
    stdoutLogs: readString('SHOP_API_STDOUT_LOGS') === '1',
    accessToken: readString('SHOP_API_TOKEN'),
    refreshToken: readString('SHOP_API_REFRESH_TOKEN')
  },
  tsd: {
    enabled: readString('TSD_BOT_ENABLED', '1') !== '0',
    proxy: readString('TSD_PROXY').trim(),
    telegramToken: readString('TG_TOKEN'),
    fallbackToken: readString('TOKEN'),
    entryFile: path.resolve(projectDirectory, 'tsd', 'index.js'),
    workingDirectory: projectDirectory
  }
};
