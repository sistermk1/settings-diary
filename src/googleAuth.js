// ── Google Identity Services (GIS) token client ─────────────────────────────
//
// Client-side-only OAuth per the spec:
//  - scope is drive.file ONLY (non-sensitive — do not add more)
//  - the access token lives in memory only (never localStorage / cookies)
//  - expiry / 401 → silent re-acquire via requestAccessToken({ prompt: '' });
//    only when that fails does the UI fall back to the login button

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisLoadPromise = null;
let tokenClient = null;
let inflight = null; // de-dupe concurrent token requests
let pendingResolve = null;
let pendingReject = null;
let accessToken = null;
let expiresAt = 0; // epoch ms

export const isConfigured = () => Boolean(CLIENT_ID);

/** Current token if still valid, else null. */
export function getToken() {
  return accessToken && Date.now() < expiresAt ? accessToken : null;
}

export function clearToken() {
  accessToken = null;
  expiresAt = 0;
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoadPromise) {
    gisLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoadPromise = null;
        reject(new Error('Google ログインスクリプトの読み込みに失敗しました'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoadPromise;
}

async function ensureClient() {
  if (!CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID が未設定です(.env を確認してください)');
  }
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) {
          pendingReject?.(new Error(resp.error_description || resp.error));
        } else {
          accessToken = resp.access_token;
          // refresh 60s early to avoid using a token that dies mid-request
          expiresAt = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
          pendingResolve?.(accessToken);
        }
        pendingResolve = pendingReject = null;
      },
      error_callback: (err) => {
        pendingReject?.(new Error(err?.message || err?.type || 'ログインがキャンセルされました'));
        pendingResolve = pendingReject = null;
      },
    });
  }
  return tokenClient;
}

/**
 * Acquire an access token. With an existing Google session + prior consent
 * this completes silently; otherwise GIS shows its account/consent popup.
 */
export async function requestToken() {
  const valid = getToken();
  if (valid) return valid;
  if (inflight) return inflight;
  inflight = (async () => {
    const client = await ensureClient();
    try {
      return await new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
        client.requestAccessToken({ prompt: '' });
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Revoke the current grant and drop the in-memory token. */
export function revoke() {
  if (accessToken && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    } catch (e) {
      // revocation is best-effort; the in-memory token is cleared regardless
    }
  }
  clearToken();
}
