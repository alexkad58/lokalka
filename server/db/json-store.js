import { readFile, writeFile } from 'node:fs/promises';

function createEmptyState() {
  return {
    users: [],
    recounts: [],
    sessions: [],
    settings: {}
  };
}

export function createJsonStore({ fileUrl, normalizeUser, normalizeSession, onLoad, onReset }) {
  async function save(state) {
    await writeFile(fileUrl, JSON.stringify(state, null, 2), 'utf8');
  }

  async function load(state) {
    try {
      const raw = await readFile(fileUrl, 'utf8');
      const parsed = JSON.parse(raw);

      state.users = Array.isArray(parsed?.users)
        ? parsed.users.map(normalizeUser)
        : [];
      state.recounts = Array.isArray(parsed?.recounts) ? parsed.recounts : [];
      state.settings = parsed?.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
      state.sessions = Array.isArray(parsed?.sessions)
        ? parsed.sessions.map(normalizeSession)
        : [];

      const changed = await onLoad?.(state);
      if (changed) await save(state);
    } catch {
      Object.assign(state, createEmptyState());
      await onReset?.(state);
      await save(state);
    }
  }

  return { load, save };
}
