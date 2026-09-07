import { randomBytes } from 'node:crypto';

export function createSessionManager({
  db,
  sessions,
  sessionTtlMs,
  saveDb,
  toIsoNow,
  normalizeSession,
  getDeviceIdFromRequest,
  getRequestIp,
  clipLogString
}) {
  function issueToken() {
    return randomBytes(24).toString('hex');
  }

  function hydrateFromDb() {
    const userIds = new Set(db.users.map(user => user.id));
    const nowTs = Date.now();
    const candidates = Array.isArray(db.sessions) ? db.sessions : [];
    const valid = candidates
      .map(normalizeSession)
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

  async function createForUser(user, request) {
    const nowIso = toIsoNow();
    const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
    const token = issueToken();
    const deviceId = getDeviceIdFromRequest(request);

    for (const [existingToken, session] of sessions.entries()) {
      if (session?.userId === user.id) {
        sessions.delete(existingToken);
      }
    }

    db.sessions = (Array.isArray(db.sessions) ? db.sessions : [])
      .filter(session => session.userId !== user.id);

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

  async function revokeByToken(token) {
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

  function get(token) {
    return token ? sessions.get(token) : null;
  }

  async function updateDevice(token, deviceId) {
    const session = get(token);
    if (!session) return false;

    session.deviceId = deviceId;
    session.updatedAt = toIsoNow();
    const sessionIndex = (Array.isArray(db.sessions) ? db.sessions : [])
      .findIndex(item => item.token === token);
    if (sessionIndex >= 0) {
      db.sessions[sessionIndex] = {
        ...db.sessions[sessionIndex],
        deviceId,
        updatedAt: session.updatedAt
      };
    }
    await saveDb();
    return true;
  }

  return {
    hydrateFromDb,
    createForUser,
    revokeByToken,
    get,
    updateDevice
  };
}
