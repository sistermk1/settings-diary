// ── Google Drive API v3 helpers ──────────────────────────────────────────────
//
// Talks only to files this app created (drive.file scope), under:
//   (Drive root) / SettingsDiary / data.json
//                              └── clips / <YYYY-MM-DD>_<rand>_<name>
//
// All requests go through authFetch, which retries exactly once on 401 after
// a silent token refresh. Errors carry `status` so the sync layer can tell
// auth failures (re-login) from transient ones (retry later).

import { getToken, clearToken, requestToken } from './googleAuth';

const FOLDER_NAME = 'SettingsDiary';
const CLIPS_FOLDER_NAME = 'clips';
const FILE_NAME = 'data.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function authFetch(url, options = {}, allowRetry = true) {
  const token = getToken() || (await requestToken());
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && allowRetry) {
    clearToken();
    await requestToken(); // silent re-acquire (spec §4-4)
    return authFetch(url, options, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

// ── Folder management (ids cached per session / per account) ────────────────

let appFolderId = null;
let clipsFolderId = null;

/** Forget cached folder ids — must be called on sign-out (account may change). */
export function resetFolderCache() {
  appFolderId = null;
  clipsFolderId = null;
}

async function findOrCreateFolder(name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
  );
  let res = await authFetch(`${API}/files?q=${q}&fields=files(id)`);
  const existing = (await res.json()).files?.[0]?.id;
  if (existing) return existing;

  res = await authFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return (await res.json()).id;
}

async function ensureAppFolder() {
  if (!appFolderId) appFolderId = await findOrCreateFolder(FOLDER_NAME, null);
  return appFolderId;
}

/** SettingsDiary/clips/ — created on demand for video uploads. */
export async function ensureClipsFolder() {
  if (!clipsFolderId) clipsFolderId = await findOrCreateFolder(CLIPS_FOLDER_NAME, await ensureAppFolder());
  return clipsFolderId;
}

// ── data.json ────────────────────────────────────────────────────────────────

/**
 * Locate (or create) the SettingsDiary folder and data.json inside it.
 * Returns { folderId, fileId } — fileId is null when data.json doesn't exist yet.
 */
export async function ensureDataFile() {
  const folderId = await ensureAppFolder();
  const fileQ = encodeURIComponent(
    `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await authFetch(`${API}/files?q=${fileQ}&fields=files(id)`);
  const fileId = (await res.json()).files?.[0]?.id || null;
  return { folderId, fileId };
}

/** Create data.json with initial content. Returns the new fileId. */
export async function createDataFile(folderId, data) {
  const boundary = 'settingsdiary' + Math.random().toString(36).slice(2);
  const metadata = { name: FILE_NAME, parents: [folderId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${JSON.stringify(data)}\r\n--${boundary}--`;
  const res = await authFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

/** Download and parse data.json. Returns null when the file is empty/corrupt. */
export async function downloadData(fileId) {
  const res = await authFetch(`${API}/files/${fileId}?alt=media`);
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

/** Overwrite data.json content (files.update, uploadType=media). */
export async function uploadData(fileId, data, { keepalive = false } = {}) {
  await authFetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    keepalive,
  });
}

// ── Clips: resumable upload (spec §5) ───────────────────────────────────────

// One PUT of the remaining bytes via XHR (the only browser API with upload
// progress events). The resumable session URL is self-authorizing, so no
// Authorization header is needed after initiation — this also means a token
// expiring mid-upload does not kill a large transfer.
function putBytes(sessionUrl, file, offset, onProgress, handle) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    if (offset > 0) {
      xhr.setRequestHeader('Content-Range', `bytes ${offset}-${file.size - 1}/${file.size}`);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((offset + e.loaded) / file.size);
    };
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error('アップロード中にネットワークエラーが発生しました'));
    xhr.onabort = () => reject(Object.assign(new Error('upload aborted'), { aborted: true }));
    if (handle) handle.abort = () => xhr.abort();
    xhr.send(offset > 0 ? file.slice(offset) : file);
  });
}

// Ask the session how many bytes it already has (Content-Range: bytes */total
// → 308 with a Range header). Falls back to 0 = restart from scratch.
async function queryReceivedOffset(sessionUrl, total) {
  try {
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${total}` },
    });
    if (res.status === 308) {
      const range = res.headers.get('Range');
      const m = range && range.match(/-(\d+)$/);
      return m ? Number(m[1]) + 1 : 0;
    }
  } catch (e) {}
  return 0;
}

/**
 * Upload a (potentially huge) video via uploadType=resumable.
 * `onProgress` receives a 0..1 fraction; `handle.abort()` cancels.
 * Network drops resume from the last byte the server confirmed.
 * Returns the new Drive fileId.
 */
export async function resumableUpload(file, name, folderId, onProgress, handle) {
  const mime = file.type || 'video/mp4';
  const initRes = await authFetch(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name, parents: [folderId], mimeType: mime }),
  });
  const sessionUrl = initRes.headers.get('Location');
  if (!sessionUrl) throw new Error('アップロードセッションを開始できませんでした');

  let offset = 0;
  let attempt = 0;
  for (;;) {
    try {
      const xhr = await putBytes(sessionUrl, file, offset, onProgress, handle);
      if (xhr.status === 200 || xhr.status === 201) {
        return JSON.parse(xhr.responseText).id;
      }
      if (xhr.status === 308) {
        // server stored a prefix and wants the rest
        offset = await queryReceivedOffset(sessionUrl, file.size);
        continue;
      }
      const err = new Error(`Drive upload ${xhr.status}: ${(xhr.responseText || '').slice(0, 200)}`);
      err.status = xhr.status;
      throw err;
    } catch (e) {
      if (e.aborted || e.status) throw e; // user abort / definitive API error
      if (++attempt > 3) throw e; // transient network: give up after 3 resumes
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      offset = await queryReceivedOffset(sessionUrl, file.size);
    }
  }
}

// ── Clips: playback / thumbnail / delete ────────────────────────────────────

/**
 * Fetch the video bytes as a Blob (alt=media needs the Authorization header,
 * so <video src> cannot point at Drive directly — callers create a Blob URL).
 */
export async function downloadBlob(fileId) {
  const res = await authFetch(`${API}/files/${fileId}?alt=media`);
  return res.blob();
}

/** Drive-generated preview image URL (null until Drive has processed the video). */
export async function getThumbnail(fileId) {
  const res = await authFetch(`${API}/files/${fileId}?fields=thumbnailLink`);
  const link = (await res.json()).thumbnailLink || null;
  // default is a tiny =s220 — ask for a size that fills the preview area
  return link ? link.replace(/=s\d+$/, '=s640') : null;
}

/** Permanently delete a file this app created. */
export async function deleteFile(fileId) {
  await authFetch(`${API}/files/${fileId}`, { method: 'DELETE' });
}
