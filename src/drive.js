// ── Google Drive API v3 helpers ──────────────────────────────────────────────
//
// Talks only to files this app created (drive.file scope), under:
//   (Drive root) / SettingsDiary / data.json
//
// All requests go through authFetch, which retries exactly once on 401 after
// a silent token refresh. Errors carry `status` so the sync layer can tell
// auth failures (re-login) from transient ones (retry later).

import { getToken, clearToken, requestToken } from './googleAuth';

const FOLDER_NAME = 'SettingsDiary';
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

/**
 * Locate (or create) the SettingsDiary folder and data.json inside it.
 * Returns { folderId, fileId } — fileId is null when data.json doesn't exist yet.
 */
export async function ensureDataFile() {
  const folderQ = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  let res = await authFetch(`${API}/files?q=${folderQ}&fields=files(id)`);
  let folderId = (await res.json()).files?.[0]?.id;

  if (!folderId) {
    res = await authFetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    folderId = (await res.json()).id;
  }

  const fileQ = encodeURIComponent(
    `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
  );
  res = await authFetch(`${API}/files?q=${fileQ}&fields=files(id)`);
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
