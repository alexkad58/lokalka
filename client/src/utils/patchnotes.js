export const PATCHNOTE_PREVIEW_LIMIT = 220;

export function normalizePatchNote(note) {
  return {
    id: String(note?.id || ''),
    date: String(note?.date || '').trim(),
    title: String(note?.title || '').trim(),
    text: String(note?.text || '').trim()
  };
}

export function sortPatchNotes(items) {
  const source = Array.isArray(items) ? items : [];
  return source
    .map(normalizePatchNote)
    .filter(item => item.id && item.title && item.text)
    .sort((a, b) => {
      const tsA = Date.parse(a.date || '');
      const tsB = Date.parse(b.date || '');
      if (Number.isNaN(tsA) && Number.isNaN(tsB)) return 0;
      if (Number.isNaN(tsA)) return 1;
      if (Number.isNaN(tsB)) return -1;
      return tsB - tsA;
    });
}

export function formatPatchNoteDate(value) {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) return value || 'Без даты';
  return parsed.toLocaleDateString('ru-RU');
}
