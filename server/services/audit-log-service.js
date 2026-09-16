export function createAuditLogService({
  logger,
  maxAuditLogs,
  knownLogLevels,
  createId,
  toIsoNow,
  sanitizeLogLevel,
  sanitizeLogMeta,
  getRequestIp,
  shopApiStdoutLogs,
  stdout = console
}) {
  const auditLogs = [];

  function getAuditLogGroup(event) {
    const normalizedEvent = String(event || '').toLowerCase();
    if (
      normalizedEvent.startsWith('shop-api-')
      || normalizedEvent.startsWith('resolve-barcode-')
      || normalizedEvent.startsWith('bind-barcode-')
    ) {
      return 'scanner';
    }
    if (normalizedEvent.startsWith('recount-')) return 'recount';
    if (normalizedEvent.startsWith('admin-') || normalizedEvent.startsWith('subscription-')) return 'admin';
    if (
      normalizedEvent.startsWith('login-')
      || normalizedEvent.startsWith('logout')
      || normalizedEvent.startsWith('register-')
      || normalizedEvent.startsWith('session-')
      || normalizedEvent.startsWith('auth-')
      || normalizedEvent.startsWith('device-')
    ) {
      return 'auth';
    }
    return 'other';
  }

  function getAuditLogActorKey(entry) {
    return entry?.actorId || entry?.actorLogin || '__system__';
  }

  function appendAuditLog(level, event, vars = {}) {
    const meta = sanitizeLogMeta(vars);
    const entry = {
      id: createId('log'),
      ts: toIsoNow(),
      level,
      event: String(event || 'unknown-event'),
      group: getAuditLogGroup(event),
      actorLogin: typeof meta.actorLogin === 'string' ? meta.actorLogin : null,
      actorId: typeof meta.actorId === 'string' ? meta.actorId : null,
      path: typeof meta.path === 'string' ? meta.path : null,
      method: typeof meta.method === 'string' ? meta.method : null,
      ip: typeof meta.ip === 'string' ? meta.ip : null,
      meta
    };

    auditLogs.push(entry);

    const maxSize = Number.isFinite(maxAuditLogs) && maxAuditLogs > 100
      ? maxAuditLogs
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

  function logEvent(level, event, vars = {}) {
    const normalizedLevel = sanitizeLogLevel(level, knownLogLevels);
    const payload = vars && typeof vars === 'object' ? vars : { value: vars };
    appendAuditLog(normalizedLevel, event, payload);

    const logMethod = typeof logger?.[normalizedLevel] === 'function'
      ? logger[normalizedLevel]
      : logger?.info;
    logMethod?.call(logger, { event, ...payload });
  }

  function logShopStdout(event, payload) {
    if (!shopApiStdoutLogs) return;
    try {
      stdout.log(`[SHOP_API] ${event} ${JSON.stringify(payload)}`);
    } catch {
      stdout.log(`[SHOP_API] ${event}`);
    }
  }

  function parseActorKeys(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.map(String).map(item => item.trim()).filter(Boolean);
    return String(rawValue || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function getLogs(levelRaw = 'all', limitRaw = 200, groupRaw = 'all', actorKeysRaw = '') {
    const normalizedLevel = String(levelRaw || 'all').trim().toLowerCase();
    const level = knownLogLevels.includes(normalizedLevel) ? normalizedLevel : 'all';
    const normalizedGroup = String(groupRaw || 'all').trim().toLowerCase();
    const group = ['all', 'scanner', 'recount', 'admin', 'auth', 'other'].includes(normalizedGroup)
      ? normalizedGroup
      : 'all';
    const actorKeys = parseActorKeys(actorKeysRaw);
    const actorKeySet = new Set(actorKeys);
    const parsedLimit = Number.parseInt(String(limitRaw ?? 200), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(20, Math.min(parsedLimit, 1000)) : 200;
    const filtered = auditLogs.filter(item => {
      if (level !== 'all' && item.level !== level) return false;
      if (group !== 'all' && item.group !== group) return false;
      if (actorKeySet.size > 0 && !actorKeySet.has(getAuditLogActorKey(item))) return false;
      return true;
    });
    const entries = filtered.slice(-limit).reverse();
    const levelCounts = {
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      trace: 0,
      fatal: 0
    };
    const groupCounts = {
      scanner: 0,
      recount: 0,
      admin: 0,
      auth: 0,
      other: 0
    };
    const actorMap = new Map();

    for (const item of auditLogs) {
      if (levelCounts[item.level] !== undefined) {
        levelCounts[item.level] += 1;
      }
      if (groupCounts[item.group] !== undefined) {
        groupCounts[item.group] += 1;
      }
      const actorKey = getAuditLogActorKey(item);
      const actor = actorMap.get(actorKey) || {
        key: actorKey,
        login: item.actorLogin || 'система',
        id: item.actorId || null,
        isSystem: actorKey === '__system__',
        count: 0
      };
      actor.count += 1;
      actorMap.set(actorKey, actor);
    }

    return {
      selectedLevel: level,
      selectedGroup: group,
      selectedActorKeys: actorKeys,
      total: filtered.length,
      limit,
      levelCounts,
      groupCounts,
      users: Array.from(actorMap.values()).sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
        return a.login.localeCompare(b.login, 'ru');
      }),
      entries
    };
  }

  return {
    appendAuditLog,
    buildRequestLogMeta,
    logEvent,
    logShopStdout,
    getLogs
  };
}
