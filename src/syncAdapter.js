// ── StorageAdapter: IndexedDB primary + Google Drive sync ────────────────────
//
// Spec §3.3/§3.4. The whole app state lives as ONE document (data.json schema):
//   { app: 'settings-diary', version: 2, updatedAt, entries, customGames }
//
//  - loadAll(): IndexedDB doc returned immediately (migrating Phase-1 per-key
//    data on first run). Drive comparison happens on signIn(), not here, so an
//    unauthenticated session never touches the network.
//  - saveAll(): writes IndexedDB synchronously-ish, then debounces 3s before
//    uploading to Drive. Local data is ALWAYS preserved on any Drive failure.
//  - Startup sync: last-write-wins on `updatedAt` (spec accepts LWW for V1).
//  - Offline: stays dirty; flushed on `online` event or 30s retry timer.
//
// `theme` is intentionally NOT part of the doc — it is a per-device preference
// and stays in the kv store directly.

import { storage } from './storage';
import * as auth from './googleAuth';
import * as drive from './drive';

const DOC_KEY = 'appdata';
const SESSION_HINT_KEY = 'driveSessionHint'; // '1' = user signed in before (not a secret)
const DEBOUNCE_MS = 3000;
const RETRY_MS = 30000;

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ensureId = (e) => (e && e.id ? e : { ...e, id: genId() });

const emptyData = () => ({
  app: 'settings-diary',
  version: 2,
  updatedAt: null,
  entries: {},
  customGames: [],
});

let fileId = null;
let signedIn = false;
let status = 'local'; // local | connecting | syncing | synced | offline | needs-login | error
let dirty = false;
let lastDoc = null; // in-memory copy of the latest saved doc (for pagehide flush)
let debounceTimer = null;
let retryTimer = null;
let onRemoteData = null;
const listeners = new Set();

export const isConfigured = auth.isConfigured;

function setStatus(next) {
  status = next;
  for (const l of listeners) l({ status, signedIn });
}

/** Subscribe to { status, signedIn } changes. Returns an unsubscribe fn. */
export function subscribe(listener) {
  listeners.add(listener);
  listener({ status, signedIn });
  return () => listeners.delete(listener);
}

/** Register the callback invoked when Drive has newer data than local. */
export function setRemoteHandler(fn) {
  onRemoteData = fn;
}

/** True if this browser used Drive sync before (shows the re-login hint). */
export async function hadSession() {
  try {
    return Boolean(await storage.get(SESSION_HINT_KEY));
  } catch (e) {
    return false;
  }
}

// ── Local document ───────────────────────────────────────────────────────────

async function readLocal() {
  const raw = await storage.get(DOC_KEY);
  if (raw) {
    try {
      const doc = JSON.parse(raw.value);
      if (doc && typeof doc.entries === 'object') return { ...emptyData(), ...doc };
    } catch (e) {
      // fall through to migration — never let a corrupt doc nuke the data
    }
  }
  return migrateLegacy();
}

// Phase 1 stored per-key 'entry:YYYY-MM-DD' + 'customGames'. Assemble those
// into the single doc once, then remove the legacy keys.
async function migrateLegacy() {
  const data = emptyData();
  try {
    const res = await storage.list('entry:');
    for (const key of res.keys || []) {
      const raw = await storage.get(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw.value);
        const list = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(ensureId);
        if (list.length) data.entries[key.replace('entry:', '')] = list;
      } catch (e) {}
    }
    const games = await storage.get('customGames');
    if (games) {
      try {
        const parsed = JSON.parse(games.value);
        if (Array.isArray(parsed)) data.customGames = parsed;
      } catch (e) {}
    }
    if (Object.keys(data.entries).length || data.customGames.length) {
      data.updatedAt = new Date().toISOString();
      await storage.set(DOC_KEY, JSON.stringify(data));
      // legacy keys are now owned by the doc — drop them so they can't go stale
      for (const key of (await storage.list('entry:')).keys || []) {
        await storage.delete(key);
      }
      await storage.delete('customGames');
    }
  } catch (e) {
    console.error('Legacy migration error:', e);
  }
  lastDoc = data;
  return data;
}

async function writeLocal(doc) {
  lastDoc = doc;
  await storage.set(DOC_KEY, JSON.stringify(doc));
}

// ── StorageAdapter interface (spec §3.3) ─────────────────────────────────────

export async function loadAll() {
  const data = await readLocal();
  lastDoc = data;
  return data;
}

export async function saveAll({ entries, customGames }) {
  const doc = {
    ...emptyData(),
    entries: entries || {},
    customGames: customGames || [],
    updatedAt: new Date().toISOString(),
  };
  await writeLocal(doc);
  if (signedIn && fileId) {
    dirty = true;
    scheduleFlush();
  }
  return doc;
}

// ── Drive sync ───────────────────────────────────────────────────────────────

function scheduleFlush() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    flush();
  }, DEBOUNCE_MS);
}

function armRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    flush();
  }, RETRY_MS);
}

