import { readFile, writeFile } from 'node:fs/promises';

function normalizeListShape(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) return parsed.items;
  return [];
}

export function createPatchNotesStore({ fileUrl, normalizePatchNote }) {
  async function save(items) {
    await writeFile(fileUrl, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf8');
  }

  async function load() {
    try {
      const raw = await readFile(fileUrl, 'utf8');
      const parsed = JSON.parse(raw);
      const source = normalizeListShape(parsed);
      const normalized = source
        .map(note => normalizePatchNote(note))
        .filter(Boolean);

      if (!Array.isArray(parsed) || JSON.stringify(source) !== JSON.stringify(normalized)) {
        await save(normalized);
      }

      return normalized;
    } catch {
      const empty = [];
      await save(empty);
      return empty;
    }
  }

  return { load, save };
}
