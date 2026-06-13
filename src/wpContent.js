// ── WordPress(vildup.mone2.jp)をヘッドレス CMS として利用 ───────────────────
//
// VILDUP 専用の WP(noindex、ブログ本体とは別インストール)を編集画面として使う。
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

const WP_BASE = 'https://vildup.mone2.jp/wp-json/wp/v2';
// ページ種別ごとのスラッグ候補(先頭から順に探す)。CMS 側でどちらの名前で
// 作られていても動くようにしている。
const SLUGS = {
  about: ['about', 'vildup-about'],
  privacy: ['privacy-policy', 'vildup-privacy'],
  ads: ['広告関連', 'vildup-ads', 'ads'],
  adpolicy: ['広告ポリシー', 'ad-policy', 'vildup-adpolicy'],
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

// 自分のブログが情報源だが、多層防御として描画前に危険な要素・属性を除去する。
// (XSS 対策: WP が万一改ざんされても、スクリプトや javascript:/data: 経由の実行を防ぐ)
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  // 実行・埋め込み・リダイレクト・スタイル注入につながる要素を除去
  for (const el of doc.querySelectorAll('script, iframe, object, embed, link, meta, base, form, style, svg')) {
    el.remove();
  }
  const BAD_URL = /^\s*(javascript|data|vbscript):/i;
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      // on* イベントハンドラを全削除
      if (/^on/.test(name)) { el.removeAttribute(attr.name); continue; }
      // href/src/xlink:href などの危険スキームを無効化(画像の data: は許可)
      if (/(href|src|action|formaction|xlink:href)$/.test(name) && BAD_URL.test(attr.value)) {
        if (!(name === 'src' && /^\s*data:image\//i.test(attr.value))) el.removeAttribute(attr.name);
      }
      // style 属性も注入面になり得るため除去
      if (name === 'style') el.removeAttribute(attr.name);
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

// 候補スラッグを先頭から順に探し、最初に見つかったページを返す
async function fetchPageByCandidates(slugs) {
  for (const slug of slugs) {
    const page = await fetchPageBySlug(slug);
    if (page) return page;
  }
  return null;
}

/**
 * 固定ページを取得。onResult はキャッシュ→最新の順に最大2回呼ばれる。
 * ページ未作成・取得失敗でキャッシュもない場合は onResult(null)。
 */
export async function loadPage(kind, onResult) {
  const cacheKey = `page:${kind}`;
  const cached = await readCache(cacheKey);
  if (cached) onResult(cached);
  try {
    const fresh = await fetchPageByCandidates(SLUGS[kind]);
    if (fresh) {
      await writeCache(cacheKey, fresh);
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
    const page = await fetchPageByCandidates(SLUGS.ads);
    if (page) {
      const ads = parseAds(page.html);
      await writeCache('ads-parsed', ads);
      onResult(ads);
    }
  } catch (e) {}
}