async function flush() {
  if (!signedIn || !fileId || !dirty) return;
  setStatus('syncing');
  try {
    const doc = lastDoc || (await readLocal());
    await drive.uploadData(fileId, doc);
    dirty = false;
    setStatus('synced');
  } catch (e) {
    console.error('Drive upload error:', e);
    if (e.status === 401 || e.status === 403) {
      // silent refresh already failed inside authFetch → needs re-login.
      // dirty stays true: data is safe locally and re-syncs after login.
      signedIn = false;
      setStatus('needs-login');
    } else if (!navigator.onLine) {
      setStatus('offline');
      armRetry();
    } else {
      setStatus('error');
      armRetry();
    }
  }
}

/**
 * Silent session resume on app start. The access token itself is never
 * persisted (spec §4), but when the Google session cookie + prior consent
 * are still alive, requestToken({prompt:''}) completes without any UI —
 * so a reload keeps the user signed in. Returns false when interaction
 * would be needed (popup blocked / consent expired); caller shows the
 * login hint instead. Never throws.
 */
export async function tryResume() {
  if (!auth.isConfigured()) return false;
  try {
    if (!(await hadSession())) return false;
    await signIn();
    return true;
  } catch (e) {
    return false;
  }
}

let signInPromise = null;

/**
 * Interactive sign-in, then initial last-write-wins sync:
 * newer side (by updatedAt) overwrites the older one.
 * Concurrent calls share one attempt (guards StrictMode double-effects —
 * a duplicated first run could otherwise create the Drive folder twice).
 */
export function signIn() {
  if (!signInPromise) {
    signInPromise = doSignIn().finally(() => {
      signInPromise = null;
    });
  }
  return signInPromise;
}

async function doSignIn() {
  setStatus('connecting');
  try {
    await auth.requestToken();
    signedIn = true;
    await storage.set(SESSION_HINT_KEY, '1');
    setStatus('syncing');

    const ids = await drive.ensureDataFile();
    const local = lastDoc || (await readLocal());

    if (!ids.fileId) {
      fileId = await drive.createDataFile(ids.folderId, local);
    } else {
      fileId = ids.fileId;
      const remote = await drive.downloadData(fileId);
      const localTime = Date.parse(local.updatedAt || '') || 0;
      const remoteTime = Date.parse(remote?.updatedAt || '') || 0;
      if (remote && remoteTime > localTime) {
        await writeLocal(remote);
        onRemoteData?.(remote);
      } else if (localTime > remoteTime) {
        await drive.uploadData(fileId, local);
      }
    }
    dirty = false;
    setStatus('synced');
  } catch (e) {
    signedIn = false;
    setStatus(auth.getToken() ? 'error' : 'local');
    throw e;
  }
}

// ── Clips (Phase 3) — thin guards over drive.js so the UI never imports it ──

/**
 * Resumable-upload a video to SettingsDiary/clips/. `onProgress` gets 0..1,
 * `handle.abort()` cancels. Resolves to the Drive fileId (→ clipFile.driveId).
 */
export async function uploadClip(file, dateKey, onProgress, handle) {
  if (!signedIn) throw new Error('Google ログインが必要です');
  const folderId = await drive.ensureClipsFolder();
  const name = `${dateKey}_${Math.random().toString(36).slice(2, 8)}_${file.name}`;
  return drive.resumableUpload(file, name, folderId, onProgress, handle);
}

/** Download the clip bytes for playback (caller turns it into a Blob URL). */
export function loadClipBlob(driveId) {
  return drive.downloadBlob(driveId);
}

/** Drive's preview image for the clip, or null while not yet generated. */
export function getClipThumb(driveId) {
  return drive.getThumbnail(driveId);
}

/** Best-effort delete of a clip file (404 = already gone, fine). */
export async function deleteClip(driveId) {
  if (!signedIn || !driveId) return;
  try {
    await drive.deleteFile(driveId);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}

/**
 * Revoke the grant. Local cache is kept unless the user chose to wipe it
 * (spec §4-5: ask the user).
 */
export async function signOut({ keepLocal }) {
  auth.revoke();
  signedIn = false;
  drive.resetFolderCache();
  fileId = null;
  dirty = false;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  try {
    await storage.delete(SESSION_HINT_KEY);
    if (!keepLocal) {
      await storage.delete(DOC_KEY);
      lastDoc = null;
    }
  } catch (e) {
    console.error('Sign-out cleanup error:', e);
  }
  setStatus('local');
}

// ── Connectivity hooks ───────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (dirty) flush();
  });
  // Best-effort: if the tab closes inside the 3s debounce window, try a
  // keepalive upload so Drive doesn't fall behind. Local data is safe either
  // way — next signIn() resolves it via last-write-wins.
  window.addEventListener('pagehide', () => {
    if (dirty && signedIn && fileId && lastDoc && auth.getToken()) {
      drive.uploadData(fileId, lastDoc, { keepalive: true }).catch(() => {});
    }
  });
}
