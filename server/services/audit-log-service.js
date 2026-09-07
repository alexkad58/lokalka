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

  function getLogs(levelRaw = 'all', limitRaw = 200) {
    const normalizedLevel = String(levelRaw || 'all').trim().toLowerCase();
    const level = knownLogLevels.includes(normalizedLevel) ? normalizedLevel : 'all';
    const parsedLimit = Number.parseInt(String(limitRaw ?? 200), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(20, Math.min(parsedLimit, 1000)) : 200;
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
      selectedLevel: level,
      total: filtered.length,
      limit,
      levelCounts,
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
