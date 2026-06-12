// ── WordPress(mone2.jp)をヘッドレス CMS として利用 ──────────────────────────
//
// 編集は WordPress の管理画面、アプリは REST API で読むだけ(認証不要・GET のみ)。
// 対応コンテンツ(すべて「固定ページ」、スラッグで紐付け):
//   - vildup-about    … 「このアプリについて」
//   - vildup-privacy  … 「プライバシーポリシー」
//   - vildup-ads      … アフィリエイト枠。本文中の <a href><img></a> が画像バナー、
//                        画像なしのリンクはテキスト型バナーとして表示される
//
// 取得結果は IndexedDB にキャッシュ(stale-while-revalidate):
// まずキャッシュで即表示 → 裏で再取得して更新。ブログが落ちていても
// アプリは最後に取得した内容で動き続ける。

import { storage } from './storage';

const WP_BASE = 'https://mone2.jp/wp-json/wp/v2';
const SLUGS = {
  about: 'vildup-about',
  privacy: 'vildup-privacy',
  ads: 'vildup-ads',
};

async function readCache(key) {
  try {
    const raw = await storage.get(`wp:${key}`);
    return raw ? JSON.parse(raw.value) : null;
  } catch (e) {
    return null;
  }
}

async function writeCache(key, data) {
  try {
    await storage.set(`wp:${key}`, JSON.stringify(data));
  } catch (e) {}
}

// 自分のブログとはいえ、script 等は描画前に落としておく
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  for (const el of doc.querySelectorAll('script, iframe, object, embed')) el.remove();
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (attr.name === 'href' && /^javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

async function fetchPageBySlug(slug) {
  const res = await fetch(
    `${WP_BASE}/pages?slug=${encodeURIComponent(slug)}&_fields=title,content,modified`,
  );
  if (!res.ok) throw new Error(`WP ${res.status}`);
  const list = await res.json();
  if (!list.length) return null; // ページ未作成
  return {
    title: list[0].title?.rendered || '',
    html: sanitize(list[0].content?.rendered || ''),
    modified: list[0].modified,
  };
}

/**
 * 固定ページを取得。onResult はキャッシュ→最新の順に最大2回呼ばれる。
 * ページ未作成・取得失敗でキャッシュもない場合は onResult(null)。
 */
export async function loadPage(kind, onResult) {
  const slug = SLUGS[kind];
  const cached = await readCache(slug);
  if (cached) onResult(cached);
  try {
    const fresh = await fetchPageBySlug(slug);
    if (fresh) {
      await writeCache(slug, fresh);
      onResult(fresh);
    } else if (!cached) {
      onResult(null);
    }
  } catch (e) {
    if (!cached) onResult(null);
  }
}

// vildup-ads ページの本文からバナーを抽出する
function parseAds(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const ads = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || /^javascript:/i.test(href)) continue;
    const img = a.querySelector('img');
    if (img && img.getAttribute('src')) {
      ads.push({ href, img: img.getAttribute('src'), alt: img.getAttribute('alt') || '' });
    } else {
      const text = a.textContent.trim();
      if (text) ads.push({ href, text });
    }
  }
  return ads;
}

/**
 * アフィリエイト枠を取得。onResult(配列) — ページ未作成なら呼ばれない
 * (アプリ側は src/affiliates.js の静的設定のまま)。
 */
export async function loadAds(onResult) {
  const cached = await readCache('ads-parsed');
  if (cached) onResult(cached);
  try {
    const page = await fetchPageBySlug(SLUGS.ads);
    if (page) {
      const ads = parseAds(page.html);
      await writeCache('ads-parsed', ads);
      onResult(ads);
    }
  } catch (e) {}
}
