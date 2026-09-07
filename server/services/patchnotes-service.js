function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function createNotFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

export function createPatchNotesService({ state, savePatchNotes, createId, toIsoNow }) {
  function normalizePatchNote(input, fallbackId = '') {
    const date = normalizeDate(input?.date);
    const title = normalizeText(input?.title, 160);
    const text = normalizeText(input?.text, 12000);
    const id = String(input?.id || fallbackId || createId('pn')).trim();
    const createdAt = String(input?.createdAt || toIsoNow());
    const updatedAt = String(input?.updatedAt || toIsoNow());

    if (!id || !date || !title || !text) return null;

    return {
      id,
      date,
      title,
      text,
      createdAt,
      updatedAt
    };
  }

  function list() {
    return (Array.isArray(state.items) ? state.items : [])
      .slice()
      .sort((a, b) => {
        const byDate = String(b.date || '').localeCompare(String(a.date || ''));
        if (byDate !== 0) return byDate;
        const byUpdated = String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        if (byUpdated !== 0) return byUpdated;
        return String(b.id || '').localeCompare(String(a.id || ''));
      })
      .map(item => ({ id: item.id, date: item.date, title: item.title, text: item.text }));
  }

  function validatePayload(payload) {
    const date = normalizeDate(payload?.date);
    const title = normalizeText(payload?.title, 160);
    const text = normalizeText(payload?.text, 12000);

    if (!date) throw createValidationError('Укажите корректную дату патчноута');
    if (!title) throw createValidationError('Укажите заголовок патчноута');
    if (!text) throw createValidationError('Укажите текст патчноута');

    return { date, title, text };
  }

  async function create(payload) {
    const next = validatePayload(payload);
    const note = normalizePatchNote({
      id: createId('pn'),
      ...next,
      createdAt: toIsoNow(),
      updatedAt: toIsoNow()
    });

    state.items = [...(Array.isArray(state.items) ? state.items : []), note];
    await savePatchNotes(state.items);
    return { id: note.id, date: note.date, title: note.title, text: note.text };
  }

  async function update(id, payload) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) throw createNotFoundError('Патчноут не найден');

    const current = (Array.isArray(state.items) ? state.items : []).find(item => item.id === normalizedId);
    if (!current) throw createNotFoundError('Патчноут не найден');

    const next = validatePayload(payload);
    const updated = normalizePatchNote({
      ...current,
      ...next,
      id: normalizedId,
      updatedAt: toIsoNow()
    }, normalizedId);

    state.items = state.items.map(item => (item.id === normalizedId ? updated : item));
    await savePatchNotes(state.items);
    return { id: updated.id, date: updated.date, title: updated.title, text: updated.text };
  }

  async function remove(id) {
    const normalizedId = String(id || '').trim();
    const source = Array.isArray(state.items) ? state.items : [];
    const exists = source.some(item => item.id === normalizedId);
    if (!exists) throw createNotFoundError('Патчноут не найден');

    state.items = source.filter(item => item.id !== normalizedId);
    await savePatchNotes(state.items);
    return { ok: true };
  }

  return {
    normalizePatchNote,
    list,
    create,
    update,
    remove
  };
}
