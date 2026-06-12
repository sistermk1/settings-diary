// ── IndexedDB storage adapter ────────────────────────────────────────────────
//
// The mock (`settings-diary.jsx`) talked to `window.storage`, a Claude-artifact-
// only key/value API. That API does not exist in production, so this module
// reimplements the exact same surface on top of IndexedDB (via `idb`).
//
// Surface mirrored from the mock so the UI code can call it unchanged:
//   get(key)        -> Promise<{ value: string } | null>
//   set(key, value) -> Promise<void>
//   list(prefix)    -> Promise<{ keys: string[] }>
//   delete(key)     -> Promise<void>
//
// Keys used by the app: 'theme', 'customGames', and 'entry:YYYY-MM-DD'.
//
// Phase 1 is local-only. Phase 2 will wrap this with the StorageAdapter
// (loadAll / saveAll + 3s debounce to Google Drive) described in the spec.

import { openDB } from 'idb';

const DB_NAME = 'settings-diary';
const DB_VERSION = 1;
const STORE = 'kv';

// Single shared connection promise — opened lazily on first use.
let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          // Out-of-line keys: we pass the key explicitly on every put.
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export const storage = {
  /** Read one key. Returns `{ value }` (string) or `null` when absent. */
  async get(key) {
    const db = await getDB();
    const value = await db.get(STORE, key);
    return value === undefined ? null : { value };
  },

  /** Write one key. `value` is stored verbatim (callers JSON.stringify first). */
  async set(key, value) {
    const db = await getDB();
    await db.put(STORE, value, key);
  },

  /** List every key starting with `prefix`. Returns `{ keys }`. */
  async list(prefix = '') {
    const db = await getDB();
    const allKeys = await db.getAllKeys(STORE);
    const keys = allKeys
      .filter((k) => typeof k === 'string' && k.startsWith(prefix))
      .sort();
    return { keys };
  },

  /** Delete one key. No-op if it does not exist. */
  async delete(key) {
    const db = await getDB();
    await db.delete(STORE, key);
  },
};

export default storage;
