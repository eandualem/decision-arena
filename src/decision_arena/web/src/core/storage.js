// Safe persistent storage: localStorage when available, in-memory fallback otherwise.
// Every access is wrapped: private windows / sandboxed frames can throw on access.
const mem = new Map();

function ls() {
  try { const s = window.localStorage; const k = '__rd_probe__'; s.setItem(k, '1'); s.removeItem(k); return s; }
  catch { return null; }
}
const backing = ls();

export const storage = {
  persistent: !!backing,
  get(key, fallback = null) {
    try {
      if (backing) { const raw = backing.getItem(key); if (raw != null) return JSON.parse(raw); }
    } catch { /* fall through */ }
    return mem.has(key) ? structuredClone(mem.get(key)) : fallback;
  },
  set(key, value) {
    mem.set(key, structuredClone(value));
    try { backing?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    mem.delete(key);
    try { backing?.removeItem(key); } catch { /* ignore */ }
  },
};
