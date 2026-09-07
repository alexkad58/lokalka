export function createRecountService({
  db,
  saveDb,
  createId,
  createDocId,
  toIsoNow,
  sanitizeFactExpression,
  sumFactExpression,
  asNumber,
  parseDocumentLines,
  extractRecountMeta
}) {
  function computeItemFact(item, values, options = {}) {
    const treatEmptyAsZero = Boolean(options.treatEmptyAsZero);
    const raw = values?.[item.code];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return sumFactExpression(raw);
    }
    return treatEmptyAsZero ? 0 : null;
  }

  function buildSummary(recount) {
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

  function sanitize(recount) {
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
      completedAt: recount.completedAt || null,
      items: recount.items || [],
      values: recount.values || {},
      search: recount.search || '',
      barcodeCache: recount.barcodeCache || {}
    };
  }

  function findByUser(userId, recountId) {
    return db.recounts.find(item => item.id === recountId && item.userId === userId) || null;
  }

  function findActive(userId) {
    return db.recounts.find(item => item.userId === userId && item.status === 'active') || null;
  }

  function listForUser(userId) {
    const userRecounts = db.recounts.filter(item => item.userId === userId);
    const active = userRecounts.find(item => item.status === 'active') || null;
    const previous = userRecounts
      .filter(item => item.status !== 'active')
      .sort((a, b) => String(b.completedAt || b.updatedAt || '').localeCompare(String(a.completedAt || a.updatedAt || '')))
      .map(buildSummary);
    return { active, previous };
  }

  function normalizeValues(values) {
    if (!values || typeof values !== 'object') return null;
    const normalized = {};
    for (const [key, value] of Object.entries(values)) {
      normalized[String(key)] = sanitizeFactExpression(value);
    }
    return normalized;
  }

  function applyProgress(recount, payload) {
    const normalizedValues = normalizeValues(payload?.values);
    if (normalizedValues) recount.values = normalizedValues;
    if (typeof payload?.search === 'string') recount.search = payload.search;
    if (payload?.barcodeCache && typeof payload.barcodeCache === 'object') {
      recount.barcodeCache = payload.barcodeCache;
    }
  }

  async function createFromText({ userId, sourceFileName, text }) {
    const meta = extractRecountMeta(text);
    const now = toIsoNow();
    const recount = {
      id: createId('r'),
      userId,
      status: 'active',
      docId: createDocId(),
      sourceFileName,
      storeLabel: meta.storeLabel,
      storeNumber: meta.storeNumber,
      storeAddress: meta.storeAddress,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      items: parseDocumentLines(text),
      values: {},
      search: '',
      barcodeCache: {},
      counterName: null,
      groupName: null
    };

    db.recounts.push(recount);
    await saveDb();
    return recount;
  }

  async function deleteForUser(userId, recountId) {
    const recount = findByUser(userId, recountId);
    if (!recount) return null;
    db.recounts = db.recounts.filter(item => !(item.id === recount.id && item.userId === userId));
    await saveDb();
    return recount;
  }

  async function reopenForUser(userId, recountId) {
    const recount = findByUser(userId, recountId);
    if (!recount) return { status: 'not-found' };
    if (recount.status === 'active') return { status: 'ok', recount };

    const active = findActive(userId);
    if (active && active.id !== recount.id) {
      return { status: 'conflict', recount, activeRecount: active };
    }

    recount.status = 'active';
    recount.updatedAt = toIsoNow();
    await saveDb();
    return { status: 'ok', recount };
  }

  async function saveProgressForUser(userId, recountId, payload, minimumIntervalMs) {
    const recount = findByUser(userId, recountId);
    if (!recount) return { status: 'not-found' };
    if (recount.status !== 'active') return { status: 'completed', recount };

    applyProgress(recount, payload);
    const nowTs = Date.now();
    const lastSaveTs = Date.parse(recount.updatedAt || recount.createdAt || toIsoNow());
    if (!Number.isNaN(lastSaveTs) && nowTs - lastSaveTs < minimumIntervalMs) {
      return { status: 'ok', recount };
    }

    recount.updatedAt = toIsoNow();
    await saveDb();
    return { status: 'ok', recount };
  }

  async function completeForUser(userId, recountId, payload) {
    const recount = findByUser(userId, recountId);
    if (!recount) return { status: 'not-found' };
    if (recount.status !== 'active') return { status: 'completed', recount };

    applyProgress(recount, payload);
    if (!payload.withoutPdf) {
      recount.counterName = String(payload.counterName || '').trim();
      recount.groupName = String(payload.groupName || '').trim();
    }
    recount.status = 'completed';
    recount.completedAt = payload.updateCompletionTime
      ? toIsoNow()
      : (recount.completedAt || toIsoNow());
    recount.updatedAt = toIsoNow();
    await saveDb();
    return { status: 'ok', recount };
  }

  return {
    computeItemFact,
    buildSummary,
    sanitize,
    findByUser,
    findActive,
    listForUser,
    createFromText,
    deleteForUser,
    reopenForUser,
    saveProgressForUser,
    completeForUser
  };
}
