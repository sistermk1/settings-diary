import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, Save, Trash2, Star, ChevronDown, Plus, Share2, Copy, Check, Upload, Film, AlertCircle, Download, Sun, Moon, Search, LogIn, LogOut, Cloud, CloudOff, CalendarDays, History, Share, Menu, Gem, TrendingUp, Info, ShieldCheck, Globe } from 'lucide-react';
import { AFFILIATES } from './affiliates';
import * as wp from './wpContent';
import { makeT, detectLang, LANGS } from './i18n';
import { computeRecordStats, computeAnalysis, drawRecordCard, drawAnalysisCard } from './stats';
import { storage } from './storage';
import * as adapter from './syncAdapter';

export default function SettingsDiary() {
  // ── Helpers (declared first so effects/handlers can use them safely) ──
  const formatDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= lastDate; d++) days.push(new Date(year, month, d));
    return days;
  };

  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ensureId = (e) => (e && e.id ? e : { ...e, id: genId() });

  const EMPTY_FORM = {
    game: '', rating: 0,
    mouse: '', mousepad: '', keyboard: '',
    dpi: '', sens: '', pollingRate: '', lod: '',
    kbAp: '', kbRt: '', kbPollingRate: '',
    memo: '', clipUrl: '', clipFile: null, photos: []
  };

  const MEDIA_MAX = 4; // 1記録あたりの写真+動画の合計上限

  // Setup fields tracked for "changed since last entry of same game" highlighting
  const SETUP_FIELDS = ['mouse', 'mousepad', 'keyboard', 'dpi', 'sens', 'pollingRate', 'lod', 'kbAp', 'kbRt', 'kbPollingRate'];

  // entries: { 'YYYY-MM-DD': [entryObj, ...] }  (array order = creation order, newest last)
  const [view, setView] = useState('calendar'); // 'calendar' | 'timeline'
  const [theme, setTheme] = useState('light'); // 'light' | 'dark'
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState(null); // null = creating new
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [customGames, setCustomGames] = useState([]);
  const [gameDropdownOpen, setGameDropdownOpen] = useState(false);
  const [newGameInput, setNewGameInput] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [prefilledFrom, setPrefilledFrom] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [gameFilter, setGameFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [importNotice, setImportNotice] = useState(null);
  const [pendingImport, setPendingImport] = useState(null); // { entries, customGames, count } awaiting in-app confirmation
  const fileInputRef = useRef(null);
  const importInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const dragCounter = useRef(0);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [syncStatus, setSyncStatus] = useState('local'); // adapter status (see syncAdapter.js)
  const [authBusy, setAuthBusy] = useState(false);
  const [syncHint, setSyncHint] = useState(false); // had a Drive session before, not signed in yet
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [deleteClipConfirm, setDeleteClipConfirm] = useState(false); // entry delete: also remove Drive clip?
  const [thumbUrl, setThumbUrl] = useState(null);
  const [clipLoading, setClipLoading] = useState(false);
  const [videoShare, setVideoShare] = useState({ status: 'idle', files: null, key: null }); // Web Share API: idle | preparing | ready
  const [iosInstallHint, setIosInstallHint] = useState(false); // iOS Safari: "add to Home Screen" banner, shown once
  const [menuOpen, setMenuOpen] = useState(false); // hamburger menu (export / import / theme / auth)
  const [tlPlayer, setTlPlayer] = useState(null); // timeline inline playback: { id, blobUrl, loading }
  const [anGame, setAnGame] = useState('ALL'); // Analysis tab game filter
  const [ads, setAds] = useState(AFFILIATES); // affiliate banners (WP-managed, static fallback)
  const [adIndex, setAdIndex] = useState(0); // PR slider current slide
  const adTouchX = useRef(null);
  const [infoPage, setInfoPage] = useState(null); // WP page modal: { kind, title, html|null(loading) }
  const [guideOpen, setGuideOpen] = useState(false); // welcome guide modal
  const [guideStep, setGuideStep] = useState(0); // current slide
  const uploadRef = useRef(null); // in-flight clip upload: { file, abort, driveId, saved }
  const preloadRef = useRef({ cache: new Map(), queue: [], running: false }); // PC only: prefetched clip Blobs (driveId → Blob)
  const pendingPhotosRef = useRef([]); // in-flight photo handles for orphan cleanup
  const [lightbox, setLightbox] = useState(null); // { url, loading } full-image viewer
  const [lang, setLang] = useState('ja'); // UI language (ja | en)
  const t = makeT(lang);
  const videoSharePrepRef = useRef(null); // de-dupes concurrent share preparations

  const PRESET_GAMES = ['VALORANT', 'OVERWATCH 2', 'APEX LEGENDS', 'CS2', 'Marvel Rivals', 'Rainbow Six Siege X', 'Fortnite', 'Battlefield', 'Call of Duty', 'Kovaaks', 'AimLab'];
  const allGames = [...PRESET_GAMES, ...customGames];

  // ── Initial load: single doc via the storage adapter (theme stays device-local) ──
  useEffect(() => {
    async function loadInitial() {
      try {
        try {
          const th = await storage.get('theme');
          if (th && (th.value === 'dark' || th.value === 'light')) setTheme(th.value);
        } catch (e) {}
        try {
          const lg = await storage.get('lang');
          setLang(detectLang(lg?.value));
        } catch (e) { setLang(detectLang()); }

        const data = await adapter.loadAll();
        if (data.entries && Object.keys(data.entries).length) setEntries(data.entries);
        if (Array.isArray(data.customGames) && data.customGames.length) setCustomGames(data.customGames);

        // First launch: show the welcome guide once (re-openable from the menu)
        const guideSeen = await storage.get('welcomeGuideSeen');
        if (!guideSeen) {
          setGuideStep(0);
          setGuideOpen(true);
        }

        // iOS Safari has no install prompt — guide once to 共有 → ホーム画面に追加 (spec §6)
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        if (isIos && !standalone && guideSeen) {
          const dismissed = await storage.get('iosInstallHintDismissed');
          if (!dismissed) setIosInstallHint(true);
        }
      } catch (e) {
        console.error('Load error:', e);
      } finally {
        setLoading(false);
      }
      // After the local data is on screen: silently resume the Drive session
      // (token is memory-only, but a live Google session needs no UI).
      // Only when that fails do we fall back to the manual login hint.
      if (adapter.isConfigured() && (await adapter.hadSession())) {
        const resumed = await adapter.tryResume();
        if (!resumed) setSyncHint(true);
      }
    }
    loadInitial();

    // Drive had newer data on sign-in → adopt it wholesale (last-write-wins)
    adapter.setRemoteHandler((data) => {
      setEntries(data.entries || {});
      setCustomGames(data.customGames || []);
    });
    return adapter.subscribe(({ status, signedIn }) => {
      setSyncStatus(status);
      setIsSignedIn(signedIn);
    });
  }, []);

  const toggleTheme = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { await storage.set('theme', next); } catch (e) {}
  };

  // ── WordPress(mone2.jp)連携: アフィリエイト枠と固定ページ ──
  useEffect(() => {
    let alive = true;
    wp.loadAds((list) => {
      if (alive && Array.isArray(list)) { setAds(list); setAdIndex(0); }
    });
    return () => { alive = false; };
  }, []);

  // PR スライダーの自動送り(2枚以上のとき。5秒ごと)
  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setAdIndex((i) => (i + 1) % ads.length), 5000);
    return () => clearInterval(t);
  }, [ads.length]);

  // ── Welcome guide (first run, re-openable from menu) ──
  const GUIDE_SLIDES = [
    {
      icon: 'logo',
      title: t('VILDUP へようこそ'),
      body: t('日々のセットアップを記録して、自分だけの最適解を積み上げていく「セットアップ日記」です。'),
    },
    {
      icon: CalendarDays,
      title: t('記録する'),
      body: t('日付をタップして、マウス・感度・キーボード設定と、その日の手応えを評価(★)で記録しましょう。'),
    },
    {
      icon: Cloud,
      title: t('同期 & クリップ'),
      body: t('Google ログインで PC とスマホの記録を同期。プレイ動画も添付できます(動画はあなた自身の Google Drive に保存されます)。'),
    },
    {
      icon: Gem,
      title: t('続けるほど見えてくる'),
      body: t('Record で記録した日数に応じて称号を集め、Analysis で「勝てた日の構成」を分析。ホーム画面に追加すればアプリとして使えます。'),
    },
  ];

  const openGuide = () => {
    setMenuOpen(false);
    setGuideStep(0);
    setGuideOpen(true);
  };

  const closeGuide = async () => {
    setGuideOpen(false);
    try { await storage.set('welcomeGuideSeen', '1'); } catch (e) {}
  };

  const openInfoPage = (kind) => {
    setMenuOpen(false);
    const fallbackTitle = { about: t('このアプリについて'), privacy: t('プライバシーポリシー'), adpolicy: t('広告ポリシー') }[kind] || '';
    setInfoPage({ kind, title: fallbackTitle, html: null });
    wp.loadPage(kind, (page) => {
      setInfoPage((prev) => {
        if (!prev || prev.kind !== kind) return prev;
        if (!page) return { ...prev, html: '<p>' + t('このページは準備中です。') + '</p>' };
        return { kind, title: page.title || fallbackTitle, html: page.html };
      });
    });
  };

  const changeLang = async (code) => {
    setLang(code);
    try { await storage.set('lang', code); } catch (e) {}
  };

  const dismissIosInstallHint = async () => {
    setIosInstallHint(false);
    try { await storage.set('iosInstallHintDismissed', '1'); } catch (e) {}
  };

  // ── Google Drive sync (Phase 2) ──
  const SYNC_LABELS = {
    connecting: t('接続中…'),
    syncing: t('同期中…'),
    synced: t('Drive 同期済み'),
    offline: t('オフライン(未同期)'),
    'needs-login': t('再ログインが必要'),
    error: t('同期エラー(自動再試行)'),
    local: t('ローカル保存'),
  };

  const handleLogin = async () => {
    if (!adapter.isConfigured()) {
      setImportNotice({ ok: false, msg: t('Google クライアント ID が未設定です(.env の VITE_GOOGLE_CLIENT_ID を設定してください)') });
      return;
    }
    setAuthBusy(true);
    try {
      await adapter.signIn();
      setSyncHint(false);
      setImportNotice({ ok: true, msg: t('Google Drive と接続しました。データを同期します。') });
      setTimeout(() => setImportNotice(null), 4000);
    } catch (e) {
      console.error('Sign-in error:', e);
      setImportNotice({ ok: false, msg: t('ログインできませんでした: {e}').replace('{e}', e.message || e) });
    } finally {
      setAuthBusy(false);
    }
  };

  const confirmLogout = async (keepLocal) => {
    setLogoutConfirm(false);
    try {
      await adapter.signOut({ keepLocal });
      if (!keepLocal) {
        setEntries({});
        setCustomGames([]);
      }
    } catch (e) {
      console.error('Sign-out error:', e);
    }
  };

  // Latest entry across all days (newest day, last item) — used for carry-over
  const latestEntryOverall = () => {
    const keys = Object.keys(entries).sort((a, b) => b.localeCompare(a));
    for (const k of keys) {
      const list = entries[k];
      if (list && list.length) return { key: k, entry: list[list.length - 1] };
    }
    return null;
  };

  // ── Form initialization on date/entry selection ──
  useEffect(() => {
    if (!selectedDate) return;
    cleanupPendingUpload(); // switching entries abandons an unfinished upload
    setThumbUrl(null);
    setClipLoading(false);
    setDeleteClipConfirm(false);
    setVideoShare({ status: 'idle', files: null, key: null });
    const key = formatDateKey(selectedDate);
    const dayList = entries[key] || [];

    if (selectedEntryId) {
      const entry = dayList.find(e => e.id === selectedEntryId);
      if (entry) {
        setFormData({
          ...EMPTY_FORM,
          ...entry,
          photos: (entry.photos || []).map((p) => ({ ...p, id: p.id || genId() })),
        });
        setPrefilledFrom(null);
      }
    } else {
      // New entry — carry over setup from the most recent entry anywhere
      const last = latestEntryOverall();
      if (last) {
        const ld = last.entry;
        setFormData({
          ...EMPTY_FORM,
          game: ld.game || '',
          mouse: ld.mouse || '',
          mousepad: ld.mousepad || '',
          keyboard: ld.keyboard || '',
          dpi: ld.dpi || '',
          sens: ld.sens || '',
          pollingRate: ld.pollingRate || '',
          lod: ld.lod || '',
          kbAp: ld.kbAp || '',
          kbRt: ld.kbRt || '',
          kbPollingRate: ld.kbPollingRate || '',
          // rating, memo, clipUrl, clipFile deliberately left empty
        });
        setPrefilledFrom(last.key);
      } else {
        setFormData(EMPTY_FORM);
        setPrefilledFrom(null);
      }
    }

    setGameDropdownOpen(false);
    setNewGameInput('');
    setShareOpen(false);
  }, [selectedDate, selectedEntryId]);

  // Drive thumbnail for a saved clip. Right after an upload Drive hasn't
  // generated one yet, so poll a few times before giving up.
  useEffect(() => {
    const driveId = formData.clipFile?.driveId;
    if (!driveId || !isSignedIn || formData.clipFile?.blobUrl) {
      setThumbUrl(null);
      return;
    }
    let alive = true;
    let timer = null;
    let tries = 0;
    const attempt = () => {
      adapter.getClipThumb(driveId)
        .then((url) => {
          if (!alive) return;
          if (url) setThumbUrl(url);
          else if (++tries < 4) timer = setTimeout(attempt, 5000);
        })
        .catch(() => {});
    };
    attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [formData.clipFile?.driveId, formData.clipFile?.blobUrl, isSignedIn]);

  const clearPrefilled = () => {
    setFormData(EMPTY_FORM);
    setPrefilledFrom(null);
  };

  // Close modal on Escape key
  useEffect(() => {
    if (!selectedDate) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (gameDropdownOpen) { setGameDropdownOpen(false); return; }
        if (shareOpen) { setShareOpen(false); return; }
        closeModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDate, gameDropdownOpen, shareOpen]);

  // ── File upload handlers ──
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  };

  // Abort an in-flight upload and remove its Drive file if it was never
  // attached to a saved entry (prevents orphans in clips/).
  const cleanupPendingUpload = () => {
    const u = uploadRef.current;
    if (u) {
      u.abort?.();
      if (u.driveId && !u.saved) adapter.deleteClip(u.driveId).catch(() => {});
      uploadRef.current = null;
    }
    // 未保存のままになった写真の Drive ファイルを削除(孤児防止)
    for (const h of pendingPhotosRef.current) {
      h.abort?.();
      if (h.driveId && !h.saved) adapter.deleteClip(h.driveId).catch(() => {});
    }
    pendingPhotosRef.current = [];
  };

  const startUpload = (file, blobUrl) => {
    const dateKey = formatDateKey(selectedDate);
    const handle = { file, abort: null, driveId: null, saved: false };
    uploadRef.current = handle;
    // progress callbacks guard on blobUrl so a replaced clip ignores stale events
    adapter.uploadClip(file, dateKey, (frac) => {
      setFormData((prev) => prev.clipFile?.blobUrl === blobUrl
        ? { ...prev, clipFile: { ...prev.clipFile, status: 'uploading', progress: Math.min(99, Math.round(frac * 100)) } }
        : prev);
    }, handle).then((driveId) => {
      handle.driveId = driveId;
      setFormData((prev) => prev.clipFile?.blobUrl === blobUrl
        ? { ...prev, clipFile: { ...prev.clipFile, status: 'done', progress: 100, driveId } }
        : prev);
    }).catch((e) => {
      if (e.aborted) return;
      console.error('Clip upload error:', e);
      setFormData((prev) => prev.clipFile?.blobUrl === blobUrl
        ? { ...prev, clipFile: { ...prev.clipFile, status: 'error' } }
        : prev);
    });
  };

  // Draw a ~480px poster frame from a local video Blob URL → JPEG data URL.
  // Stored inside clipFile (data.json) so previews show instantly everywhere
  // (modal, timeline, other devices) without relying on Drive's thumbnail
  // pipeline, which lags minutes behind uploads and is auth-finicky in <img>.
  const captureVideoThumb = (blobUrl) => new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = blobUrl;
    video.onloadeddata = () => {
      try { video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1); } catch (e) { done(null); }
    };
    video.onseeked = () => {
      try {
        const w = Math.min(480, video.videoWidth || 480);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w) || 270);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.65));
      } catch (e) {
        done(null);
      }
      video.removeAttribute('src');
    };
    video.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });

  // 写真(複数可)。動画+写真で合計 MEDIA_MAX 枚まで。Drive に保存(クリップ基盤を再利用)。
  const mediaCount = (fd) => (fd.clipFile ? 1 : 0) + (fd.photos?.length || 0);

  const makeImageThumb = (blobUrl, max = 640) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.72));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = blobUrl;
  });

  const acceptPhotos = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f && f.type.startsWith('image/'));
    if (!files.length) return;
    if (!isSignedIn) {
      setImportNotice({ ok: false, msg: t('写真の保存には Google ログインが必要です') });
      return;
    }
    const dateKey = formatDateKey(selectedDate);
    let remaining = MEDIA_MAX - mediaCount(formData);
    if (remaining <= 0) {
      setImportNotice({ ok: false, msg: t('メディアは1記録あたり合計{n}つまでです').replace('{n}', MEDIA_MAX) });
      return;
    }
    const take = files.slice(0, remaining);
    if (files.length > take.length) {
      setImportNotice({ ok: false, msg: t('合計{n}つまでのため {m} 枚だけ追加しました').replace('{n}', MEDIA_MAX).replace('{m}', take.length) });
    }
    for (const file of take) {
      const id = genId();
      const blobUrl = URL.createObjectURL(file);
      const handle = { id, driveId: null, saved: false, abort: null, file };
      pendingPhotosRef.current.push(handle);
      setFormData((prev) => ({
        ...prev,
        photos: [...(prev.photos || []), { id, name: file.name, type: file.type, blobUrl, status: 'uploading', progress: 0 }],
      }));
      makeImageThumb(blobUrl).then((thumb) => {
        if (thumb) setFormData((prev) => ({ ...prev, photos: (prev.photos || []).map((p) => p.id === id ? { ...p, thumb } : p) }));
      });
      adapter.uploadClip(file, dateKey, (frac) => {
        setFormData((prev) => ({ ...prev, photos: (prev.photos || []).map((p) => p.id === id ? { ...p, status: 'uploading', progress: Math.min(99, Math.round(frac * 100)) } : p) }));
      }, handle).then((driveId) => {
        handle.driveId = driveId;
        setFormData((prev) => ({ ...prev, photos: (prev.photos || []).map((p) => p.id === id ? { ...p, driveId, status: 'done', progress: 100 } : p) }));
      }).catch((e) => {
        if (e.aborted) return;
        console.error('Photo upload error:', e);
        setFormData((prev) => ({ ...prev, photos: (prev.photos || []).map((p) => p.id === id ? { ...p, status: 'error' } : p) }));
      });
    }
  };

  const removePhoto = (id) => {
    const handle = pendingPhotosRef.current.find((h) => h.id === id);
    if (handle) {
      handle.abort?.();
      if (handle.driveId && !handle.saved) adapter.deleteClip(handle.driveId).catch(() => {});
      pendingPhotosRef.current = pendingPhotosRef.current.filter((h) => h.id !== id);
    }
    setFormData((prev) => {
      const ph = (prev.photos || []).find((p) => p.id === id);
      if (ph?.blobUrl) URL.revokeObjectURL(ph.blobUrl);
      return { ...prev, photos: (prev.photos || []).filter((p) => p.id !== id) };
    });
  };

  // 保存済み写真をフルサイズ表示(Drive から取得)
  const openPhoto = async (photo) => {
    if (photo.blobUrl) { setLightbox({ url: photo.blobUrl, loading: false }); return; }
    if (!photo.driveId || !isSignedIn) return;
    setLightbox({ url: null, loading: true });
    try {
      const blob = await adapter.loadClipBlob(photo.driveId);
      setLightbox({ url: URL.createObjectURL(blob), loading: false, revoke: true });
    } catch (e) {
      setLightbox(null);
      setImportNotice({ ok: false, msg: t('写真の読み込みに失敗しました') });
    }
  };

  const acceptFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return;
    if (!isSignedIn) {
      setImportNotice({ ok: false, msg: t('クリップ動画の保存には Google ログインが必要です(URL 欄はログインなしで使えます)') });
      return;
    }
    if (!formData.clipFile && mediaCount(formData) >= MEDIA_MAX) {
      setImportNotice({ ok: false, msg: t('メディアは1記録あたり合計{n}つまでです(写真を減らしてください)').replace('{n}', MEDIA_MAX) });
      return;
    }
    cleanupPendingUpload();
    const blobUrl = URL.createObjectURL(file);
    setFormData((prev) => {
      if (prev.clipFile?.blobUrl) URL.revokeObjectURL(prev.clipFile.blobUrl);
      return { ...prev, clipFile: { name: file.name, size: file.size, type: file.type, blobUrl, status: 'uploading', progress: 0 } };
    });
    startUpload(file, blobUrl);
    captureVideoThumb(blobUrl).then((thumb) => {
      if (!thumb) return;
      setFormData((prev) => prev.clipFile?.blobUrl === blobUrl
        ? { ...prev, clipFile: { ...prev.clipFile, thumb } }
        : prev);
    });
  };

  const retryUpload = () => {
    const file = uploadRef.current?.file;
    const blobUrl = formData.clipFile?.blobUrl;
    if (!file || !blobUrl) return;
    setFormData((prev) => ({ ...prev, clipFile: { ...prev.clipFile, status: 'uploading', progress: 0 } }));
    startUpload(file, blobUrl);
  };

  // Drive playback: alt=media needs the auth header, so stream into a Blob URL
  const playClip = async () => {
    const driveId = formData.clipFile?.driveId;
    if (!driveId || clipLoading) return;
    setClipLoading(true);
    try {
      const blob = await getClipBlob(driveId);
      const blobUrl = URL.createObjectURL(blob);
      setFormData((prev) => prev.clipFile?.driveId === driveId
        ? { ...prev, clipFile: { ...prev.clipFile, blobUrl } }
        : prev);
      // backfill a poster frame for entries saved before thumbs existed,
      // and persist it so the timeline/other devices get it too
      if (!formData.clipFile.thumb) {
        captureVideoThumb(blobUrl).then((thumb) => {
          if (!thumb) return;
          setFormData((prev) => prev.clipFile?.driveId === driveId
            ? { ...prev, clipFile: { ...prev.clipFile, thumb } }
            : prev);
          const key = formatDateKey(selectedDate);
          const dayList = entries[key] || [];
          if (selectedEntryId && dayList.some(e => e.id === selectedEntryId && e.clipFile?.driveId === driveId)) {
            const newList = dayList.map(e => e.id === selectedEntryId
              ? { ...e, clipFile: { ...e.clipFile, thumb } }
              : e);
            const newEntries = { ...entries, [key]: newList };
            setEntries(newEntries);
            adapter.saveAll({ entries: newEntries, customGames }).catch(() => {});
          }
        });
      }
    } catch (e) {
      console.error('Clip load error:', e);
      setImportNotice({ ok: false, msg: t('クリップの読み込みに失敗しました') });
    } finally {
      setClipLoading(false);
    }
  };

  // Timeline inline playback: tap the thumbnail → play right there (no modal).
  // One active player at a time; the previous blob is revoked on switch.
  const playTimelineClip = async (entry) => {
    const driveId = entry.clipFile?.driveId;
    if (!driveId) return;
    if (!isSignedIn) {
      setImportNotice({ ok: false, msg: t('クリップの再生には Google ログインが必要です') });
      return;
    }
    if (tlPlayer?.id === entry.id) return;
    setTlPlayer((prev) => {
      if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
      return { id: entry.id, blobUrl: null, loading: true };
    });
    try {
      const blob = await getClipBlob(driveId);
      const url = URL.createObjectURL(blob);
      setTlPlayer((prev) => {
        if (prev?.id !== entry.id) {
          URL.revokeObjectURL(url);
          return prev;
        }
        return { id: entry.id, blobUrl: url, loading: false };
      });
    } catch (e) {
      console.error('Timeline clip load error:', e);
      setTlPlayer(null);
      setImportNotice({ ok: false, msg: t('クリップの読み込みに失敗しました') });
    }
  };

  // leaving the timeline stops inline playback and frees the blob
  useEffect(() => {
    if (view !== 'timeline') {
      setTlPlayer((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return null;
      });
    }
  }, [view]);

  // PC only: prefetch clips in the background, newest first (= the order
  // they appear on screen in the timeline), one at a time so playback feels
  // instant. Capped to the newest 4 to bound memory; mobile keeps the
  // on-demand behavior (data savings). Blobs live in memory; consumers mint
  // their own object URLs from them.
  useEffect(() => {
    if (!isSignedIn) return;
    if (!window.matchMedia('(min-width: 640px)').matches) return;
    const PRELOAD_MAX = 4;
    const ids = [];
    const keys = Object.keys(entries).sort((a, b) => b.localeCompare(a));
    for (const k of keys) {
      const list = entries[k] || [];
      for (let i = list.length - 1; i >= 0; i--) {
        const id = list[i]?.clipFile?.driveId;
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (ids.length >= PRELOAD_MAX) break;
    }
    const state = preloadRef.current;
    state.queue = ids.slice(0, PRELOAD_MAX).filter((id) => !state.cache.has(id));
    if (state.running) return; // the running pump picks up the new queue
    state.running = true;
    (async () => {
      while (state.queue.length) {
        const id = state.queue.shift();
        if (state.cache.has(id)) continue;
        try {
          const blob = await adapter.loadClipBlob(id);
          state.cache.set(id, blob);
          while (state.cache.size > PRELOAD_MAX) {
            state.cache.delete(state.cache.keys().next().value);
          }
        } catch (e) {
          // skip this clip; on-demand load still works
        }
      }
      state.running = false;
    })();
  }, [isSignedIn, entries]);

  // Use a prefetched Blob when available, else hit Drive.
  const getClipBlob = async (driveId) => {
    const cached = preloadRef.current.cache.get(driveId);
    if (cached) return cached;
    return adapter.loadClipBlob(driveId);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false); }
  };
  const handleFileDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
    e.target.value = '';
  };
  const removeClipFile = () => {
    cleanupPendingUpload();
    if (formData.clipFile?.blobUrl) URL.revokeObjectURL(formData.clipFile.blobUrl);
    setFormData({ ...formData, clipFile: null });
  };

  // Close modal, revoking any unsaved blob URL
  const closeModal = () => {
    cleanupPendingUpload();
    setFormData((prev) => {
      if (prev.clipFile?.blobUrl) URL.revokeObjectURL(prev.clipFile.blobUrl);
      for (const p of (prev.photos || [])) if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
      return prev;
    });
    setThumbUrl(null);
    setClipLoading(false);
    setDeleteClipConfirm(false);
    setVideoShare({ status: 'idle', files: null, key: null });
    setLightbox(null);
    setSelectedDate(null);
    setSelectedEntryId(null);
  };

  // Open a day: edit its latest entry, or start new if empty
  const openDate = (d) => {
    const key = formatDateKey(d);
    const list = entries[key] || [];
    setSelectedEntryId(list.length ? list[list.length - 1].id : null);
    setSelectedDate(d);
  };

  const openEntry = (date, id) => {
    setSelectedEntryId(id);
    setSelectedDate(date);
  };

  const handleSave = async () => {
    const key = formatDateKey(selectedDate);
    const hasData = Object.values(formData).some(v => v && (typeof v === 'string' ? v.trim() : true));
    try {
      if (hasData) {
        const toSave = { ...formData };
        if (toSave.clipFile) {
          const { name, size, type, driveId, thumb } = toSave.clipFile;
          if (driveId) {
            toSave.clipFile = { name, size, type, driveId, ...(thumb ? { thumb } : {}) }; // driveId is canonical (spec §3.2)
          } else if (toSave.clipFile.blobUrl || toSave.clipFile.status) {
            toSave.clipFile = null; // unfinished/failed upload — never persist
          }
          // else: legacy metadata-only record (old mock data) — keep as-is
        }
        // 写真: アップロード完了(driveId あり)のみ永続化。blobUrl/status/id は落とす
        const prevPhotos = (entries[key] || []).find(e => e.id === selectedEntryId)?.photos || [];
        toSave.photos = (toSave.photos || [])
          .filter((p) => p.driveId)
          .map((p) => ({ name: p.name, type: p.type, driveId: p.driveId, ...(p.thumb ? { thumb: p.thumb } : {}) }));
        // 保存に含まれた driveId は「保存済み」に。差し替え/削除された写真は Drive から消す
        const keptIds = new Set(toSave.photos.map((p) => p.driveId));
        for (const h of pendingPhotosRef.current) if (keptIds.has(h.driveId)) h.saved = true;
        for (const p of prevPhotos) if (p.driveId && !keptIds.has(p.driveId)) adapter.deleteClip(p.driveId).catch(() => {});
        const dayList = entries[key] || [];
        let newList;
        if (selectedEntryId && dayList.some(e => e.id === selectedEntryId)) {
          newList = dayList.map(e => e.id === selectedEntryId ? { ...toSave, id: selectedEntryId } : e);
        } else {
          newList = [...dayList, { ...toSave, id: genId() }];
        }
        const newEntries = { ...entries, [key]: newList };
        await adapter.saveAll({ entries: newEntries, customGames });
        setEntries(newEntries);
        // a replaced/removed clip leaves its old Drive file behind — clean it up
        const prevClipId = dayList.find(e => e.id === selectedEntryId)?.clipFile?.driveId;
        if (prevClipId && prevClipId !== toSave.clipFile?.driveId) {
          adapter.deleteClip(prevClipId).catch(() => {});
        }
        if (uploadRef.current) uploadRef.current.saved = true;
        if (formData.clipFile?.blobUrl) URL.revokeObjectURL(formData.clipFile.blobUrl);
        for (const p of (formData.photos || [])) if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
      }
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setSelectedDate(null);
        setSelectedEntryId(null);
      }, 600);
    } catch (e) {
      console.error('Save error:', e);
    }
  };

  const performDelete = async (alsoDeleteClip) => {
    setDeleteClipConfirm(false);
    const key = formatDateKey(selectedDate);
    const dayList = entries[key] || [];
    const target = dayList.find(e => e.id === selectedEntryId);
    const newList = dayList.filter(e => e.id !== selectedEntryId);
    try {
      const newEntries = { ...entries };
      if (newList.length === 0) {
        delete newEntries[key];
      } else {
        newEntries[key] = newList;
      }
      await adapter.saveAll({ entries: newEntries, customGames });
      setEntries(newEntries);
      if (alsoDeleteClip) {
        if (target?.clipFile?.driveId) adapter.deleteClip(target.clipFile.driveId).catch(() => {});
        for (const p of (target?.photos || [])) if (p.driveId) adapter.deleteClip(p.driveId).catch(() => {});
      }
      closeModal();
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleDelete = () => {
    const key = formatDateKey(selectedDate);
    const target = (entries[key] || []).find(e => e.id === selectedEntryId);
    // ask about Drive media only when there is something we can actually delete
    const hasMedia = target?.clipFile?.driveId || (target?.photos || []).some(p => p.driveId);
    if (hasMedia && isSignedIn) {
      setDeleteClipConfirm(true);
      return;
    }
    performDelete(false);
  };

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const addCustomGame = async () => {
    const name = newGameInput.trim();
    if (!name || allGames.some(g => g.toLowerCase() === name.toLowerCase())) return;
    const updated = [...customGames, name];
    setCustomGames(updated);
    setFormData({ ...formData, game: name });
    setNewGameInput('');
    setGameDropdownOpen(false);
    try {
      await adapter.saveAll({ entries, customGames: updated });
    } catch (e) {
      console.error('Save custom games error:', e);
    }
  };

  const handleRatingClick = (value) => {
    setFormData({ ...formData, rating: formData.rating === value ? value - 0.5 : value });
  };

  // ── Share ──
  const buildShareText = (data, date) => {
    // ミニマル路線: 絵文字なし。中黒「·」区切り、ダッシュ見出し。
    const lines = [];
    const dateStr = formatDateKey(date).replace(/-/g, '.');
    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()];
    lines.push(`${dateStr} (${dow})`);

    const mouseSpec = [];
    if (data.dpi) mouseSpec.push(`${data.dpi} dpi`);
    if (data.sens) mouseSpec.push(`${data.sens} sens`);
    if (data.pollingRate) mouseSpec.push(`${data.pollingRate} Hz`);
    if (data.lod) mouseSpec.push(`LoD ${data.lod}`);
    const kbSpec = [];
    if (data.kbAp) kbSpec.push(`AP ${data.kbAp}`);
    if (data.kbRt) kbSpec.push(`RT ${data.kbRt}`);
    if (data.kbPollingRate) kbSpec.push(`${data.kbPollingRate} Hz`);

    // ギアは1ブロックにまとめる(間に空行を入れない)
    const gear = [];
    if (data.mouse) gear.push(`Mouse — ${data.mouse}`);
    if (mouseSpec.length) gear.push(mouseSpec.join(' · '));
    if (data.mousepad) gear.push(`Pad — ${data.mousepad}`);
    if (data.keyboard) gear.push(`Keyboard — ${data.keyboard}`);
    if (kbSpec.length) gear.push(kbSpec.join(' · '));
    if (gear.length) { lines.push(''); lines.push(...gear); }

    if (data.memo && data.memo.trim()) {
      lines.push('');
      const memo = data.memo.trim();
      lines.push(`“${memo.length > 100 ? memo.slice(0, 97) + '…' : memo}”`);
    }

    lines.push('');
    lines.push('#VILDUP');
    return lines.join('\n');
  };

  const shareOnX = () => {
    const text = buildShareText(formData, selectedDate);
    const params = new URLSearchParams({ text });
    if (formData.clipUrl && formData.clipUrl.trim()) params.set('url', formData.clipUrl.trim());
    window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener,noreferrer');
    setShareOpen(false);
  };

  const copyShareText = async () => {
    let text = buildShareText(formData, selectedDate);
    if (formData.clipUrl && formData.clipUrl.trim()) text += `\n${formData.clipUrl.trim()}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  // X video post, with the fewest taps the web allows. X's intent URL can't
  // carry media and the X API needs a server, so:
  //  - the video is downloaded AUTOMATICALLY when the share menu opens
  //  - mobile: one tap opens the share sheet with the file (pick X there)
  //  - PC: one click saves the .mp4 and opens the X composer (drag & drop)
  // 共有対象メディア(動画 + 全写真)の署名と一覧
  const mediaList = (fd) => {
    const items = [];
    if (fd.clipFile && (fd.clipFile.blobUrl || fd.clipFile.driveId)) {
      items.push({ blobUrl: fd.clipFile.blobUrl, driveId: fd.clipFile.driveId, name: fd.clipFile.name || 'clip.mp4', type: fd.clipFile.type || 'video/mp4' });
    }
    for (const p of (fd.photos || [])) {
      if (p.blobUrl || p.driveId) items.push({ blobUrl: p.blobUrl, driveId: p.driveId, name: p.name || 'photo.jpg', type: p.type || 'image/jpeg' });
    }
    return items;
  };
  const mediaKey = (fd) => mediaList(fd).map((m) => m.driveId || m.blobUrl).join('|');

  const prepareMediaShare = async () => {
    const items = mediaList(formData);
    if (!items.length) return null;
    if (items.some((m) => !m.blobUrl) && !isSignedIn) {
      setImportNotice({ ok: false, msg: t('メディア付きポストには Google ログインが必要です') });
      return null;
    }
    const key = mediaKey(formData);
    if (videoShare.files && videoShare.key === key) return videoShare.files;
    if (videoSharePrepRef.current) return videoSharePrepRef.current;
    const job = (async () => {
      setVideoShare({ status: 'preparing', files: null, key });
      try {
        const files = [];
        for (const m of items) {
          const blob = m.blobUrl ? await (await fetch(m.blobUrl)).blob() : await getClipBlob(m.driveId);
          files.push(new File([blob], m.name, { type: m.type }));
        }
        setVideoShare({ status: 'ready', files, key });
        return files;
      } catch (e) {
        console.error('Media share prepare error:', e);
        setVideoShare({ status: 'idle', files: null, key: null });
        setImportNotice({ ok: false, msg: t('メディアの準備に失敗しました') });
        return null;
      } finally {
        videoSharePrepRef.current = null;
      }
    })();
    videoSharePrepRef.current = job;
    return job;
  };

  const shareVideoToX = async () => {
    const key = mediaKey(formData);
    let files = videoShare.key === key ? videoShare.files : null;
    if (!files) files = await prepareMediaShare();
    if (!files || !files.length) return;
    let text = buildShareText(formData, selectedDate);
    if (formData.clipUrl && formData.clipUrl.trim()) text += `\n${formData.clipUrl.trim()}`;
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, text });
        setShareOpen(false);
        setVideoShare({ status: 'idle', files: null, key: null });
      } catch (e) {
        if (e && e.name === 'NotAllowedError') {
          setImportNotice({ ok: false, msg: t('準備ができました。もう一度タップすると共有シートが開きます(共有先で X を選択)') });
        }
        // AbortError = user closed the sheet; keep the files for a retry
      }
    } else {
      // PC: save the files + open the X composer; the user drops them in
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      window.open(`https://x.com/intent/tweet?${new URLSearchParams({ text })}`, '_blank', 'noopener,noreferrer');
      setImportNotice({ ok: true, msg: t('メディアを保存しました({n}件)。開いた X の投稿画面にドラッグ&ドロップしてください。').replace('{n}', files.length) });
      setTimeout(() => setImportNotice(null), 8000);
    }
  };

  // start downloading the moment the share menu opens — by the time the user
  // taps the post button the files are usually ready (single-tap share)
  useEffect(() => {
    const items = mediaList(formData);
    if (shareOpen && items.length && (items.every((m) => m.blobUrl) || isSignedIn)) {
      prepareMediaShare();
    }
  }, [shareOpen]);

  // ── Export / Import ──
  const handleExport = () => {
    const payload = {
      app: 'settings-diary',
      version: 2,
      exportedAt: new Date().toISOString(),
      entries,
      customGames,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vildup-${formatDateKey(new Date()).replace(/-/g, '')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data.entries !== 'object' || data.entries === null) {
          setImportNotice({ ok: false, msg: t('形式が正しくありません(entries が見つかりません)') });
          return;
        }
        // Normalize: accept v1 (object per day) and v2 (array per day)
        const normalized = {};
        let count = 0;
        for (const [k, v] of Object.entries(data.entries)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
          const list = (Array.isArray(v) ? v : [v]).filter(Boolean).map(ensureId);
          if (list.length) { normalized[k] = list; count += list.length; }
        }
        if (count === 0) {
          setImportNotice({ ok: false, msg: t('インポートできるエントリーがありませんでした') });
          return;
        }
        // window.confirm() is unreliable in sandboxed iframes — ask in-app instead
        setImportNotice(null);
        setPendingImport({
          entries: normalized,
          customGames: Array.isArray(data.customGames) ? data.customGames : null,
          count,
        });
      } catch (err) {
        setImportNotice({ ok: false, msg: t('JSON の読み込みに失敗しました') });
      }
    };
    reader.readAsText(file);
  };

  const applyImport = async () => {
    if (!pendingImport) return;
    const { entries: normalized, customGames: importedGames, count } = pendingImport;
    try {
      await adapter.saveAll({ entries: normalized, customGames: importedGames || customGames });
      if (importedGames) setCustomGames(importedGames);
    } catch (err) {
      console.error('Import persist error:', err);
    }
    setEntries(normalized);
    setPendingImport(null);
    setImportNotice({ ok: true, msg: t('{n} 件のエントリーをインポートしました').replace('{n}', count) });
    setTimeout(() => setImportNotice(null), 4000);
  };

  const cancelImport = () => setPendingImport(null);

  // ── Derived data ──
  const days = getDaysInMonth(currentDate);
  const today = new Date();
  const isToday = (d) => d && d.toDateString() === today.toDateString();
  const monthLabel = `${currentDate.getFullYear()}.${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-`;
  const entryCount = Object.entries(entries)
    .filter(([k]) => k.startsWith(monthPrefix))
    .reduce((sum, [, list]) => sum + list.length, 0);

  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // Flat chronological list (oldest → newest) with per-same-game change detection
  const flatChrono = [];
  Object.entries(entries)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([k, list]) => list.forEach((entry, idx) => flatChrono.push({ key: k, entry, idx, dayCount: list.length })));

  const changeMap = {};
  {
    const lastByGame = {};
    for (const item of flatChrono) {
      const gameKey = item.entry.game || '';
      const prev = lastByGame[gameKey];
      const changed = new Set();
      if (prev) {
        for (const f of SETUP_FIELDS) {
          const av = (prev.entry[f] || '').toString();
          const bv = (item.entry[f] || '').toString();
          if (av !== bv && (av || bv)) changed.add(f);
        }
      }
      changeMap[item.entry.id] = changed;
      lastByGame[gameKey] = item;
    }
  }

  const uniqueGames = [...new Set(flatChrono.map(i => i.entry.game).filter(Boolean))].sort();

  // Device suggestions derived from history (feature: preset dictionary, zero management)
  const uniqueDevices = (field) => [...new Set(flatChrono.map(i => (i.entry[field] || '').trim()).filter(Boolean))].sort();
  const mouseSuggestions = uniqueDevices('mouse');
  const mousepadSuggestions = uniqueDevices('mousepad');
  const keyboardSuggestions = uniqueDevices('keyboard');

  // Timeline list: newest first, then filtered
  const q = searchQuery.trim().toLowerCase();
  const timelineItems = [...flatChrono].reverse().filter(({ entry }) => {
    if (gameFilter !== 'ALL' && entry.game !== gameFilter) return false;
    if (q) {
      const hay = [entry.game, entry.mouse, entry.mousepad, entry.keyboard, entry.memo]
        .map(v => (v || '').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const totalEntries = flatChrono.length;

  // Value cell for timeline specs — highlights when changed vs previous same-game entry
  const SpecVal = ({ label, value, changed }) => (
    <div>
      <span className="tk-dim">{label} </span>
      <span className={changed ? 'font-semibold tk-acc' : ''}>{value}</span>
    </div>
  );

  const selectedDayList = selectedDate ? (entries[formatDateKey(selectedDate)] || []) : [];

  // ── Record / Analysis stats (cheap to recompute per render) ──
  const recordStats = computeRecordStats(entries);
  const analysisStats = computeAnalysis(flatChrono.map((i) => i.entry), { game: anGame });

  // Stats share: canvas → PNG. Built synchronously (toDataURL) so the user
  // gesture survives until navigator.share() on iOS.
  const shareStatsCard = (kind) => {
    try {
      const canvas = kind === 'record' ? drawRecordCard(recordStats) : drawAnalysisCard(analysisStats, anGame);
      const dataUrl = canvas.toDataURL('image/png');
      const bin = atob(dataUrl.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], `vildup-${kind}.png`, { type: 'image/png' });
      const text = kind === 'record'
        ? t('{n}日分のセットアップを記録 — 称号「{tier}」 #VILDUP').replace('{n}', recordStats.totalDays).replace('{tier}', recordStats.tier ? recordStats.tier.name : 'Stone')
        : t('自分に合うセットアップを分析しました #VILDUP');
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text }).catch(() => {});
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.open(`https://x.com/intent/tweet?${new URLSearchParams({ text })}`, '_blank', 'noopener,noreferrer');
        setImportNotice({ ok: true, msg: t('シェア画像を保存しました。X の投稿画面で画像を添付してください。') });
        setTimeout(() => setImportNotice(null), 6000);
      }
    } catch (e) {
      console.error('Share card error:', e);
      setImportNotice({ ok: false, msg: t('シェア画像の作成に失敗しました') });
    }
  };

  return (
    <div data-theme={theme} className="sd-root min-h-screen tk-ink" style={{
      fontFamily: '"Gen Interface JP","Helvetica Neue","Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif',
      WebkitFontSmoothing: 'antialiased',
    }}>
      <style>{`
        @import url('https://cdn.jsdelivr.net/npm/gen-interface-jp@0.6.2/cdn/300.css');
        @import url('https://cdn.jsdelivr.net/npm/gen-interface-jp@0.6.2/cdn/400.css');
        @import url('https://cdn.jsdelivr.net/npm/gen-interface-jp@0.6.2/cdn/500.css');
        @import url('https://cdn.jsdelivr.net/npm/gen-interface-jp@0.6.2/cdn/600.css');
        .sd-root {
          --paper:#f6f6f4; --card:rgba(255,255,255,.5); --modal:#f6f6f4;
          --ink:#17171f; --dim:#6e6e68; --faint:#8a8a83;
          --line:#e2e2de; --line2:#eeeeea;
          --accent:#4F0C28; --on-accent:#f6f6f4;
          --peri:#C5D2F8;
          --peri-soft:rgba(197,210,248,.3); --peri-softer:rgba(197,210,248,.25);
          --backdrop:rgba(23,23,31,.3);
          background:var(--paper);
        }
        .sd-root[data-theme="dark"] {
          --paper:#131316; --card:rgba(255,255,255,.03); --modal:#18181c;
          --ink:#ece9e2; --dim:#8f8f8c; --faint:#73736f;
          --line:#2a2a2e; --line2:#222226;
          --accent:#CB87A8; --on-accent:#131316;
          --peri:#C5D2F8;
          --peri-soft:rgba(197,210,248,.13); --peri-softer:rgba(197,210,248,.09);
          --backdrop:rgba(0,0,0,.55);
        }
        .sd-label {
          font-size: 9px; letter-spacing: .28em; color: var(--dim);
          margin-bottom: 10px; display: flex; align-items: baseline; gap: 8px;
          text-transform: uppercase; font-weight: 600;
        }
        .sd-input {
          background: transparent;
          border: 1px solid var(--line);
          border-radius: 2px;
          padding: 10px 12px;
          color: var(--ink);
          width: 100%;
          font-size: 13px;
          font-family: inherit;
          transition: border-color .15s;
        }
        .sd-input:focus { outline: none; border-color: var(--accent); }
        .sd-input::placeholder { color: var(--faint); }
        .sd-num { font-variant-numeric: tabular-nums; }
        .sd-scroll::-webkit-scrollbar { width: 6px; }
        .sd-scroll::-webkit-scrollbar-track { background: transparent; }
        .sd-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
        textarea.sd-input { resize: none; }
        /* var()-based color utilities — Tailwind arbitrary values with var() are
           unreliable in this renderer, so colors are applied via plain CSS */
        .tk-ink{color:var(--ink)} .tk-dim{color:var(--dim)} .tk-faint{color:var(--faint)}
        .tk-acc{color:var(--accent)} .tk-onacc{color:var(--on-accent)} .tk-line{color:var(--line)}
        .h-ink:hover:not(:disabled){color:var(--ink)}
        .h-acc:hover:not(:disabled){color:var(--accent)}
        .h-onacc:hover:not(:disabled){color:var(--on-accent)}
        .group:hover .gh-ink{color:var(--ink)}
        .bg-modal{background-color:var(--modal)} .bg-card{background-color:var(--card)}
        .bg-acc{background-color:var(--accent)} .bg-line{background-color:var(--line)}
        .bg-perisoft{background-color:var(--peri-soft)} .bg-perisofter{background-color:var(--peri-softer)}
        .bg-backdrop{background-color:var(--backdrop)}
        .hbg-perisoft:hover:not(:disabled){background-color:var(--peri-soft)}
        .hbg-perisofter:hover:not(:disabled){background-color:var(--peri-softer)}
        .hbg-acc:hover:not(:disabled){background-color:var(--accent)}
        .hbg-none:hover:not(:disabled){background-color:transparent}
        .bd-line{border-color:var(--line)} .bd-line2{border-color:var(--line2)}
        .bd-acc{border-color:var(--accent)} .bd-peri{border-color:var(--peri)} .bd-ink{border-color:var(--ink)}
        .hbd-line:hover:not(:disabled){border-color:var(--line)}
        .hbd-acc:hover:not(:disabled){border-color:var(--accent)}
        .dv-line2 > :not([hidden]) ~ :not([hidden]){border-color:var(--line2)}
        .fill-acc{fill:var(--accent)}
        .dec-peri{text-decoration-color:var(--peri)}
        .hdec-acc:hover{text-decoration-color:var(--accent)}
        .ring-perisoft{box-shadow:0 0 0 2px var(--peri-soft)}
        .sd-tbtn {
          font-size: 9px; letter-spacing: .16em; text-transform: uppercase;
          border: 1px solid var(--line); border-radius: 2px;
          color: var(--dim); background: transparent;
          padding: 8px 13px; cursor: pointer; transition: .15s;
          display: inline-flex; align-items: center; gap: 7px;
          font-family: inherit;
        }
        .sd-tbtn:hover { color: var(--accent); border-color: var(--accent); }
        .sd-tbtn.on { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
        .sd-tbtn:active { transform: scale(.95); }

        /* ── motion: easing-driven, subtle, reduced-motion aware ── */
        @keyframes vd-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes vd-pop { from { opacity: 0; transform: translateY(10px) scale(.975) } to { opacity: 1; transform: none } }
        @keyframes vd-sheet { from { opacity: 0; transform: translateY(34px) } to { opacity: 1; transform: none } }
        @keyframes vd-view { from { opacity: 0; transform: translateY(7px) } to { opacity: 1; transform: none } }
        .anim-backdrop { animation: vd-fade .22s ease-out both; }
        .anim-pop { animation: vd-pop .3s cubic-bezier(.16,1,.3,1) both; }
        .anim-sheet { animation: vd-sheet .34s cubic-bezier(.16,1,.3,1) both; }
        .anim-view { animation: vd-view .3s cubic-bezier(.16,1,.3,1) both; }
        .press { transition: transform .12s cubic-bezier(.16,1,.3,1), background-color .18s ease, color .18s ease, border-color .18s ease, box-shadow .2s ease; }
        .press:active { transform: scale(.96); }
        .lift { transition: transform .2s cubic-bezier(.16,1,.3,1), border-color .18s ease, box-shadow .25s ease; }
        .lift:hover { transform: translateY(-2px); }
        @media (prefers-reduced-motion: reduce) {
          .anim-backdrop, .anim-pop, .anim-sheet, .anim-view { animation: none; }
          .press:active, .sd-tbtn:active, .lift:hover { transform: none; }
        }
        .wp-prose p { margin: 0 0 1em; }
        .wp-prose h1, .wp-prose h2, .wp-prose h3, .wp-prose h4 { font-weight: 600; margin: 1.6em 0 .6em; font-size: 1.05em; letter-spacing: .04em; }
        .wp-prose ul, .wp-prose ol { margin: 0 0 1em; padding-left: 1.4em; list-style: disc; }
        .wp-prose ol { list-style: decimal; }
        .wp-prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
        .wp-prose img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 2px; }
        .wp-prose table { border-collapse: collapse; margin: 0 0 1em; }
        .wp-prose th, .wp-prose td { border: 1px solid var(--line); padding: .4em .7em; }
      `}</style>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-28 sm:pb-12">
        {/* Header */}
        <header className="mb-10 flex items-end justify-between flex-wrap gap-6">
          <div className="flex items-center gap-3.5">
            <img src="/favicon.svg" alt="" className="w-11 h-11 rounded-[10px] shrink-0" />
            <div>
              <h1 className="text-[19px] font-light uppercase leading-none flex items-baseline gap-2" style={{ letterSpacing: '.26em' }}>
                Vildup
                <span
                  className="text-[8px] tk-dim border bd-line rounded-[2px] px-1.5 py-0.5 normal-case shrink-0"
                  style={{ letterSpacing: '.1em' }}
                >
                  α 0.0.1 ver
                </span>
              </h1>
              <p className="text-[9px] tk-dim uppercase mt-2" style={{ letterSpacing: '.26em' }}>
                Setup Diary for Gamers
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="sd-num text-[19px] font-light leading-none" style={{ letterSpacing: '.06em' }}>
              {monthLabel}
            </div>
            <div className="text-[9px] tk-dim uppercase mt-2" style={{ letterSpacing: '.18em' }}>
              Today {formatDateKey(today)}
            </div>
          </div>
        </header>

        {/* PR / affiliate slider — managed in WordPress (広告関連 page), src/affiliates.js as fallback */}
        {ads.length > 0 && (
          <div className="mb-5">
            <div className="text-[8px] tk-faint uppercase mb-1.5" style={{ letterSpacing: '.24em' }}>PR</div>
            <div
              className="relative overflow-hidden rounded-[2px] border bd-line lift"
              onTouchStart={(e) => { adTouchX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (adTouchX.current == null || ads.length <= 1) return;
                const dx = e.changedTouches[0].clientX - adTouchX.current;
                if (dx > 40) setAdIndex((i) => (i - 1 + ads.length) % ads.length);
                else if (dx < -40) setAdIndex((i) => (i + 1) % ads.length);
                adTouchX.current = null;
              }}
            >
              <div
                className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${adIndex * 100}%)` }}
              >
                {ads.map((ad, i) => (
                  <a
                    key={i}
                    href={ad.href}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="block w-full shrink-0"
                    aria-hidden={i !== adIndex}
                    tabIndex={i === adIndex ? 0 : -1}
                  >
                    {ad.img ? (
                      <img src={ad.img} alt={ad.alt || ''} className="block w-full" draggable={false} />
                    ) : (
                      <span className="flex items-center justify-center min-h-[80px] text-[12px] tk-acc underline underline-offset-2 dec-peri hdec-acc px-3.5 py-2.5">
                        {ad.text} ↗
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
            {ads.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-2">
                {ads.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setAdIndex(i)}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === adIndex ? '18px' : '6px',
                      background: i === adIndex ? 'var(--accent)' : 'var(--line2)',
                    }}
                    aria-label={`PR ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Toolbar: desktop only (mobile uses the bottom nav incl. Menu) */}
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />
        <div className="mb-5 hidden sm:flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2">
            {[
              { id: 'calendar', label: 'Calendar' },
              { id: 'timeline', label: 'Timeline' },
              { id: 'stats', label: 'Stats' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`sd-tbtn ${view === tab.id ? 'on' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2 items-center">
            {isSignedIn && (
              <span
                className="text-[9px] uppercase tk-dim flex items-center gap-1.5 px-1"
                style={{ letterSpacing: '.16em' }}
                title={t('同期状態: {s}').replace('{s}', SYNC_LABELS[syncStatus] || syncStatus)}
              >
                {syncStatus === 'offline' || syncStatus === 'error' || syncStatus === 'needs-login'
                  ? <CloudOff className="w-3.5 h-3.5" strokeWidth={1.5} />
                  : <Cloud className="w-3.5 h-3.5 tk-acc" strokeWidth={1.5} />}
                <span>{SYNC_LABELS[syncStatus] || syncStatus}</span>
              </span>
            )}
            <button onClick={() => setMenuOpen(true)} className="sd-tbtn" title={t("メニュー")}>
              <Menu className="w-3.5 h-3.5" strokeWidth={1.5} /> Menu
            </button>
          </div>
        </div>

        {/* iOS: add-to-Home-Screen guide, shown once (spec §6) */}
        {iosInstallHint && (
          <div className="mb-5 border bd-peri rounded-[2px] px-4 py-3 flex items-center gap-3 flex-wrap bg-perisoft">
            <Share className="w-4 h-4 tk-acc shrink-0" strokeWidth={1.5} />
            <div className="text-[12px] flex-1 min-w-[200px]">
              {t('ホーム画面に追加するとアプリとして使えます:Safari の')}<span className="font-medium">{t('共有ボタン')}</span> →
              <span className="font-medium">{t('「ホーム画面に追加」')}</span>
            </div>
            <button onClick={dismissIosInstallHint} className="sd-tbtn">{t('閉じる')}</button>
          </div>
        )}

        {/* Drive re-login hint (token is memory-only, so each visit needs a click) */}
        {syncHint && !isSignedIn && (
          <div className="mb-5 border bd-peri rounded-[2px] px-4 py-3 flex items-center gap-3 flex-wrap bg-perisoft">
            <Cloud className="w-4 h-4 tk-acc shrink-0" strokeWidth={1.5} />
            <div className="text-[12px] flex-1 min-w-[200px]">
              {t('前回 Google Drive 同期を使用していました。ログインすると同期を再開します。')}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSyncHint(false)} className="sd-tbtn">{t('あとで')}</button>
              <button onClick={handleLogin} disabled={authBusy} className="sd-tbtn on">
                <LogIn className="w-3 h-3" strokeWidth={1.5} /> {t('ログイン')}
              </button>
            </div>
          </div>
        )}

        {/* Logout confirmation: keep or wipe the local cache (spec §4-5) */}
        {logoutConfirm && (
          <div className="mb-5 border bd-acc rounded-[2px] px-4 py-3.5 flex items-center gap-3 flex-wrap bg-perisofter">
            <AlertCircle className="w-4 h-4 tk-acc shrink-0" strokeWidth={1.5} />
            <div className="text-[12px] flex-1 min-w-[200px]">
              {t('Google からログアウトします。このブラウザのデータはどうしますか?')}
              <span className="tk-dim">{t('(Drive 上の data.json はどちらの場合も残ります)')}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setLogoutConfirm(false)} className="sd-tbtn">{t('キャンセル')}</button>
              <button onClick={() => confirmLogout(true)} className="sd-tbtn">{t('残してログアウト')}</button>
              <button onClick={() => confirmLogout(false)} className="sd-tbtn on">{t('削除してログアウト')}</button>
            </div>
          </div>
        )}

        {/* Pending import confirmation */}
        {pendingImport && (
          <div className="mb-5 border bd-acc rounded-[2px] px-4 py-3.5 flex items-center gap-3 flex-wrap bg-perisofter">
            <AlertCircle className="w-4 h-4 tk-acc shrink-0" strokeWidth={1.5} />
            <div className="text-[12px] flex-1 min-w-[200px]">
              <span className="sd-num font-semibold">{pendingImport.count}</span>{t('のエントリーをインポートします。')}
              <span className="tk-acc font-medium">{t('現在のデータはすべて置き換えられます。')}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={cancelImport} className="sd-tbtn">
                {t('キャンセル')}
              </button>
              <button onClick={applyImport} className="sd-tbtn on">
                {t('置き換えて続行')}
              </button>
            </div>
          </div>
        )}

        {/* Import notice */}
        {importNotice && (
          <div className={`mb-5 border rounded-[2px] px-3.5 py-2.5 text-[11px] flex items-center gap-2 ${
            importNotice.ok
              ? 'bd-peri bg-perisoft tk-ink'
              : 'bd-acc tk-acc'
          }`}>
            {importNotice.ok ? <Check className="w-3.5 h-3.5" strokeWidth={1.5} /> : <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.5} />}
            {importNotice.msg}
            <button onClick={() => setImportNotice(null)} className="ml-auto tk-dim h-ink">
              <X className="w-3 h-3" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {/* ── Calendar ── */}
        {view === 'calendar' && (
        <div key="v-calendar" className="border bd-line rounded-[2px] bg-card anim-view">
          <div className="flex items-center justify-between px-6 py-5 border-b bd-line">
            <button
              onClick={prevMonth}
              className="p-2 border border-transparent rounded-[2px] tk-dim h-ink hbd-line transition"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <div className="text-center">
              <div className="sd-num text-2xl font-light tracking-[.04em]">{monthLabel}</div>
              <div className="text-[9px] tk-dim uppercase mt-1" style={{ letterSpacing: '.28em' }}>
                {currentDate.toLocaleString('en-US', { month: 'long' })}
              </div>
            </div>
            <button
              onClick={nextMonth}
              className="p-2 border border-transparent rounded-[2px] tk-dim h-ink hbd-line transition"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 border-b bd-line">
            {weekdays.map((d) => (
              <div key={d} className="py-3 text-center text-[9px] tk-dim uppercase" style={{ letterSpacing: '.22em' }}>
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              if (!d) return <div key={i} className="aspect-square border-r border-b bd-line2 last:border-r-0" />;
              const key = formatDateKey(d);
              const dayList = entries[key] || [];
              const latest = dayList[dayList.length - 1];
              return (
                <button
                  key={i}
                  onClick={() => openDate(d)}
                  className={`aspect-square border-r border-b bd-line2 p-2 sm:p-3 text-left relative group transition hbg-perisofter ${(i + 1) % 7 === 0 ? 'border-r-0' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <span className={`sd-num text-sm sm:text-base ${
                      isToday(d)
                        ? 'font-semibold tk-acc'
                        : 'font-light tk-dim gh-ink'
                    }`}>
                      {String(d.getDate()).padStart(2, '0')}
                    </span>
                    {isToday(d) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-acc mt-1.5" />
                    )}
                  </div>
                  {latest && (
                    <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
                      {latest.game && (
                        <div className="text-[9px] sm:text-[10px] tk-acc font-medium truncate">
                          {latest.game}{dayList.length > 1 && <span className="tk-dim sd-num"> +{dayList.length - 1}</span>}
                        </div>
                      )}
                      {!latest.game && dayList.length > 1 && (
                        <div className="sd-num text-[9px] tk-dim">{dayList.length} entries</div>
                      )}
                      {latest.rating > 0 && (
                        <div className="sd-num text-[9px] tk-dim hidden sm:flex items-center gap-1">
                          <Star className="w-2 h-2 fill-acc tk-acc" strokeWidth={0} />
                          {latest.rating.toFixed(1)}
                        </div>
                      )}
                      {latest.sens && !latest.rating && (
                        <div className="sd-num text-[9px] tk-dim truncate hidden sm:block">
                          sens {latest.sens}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* ── Timeline ── */}
        {view === 'timeline' && (
        <div key="v-timeline" className="border bd-line rounded-[2px] bg-card anim-view">
          <div className="px-6 py-5 border-b bd-line">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <div className="text-[9px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.28em' }}>Timeline</div>
                <div className="sd-num text-2xl font-light">
                  {timelineItems.length}
                  {timelineItems.length !== totalEntries && (
                    <span className="tk-dim text-base font-normal"> / {totalEntries}</span>
                  )}
                  <span className="tk-dim text-sm font-normal ml-1.5">{totalEntries === 1 ? 'entry' : 'entries'}</span>
                </div>
              </div>
              <div className="text-[9px] tk-dim uppercase text-right" style={{ letterSpacing: '.18em' }}>
                Newest first<br/>
                <span style={{ letterSpacing: '.06em' }} className="normal-case tk-acc font-medium">{t('色付きの値 = 前回(同ゲーム)から変更')}</span>
              </div>
            </div>

            {/* Filters */}
            {totalEntries > 0 && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <div className="flex gap-1.5 flex-wrap">
                  {['ALL', ...uniqueGames].map(g => (
                    <button
                      key={g}
                      onClick={() => setGameFilter(g)}
                      className={`text-[10px] border rounded-[2px] px-2.5 py-1.5 transition ${
                        gameFilter === g
                          ? 'bg-acc tk-onacc bd-acc'
                          : 'bd-line tk-dim h-acc hbd-acc'
                      }`}
                      style={{ letterSpacing: '.05em' }}
                    >
                      {g === 'ALL' ? t('すべて') : g}
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="w-3.5 h-3.5 tk-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.5} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("メモ・デバイス名で検索")}
                    className="sd-input !w-52 !py-1.5 !pl-8 !pr-2.5 !text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {timelineItems.length === 0 ? (
            <div className="p-16 sm:p-24 text-center">
              <div className="text-[11px] tk-dim mb-5" style={{ letterSpacing: '.1em' }}>
                {totalEntries === 0 ? t('まだ記録がありません') : t('条件に一致する記録がありません')}
              </div>
              {totalEntries === 0 ? (
                <button
                  onClick={() => { setView('calendar'); openDate(new Date()); }}
                  className="sd-tbtn"
                >
                  Start logging
                </button>
              ) : (
                <button
                  onClick={() => { setGameFilter('ALL'); setSearchQuery(''); }}
                  className="sd-tbtn"
                >
                  {t('フィルタをクリア')}
                </button>
              )}
            </div>
          ) : (
            <div className="p-4 sm:p-8">
              {timelineItems.map(({ key, entry, idx, dayCount }, i) => {
                const [y, m, d] = key.split('-').map(Number);
                const date = new Date(y, m - 1, d);
                const isLast = i === timelineItems.length - 1;
                const ch = changeMap[entry.id] || new Set();
                return (
                  <div key={entry.id} className="flex gap-4 sm:gap-7">
                    {/* Date column */}
                    <div className="flex flex-col items-end pt-1 shrink-0 w-14 sm:w-24">
                      <div className="sd-num text-[10px] tk-dim hidden sm:block">{y}</div>
                      <div className="sd-num text-xl sm:text-2xl font-light leading-tight">
                        {String(m).padStart(2, '0')}<span className="tk-faint">.</span>{String(d).padStart(2, '0')}
                      </div>
                      <div className="text-[8px] tk-dim uppercase mt-0.5" style={{ letterSpacing: '.2em' }}>
                        {['SUN','MON','TUE','WED','THU','FRI','SAT'][date.getDay()]}
                        {dayCount > 1 && <span className="sd-num ml-1 normal-case">#{idx + 1}</span>}
                      </div>
                    </div>

                    {/* Timeline rail */}
                    <div className="flex flex-col items-center shrink-0 pt-2.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${ch.size > 0 ? 'bg-acc ring-perisoft' : 'bg-acc'}`} />
                      {!isLast && <div className="w-px flex-1 bg-line mt-2" />}
                    </div>

                    {/* Content card — tap anywhere (except the clip) to open details */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openEntry(date, entry.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openEntry(date, entry.id); }}
                      className={`flex-1 text-left border bd-line rounded-[2px] hbd-acc bg-card p-4 sm:p-5 transition group cursor-pointer ${isLast ? 'mb-2' : 'mb-5'}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {entry.game && (
                            <div className="text-[15px] font-semibold truncate">
                              {entry.game}
                            </div>
                          )}
                          {ch.size > 0 && (
                            <span className="text-[8px] uppercase tk-acc border bd-acc rounded-[2px] px-1.5 py-0.5 shrink-0 font-semibold" style={{ letterSpacing: '.14em' }}>
                              {ch.size} changed
                            </span>
                          )}
                        </div>
                        {entry.rating > 0 && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Star className="w-3 h-3 fill-acc tk-acc" strokeWidth={0} />
                            <span className="sd-num text-sm font-medium tk-acc">{entry.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>

                      {(entry.dpi || entry.sens || entry.pollingRate || entry.lod) && (
                        <div className="sd-num flex flex-wrap gap-x-5 gap-y-1 mb-2.5 text-[11px]">
                          {entry.dpi && <SpecVal label="DPI" value={entry.dpi} changed={ch.has('dpi')} />}
                          {entry.sens && <SpecVal label="SENS" value={entry.sens} changed={ch.has('sens')} />}
                          {entry.pollingRate && <SpecVal label="POLL" value={entry.pollingRate} changed={ch.has('pollingRate')} />}
                          {entry.lod && <SpecVal label="LoD" value={entry.lod} changed={ch.has('lod')} />}
                        </div>
                      )}

                      {(entry.kbAp || entry.kbRt || entry.kbPollingRate) && (
                        <div className="sd-num flex flex-wrap gap-x-5 gap-y-1 mb-2.5 text-[11px]">
                          {entry.kbAp && <SpecVal label="AP" value={entry.kbAp} changed={ch.has('kbAp')} />}
                          {entry.kbRt && <SpecVal label="RT" value={entry.kbRt} changed={ch.has('kbRt')} />}
                          {entry.kbPollingRate && <SpecVal label="KB POLL" value={entry.kbPollingRate} changed={ch.has('kbPollingRate')} />}
                        </div>
                      )}

                      {(entry.mouse || entry.mousepad || entry.keyboard) && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {entry.mouse && (
                            <span className={`text-[10px] border rounded-[2px] px-2 py-1 ${ch.has('mouse') ? 'bd-acc tk-acc font-medium' : 'bd-line tk-ink'}`}>
                              <span className="tk-dim">M </span>{entry.mouse}
                            </span>
                          )}
                          {entry.mousepad && (
                            <span className={`text-[10px] border rounded-[2px] px-2 py-1 ${ch.has('mousepad') ? 'bd-acc tk-acc font-medium' : 'bd-line tk-ink'}`}>
                              <span className="tk-dim">P </span>{entry.mousepad}
                            </span>
                          )}
                          {entry.keyboard && (
                            <span className={`text-[10px] border rounded-[2px] px-2 py-1 ${ch.has('keyboard') ? 'bd-acc tk-acc font-medium' : 'bd-line tk-ink'}`}>
                              <span className="tk-dim">K </span>{entry.keyboard}
                            </span>
                          )}
                        </div>
                      )}

                      {entry.memo && (
                        <p className="text-xs tk-dim mt-2.5 leading-relaxed line-clamp-3 whitespace-pre-wrap">
                          {entry.memo}
                        </p>
                      )}

                      {entry.clipFile && (
                        <div className="mt-3">
                          {tlPlayer?.id === entry.id && tlPlayer.blobUrl ? (
                            <video
                              src={tlPlayer.blobUrl}
                              controls
                              autoPlay
                              playsInline
                              onClick={(e) => e.stopPropagation()}
                              className="w-full max-w-[420px] max-h-72 bg-black rounded-[2px] border bd-line mb-2"
                            />
                          ) : entry.clipFile.driveId ? (
                            <div
                              onClick={(e) => { e.stopPropagation(); playTimelineClip(entry); }}
                              title={t("タップで再生")}
                              className="relative w-full max-w-[260px] aspect-video rounded-[2px] border bd-line mb-2 overflow-hidden bg-perisofter"
                            >
                              {entry.clipFile.thumb && (
                                <img src={entry.clipFile.thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
                              )}
                              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,.25)' }}>
                                <span className="px-3.5 py-2 text-[10px] uppercase border bd-acc rounded-[2px] bg-acc tk-onacc" style={{ letterSpacing: '.16em' }}>
                                  {tlPlayer?.id === entry.id && tlPlayer.loading ? t('読み込み中…') : t('▶ 再生')}
                                </span>
                              </div>
                            </div>
                          ) : entry.clipFile.thumb ? (
                            <img
                              src={entry.clipFile.thumb}
                              alt=""
                              className="w-full max-w-[260px] aspect-video object-cover rounded-[2px] border bd-line mb-2"
                            />
                          ) : null}
                          <div className="text-[10px] tk-ink flex items-center gap-1.5">
                            <Film className="w-3 h-3 tk-dim" strokeWidth={1.5} /> {entry.clipFile.name}
                            <span className="sd-num tk-dim">· {formatBytes(entry.clipFile.size)}</span>
                          </div>
                        </div>
                      )}

                      {(entry.photos || []).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entry.photos.map((p, pi) => (
                            <img
                              key={p.driveId || pi}
                              src={p.thumb}
                              alt=""
                              onClick={(e) => { e.stopPropagation(); openPhoto(p); }}
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              className="w-[72px] h-[72px] object-cover rounded-[3px] border bd-line cursor-pointer lift"
                            />
                          ))}
                        </div>
                      )}

                      {entry.clipUrl && (
                        <a
                          href={entry.clipUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] tk-acc underline underline-offset-2 dec-peri hdec-acc mt-3 inline-block transition"
                        >
                          {t('クリップを開く ↗')}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* ── Record ── */}
        {view === 'stats' && (
        <div key="v-record" className="border bd-line rounded-[2px] bg-card mb-5 anim-view">
          <div className="px-6 py-5 border-b bd-line flex items-end justify-between flex-wrap gap-3">
            <div>
              <div className="text-[9px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.28em' }}>Record</div>
              <div className="sd-num text-2xl font-light">
                {recordStats.totalDays}
                <span className="tk-dim text-sm font-normal ml-1.5">{recordStats.totalDays === 1 ? 'day' : 'days'} logged</span>
              </div>
            </div>
            <button onClick={() => shareStatsCard('record')} className="sd-tbtn" title={t("シェア画像を作成して X へ")}>
              <Share2 className="w-3 h-3" strokeWidth={1.5} /> {t('シェア画像')}
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-8">
            <div className="flex items-center gap-5 flex-wrap">
              <div
                className="w-16 h-16 rounded-[4px] shrink-0"
                style={{
                  background: recordStats.tier
                    ? (recordStats.tier.color2
                      ? `linear-gradient(135deg, ${recordStats.tier.color}, ${recordStats.tier.color2})`
                      : recordStats.tier.color)
                    : 'var(--line2)',
                }}
              />
              <div className="min-w-0">
                <div className="text-[9px] tk-dim uppercase mb-1" style={{ letterSpacing: '.22em' }}>{t('現在の称号')}</div>
                <div className="text-[30px] font-light leading-none">{recordStats.tier ? recordStats.tier.name : '—'}</div>
                {recordStats.next && (
                  <div className="text-[11px] tk-dim mt-2">
                    {t('次の称号')} <span className="font-medium tk-acc">{recordStats.next.name}</span>
                    {lang === 'ja' ? ' まで あと ' : ' — '}
                    <span className="sd-num font-semibold tk-ink">{recordStats.next.days - recordStats.totalDays}</span>
                    {lang === 'ja' ? ' 日' : ' d to go'}
                  </div>
                )}
              </div>
            </div>

            {recordStats.next && (
              <div className="h-1.5 bg-line rounded-full overflow-hidden">
                <div
                  className="h-full bg-acc transition-all"
                  style={{ width: `${Math.min(100, Math.round((recordStats.totalDays / recordStats.next.days) * 100))}%` }}
                />
              </div>
            )}

            <div className="border bd-peri bg-perisoft rounded-[2px] px-4 py-3.5 text-[12px] leading-relaxed">
              {t(recordStats.praise)}
            </div>

            <div className="border bd-line rounded-[2px] p-4">
              <div className="text-[8px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.18em' }}>{t('累計記録日数')}</div>
              <div className="sd-num text-[26px] font-light">{recordStats.totalDays}<span className="text-[12px] tk-dim ml-1">{t('日')}</span></div>
            </div>

            <div>
              <div className="text-[9px] tk-dim uppercase mb-2.5" style={{ letterSpacing: '.22em' }}>{t('直近 12 週間')}</div>
              <div className="flex gap-1 overflow-x-auto sd-scroll pb-1">
                {recordStats.heatWeeks.map((week, wi) => (
                  <div key={wi} className="flex flex-col gap-1">
                    {week.map((cell) => (
                      <div
                        key={cell.key}
                        title={`${cell.key} · ${cell.count}`}
                        className="w-3 h-3 rounded-[1px]"
                        style={{
                          background: cell.count ? 'var(--accent)' : 'var(--line2)',
                          opacity: cell.count ? Math.min(1, 0.45 + cell.count * 0.25) : 1,
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {!recordStats.loggedToday && (
              <div className="flex items-center justify-between gap-3 flex-wrap border bd-acc rounded-[2px] px-4 py-3 bg-perisofter">
                <span className="text-[12px]">{t('今日はまだ記録していません。1件記録して累計を伸ばしましょう。')}</span>
                <button onClick={() => { setView('calendar'); openDate(new Date()); }} className="sd-tbtn on">{t('今日を記録')}</button>
              </div>
            )}

            <div>
              <div className="text-[9px] tk-dim uppercase mb-2.5" style={{ letterSpacing: '.22em' }}>{t('称号ロードマップ')}</div>
              <div className="flex gap-1.5 flex-wrap">
                {recordStats.roadmap.map((tr) => (
                  <div
                    key={tr.name}
                    title={`${tr.days}${t('日')}`}
                    className={`text-[10px] border rounded-[2px] px-2.5 py-1.5 flex items-center gap-1.5 ${tr.reached ? 'bd-acc tk-ink' : 'bd-line tk-faint'}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-[1px] inline-block"
                      style={{
                        background: tr.color2 ? `linear-gradient(135deg, ${tr.color}, ${tr.color2})` : tr.color,
                        opacity: tr.reached ? 1 : 0.35,
                      }}
                    />
                    {tr.name}
                    <span className="sd-num tk-faint">{tr.days}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── Analysis ── */}
        {view === 'stats' && (
        <div key="v-analysis" className="border bd-line rounded-[2px] bg-card anim-view" style={{ animationDelay: '.05s' }}>
          <div className="px-6 py-5 border-b bd-line">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <div className="text-[9px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.28em' }}>Analysis</div>
                <div className="sd-num text-2xl font-light">
                  {analysisStats.ratedCount}
                  <span className="tk-dim text-sm font-normal ml-1.5">rated entries</span>
                </div>
              </div>
              <button onClick={() => shareStatsCard('analysis')} className="sd-tbtn" title={t("シェア画像を作成して X へ")}>
                <Share2 className="w-3 h-3" strokeWidth={1.5} /> {t('シェア画像')}
              </button>
            </div>
            {uniqueGames.length > 0 && (
              <div className="mt-4 flex gap-1.5 flex-wrap">
                {['ALL', ...uniqueGames].map((g) => (
                  <button
                    key={g}
                    onClick={() => setAnGame(g)}
                    className={`text-[10px] border rounded-[2px] px-2.5 py-1.5 transition ${
                      anGame === g ? 'bg-acc tk-onacc bd-acc' : 'bd-line tk-dim h-acc hbd-acc'
                    }`}
                    style={{ letterSpacing: '.05em' }}
                  >
                    {g === 'ALL' ? t('すべて') : g}
                  </button>
                ))}
              </div>
            )}
          </div>

          {analysisStats.ratedCount < 5 ? (
            <div className="p-16 sm:p-24 text-center">
              <div className="text-[11px] tk-dim mb-2" style={{ letterSpacing: '.1em' }}>
                {t('まだ集計に十分な記録がありません(評価付きの記録が 5 件以上必要です)')}
              </div>
              <div className="sd-num text-[11px] tk-faint mb-5">{analysisStats.ratedCount} / 5</div>
              <button onClick={() => { setView('calendar'); openDate(new Date()); }} className="sd-tbtn">
                {t('評価付きで記録する')}
              </button>
            </div>
          ) : (
            <div className="p-6 sm:p-8 space-y-8">
              <div>
                <div className="text-[9px] tk-dim uppercase mb-3" style={{ letterSpacing: '.22em' }}>
                  {t('ベストギア')} <span className="normal-case" style={{ letterSpacing: '.04em' }}>{t('(平均評価順)')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Mouse', tag: 'M', list: analysisStats.mouse },
                    { label: 'Mousepad', tag: 'P', list: analysisStats.mousepad },
                    { label: 'Keyboard', tag: 'K', list: analysisStats.keyboard },
                  ].map(({ label, tag, list }) => (
                    <div key={tag} className="border bd-line rounded-[2px] p-4">
                      <div className="text-[8px] tk-dim uppercase mb-2.5" style={{ letterSpacing: '.18em' }}>{label}</div>
                      {list.length === 0 ? (
                        <div className="text-[11px] tk-faint">{t('記録なし')}</div>
                      ) : (
                        <div className="space-y-2.5">
                          {list.slice(0, 3).map((g, i) => (
                            <div key={g.name} className="flex items-baseline gap-2 min-w-0">
                              <span className={`sd-num text-[11px] shrink-0 ${i === 0 ? 'tk-acc font-semibold' : 'tk-faint'}`}>{i + 1}</span>
                              <span className={`text-[12px] truncate ${i === 0 ? 'font-medium' : 'tk-dim'}`}>{g.name}</span>
                              <span className="sd-num text-[11px] tk-dim ml-auto shrink-0 flex items-center gap-1">
                                <Star className="w-2.5 h-2.5 fill-acc tk-acc" strokeWidth={0} />
                                {g.avg.toFixed(1)}
                                <span className="tk-faint">×{g.count}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[9px] tk-dim uppercase mb-3" style={{ letterSpacing: '.22em' }}>
                  {t('あなたのベスト構成')} <span className="normal-case" style={{ letterSpacing: '.04em' }}>(★{analysisStats.highRating.toFixed(1)} 以上の {analysisStats.highCount} 件から最頻値)</span>
                </div>
                {analysisStats.highCount === 0 ? (
                  <div className="text-[11px] tk-faint border bd-line rounded-[2px] p-4">
                    ★{analysisStats.highRating.toFixed(1)} 以上の記録がまだありません
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 border bd-line rounded-[2px] divide-x dv-line2">
                    {[
                      { label: 'DPI', v: analysisStats.best.dpi },
                      { label: 'Sens', v: analysisStats.best.sens },
                      { label: 'Polling Hz', v: analysisStats.best.pollingRate },
                      { label: 'LoD mm', v: analysisStats.best.lod },
                    ].map(({ label, v }) => (
                      <div key={label} className="p-4">
                        <div className="text-[8px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.18em' }}>{label}</div>
                        <div className="sd-num text-[22px] font-light tk-acc">{v ? v.value : '—'}</div>
                        {v && <div className="sd-num text-[10px] tk-faint mt-0.5">{v.count} 回採用</div>}
                      </div>
                    ))}
                  </div>
                )}
                {analysisStats.highCount > 0 && (
                  <div className="grid grid-cols-3 border bd-line rounded-[2px] divide-x dv-line2 mt-3">
                    {[
                      { label: 'AP mm', v: analysisStats.best.kbAp },
                      { label: 'RT mm', v: analysisStats.best.kbRt },
                      { label: 'KB Polling Hz', v: analysisStats.best.kbPollingRate },
                    ].map(({ label, v }) => (
                      <div key={label} className="p-4">
                        <div className="text-[8px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.18em' }}>{label}</div>
                        <div className="sd-num text-[22px] font-light tk-acc">{v ? v.value : '—'}</div>
                        {v && <div className="sd-num text-[10px] tk-faint mt-0.5">{v.count} 回採用</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Footer note */}
        <div className="mt-5 text-[9px] tk-faint uppercase flex justify-between flex-wrap gap-2" style={{ letterSpacing: '.18em' }}>
          <span>{isSignedIn ? t('日付を選択して記録 — Google Drive と同期') : t('日付を選択して記録 — ローカル保存(ログインなしで全機能利用可)')}</span>
          <span>{(isSignedIn ? 'Drive sync' : 'Local mode') + ' · α 0.0.1'}</span>
        </div>

        {/* Legal footer — affiliate disclosure + copyright */}
        <div className="mt-3 pt-3 border-t bd-line2 text-[10px] tk-faint flex items-center justify-between flex-wrap gap-2">
          <span>
            {t('本サイトには PR・アフィリエイトリンクを含みます。詳しくは')}
            <button onClick={() => openInfoPage('adpolicy')} className="tk-dim underline underline-offset-2 dec-peri hdec-acc h-acc transition">{t('広告ポリシー')}</button>
            {t('をご覧ください。')}
          </span>
          <span className="sd-num">© 2026 MONE²</span>
        </div>
      </div>

      {/* ── Welcome guide (first run + menu) ── */}
      {guideOpen && (() => {
        const slide = GUIDE_SLIDES[guideStep];
        const Icon = slide.icon;
        const isLast = guideStep === GUIDE_SLIDES.length - 1;
        return (
          <div className="fixed inset-0 z-50 bg-backdrop anim-backdrop flex items-center justify-center p-4">
            <div className="bg-modal border bd-line rounded-[3px] w-full max-w-sm overflow-hidden anim-pop">
              <div className="px-7 pt-9 pb-7 text-center">
                <div className="w-16 h-16 mx-auto mb-6 rounded-[14px] bg-perisoft flex items-center justify-center">
                  {Icon === 'logo'
                    ? <img src="/favicon.svg" alt="" className="w-11 h-11 rounded-[9px]" />
                    : <Icon className="w-7 h-7 tk-acc" strokeWidth={1.4} />}
                </div>
                <h3 className="text-[17px] font-medium mb-3" style={{ letterSpacing: '.04em' }}>{slide.title}</h3>
                <p className="text-[13px] tk-dim leading-relaxed min-h-[78px]">{slide.body}</p>
              </div>

              <div className="flex justify-center gap-1.5 pb-6">
                {GUIDE_SLIDES.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setGuideStep(i)}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === guideStep ? '20px' : '6px',
                      background: i === guideStep ? 'var(--accent)' : 'var(--line2)',
                    }}
                    aria-label={t('スライド {n}').replace('{n}', i + 1)}
                  />
                ))}
              </div>

              <div className="border-t bd-line px-5 py-4 flex items-center justify-between gap-3">
                {isLast ? (
                  <span className="text-[11px] tk-faint">{guideStep + 1} / {GUIDE_SLIDES.length}</span>
                ) : (
                  <button onClick={closeGuide} className="text-[11px] tk-dim h-acc transition px-2" style={{ letterSpacing: '.08em' }}>
                    {t('スキップ')}
                  </button>
                )}
                {isLast ? (
                  <button
                    onClick={closeGuide}
                    className="px-6 py-2.5 text-[10px] uppercase rounded-[2px] border bg-acc tk-onacc bd-acc transition flex items-center gap-2"
                    style={{ letterSpacing: '.16em' }}
                  >
                    {t('はじめる')}
                  </button>
                ) : (
                  <button
                    onClick={() => setGuideStep((s) => s + 1)}
                    className="px-6 py-2.5 text-[10px] uppercase rounded-[2px] border bg-acc tk-onacc bd-acc transition flex items-center gap-2"
                    style={{ letterSpacing: '.16em' }}
                  >
                    {t('次へ')} <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── WP info page modal (about / privacy — edited in WordPress) ── */}
      {infoPage && (
        <div
          className="fixed inset-0 z-50 bg-backdrop anim-backdrop flex items-center justify-center p-4 sm:p-8"
          onClick={() => setInfoPage(null)}
        >
          <div
            className="bg-modal border bd-line rounded-[2px] w-full max-w-2xl max-h-[85vh] overflow-y-auto sd-scroll anim-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-modal border-b bd-line px-6 py-4 flex items-center justify-between gap-3 z-10">
              <h3 className="text-[13px] font-medium truncate" style={{ letterSpacing: '.08em' }}>{infoPage.title}</h3>
              <button onClick={() => setInfoPage(null)} className="tk-dim h-acc transition shrink-0" title="閉じる">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            {infoPage.html === null ? (
              <div className="px-6 py-16 text-center text-[11px] tk-dim" style={{ letterSpacing: '.1em' }}>
                {t('読み込み中…')}
              </div>
            ) : (
              <div
                className="px-6 py-5 wp-prose text-[13px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: infoPage.html }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Photo lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 anim-backdrop flex items-center justify-center p-4"
          onClick={() => { if (lightbox.revoke && lightbox.url) URL.revokeObjectURL(lightbox.url); setLightbox(null); }}
        >
          {lightbox.loading
            ? <span className="text-white/80 text-[12px]" style={{ letterSpacing: '.1em' }}>{t('読み込み中…')}</span>
            : <img src={lightbox.url} alt="" className="max-w-full max-h-full object-contain rounded-[2px] anim-pop" onClick={(e) => e.stopPropagation()} />}
        </div>
      )}

      {/* ── Menu (bottom sheet on mobile, centered panel on desktop) ── */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-backdrop anim-backdrop flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="bg-modal border bd-line rounded-t-[14px] sm:rounded-[3px] w-full sm:max-w-xs overflow-hidden anim-sheet"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b bd-line">
              <span className="text-[9px] uppercase tk-dim flex items-center gap-1.5" style={{ letterSpacing: '.18em' }}>
                {isSignedIn
                  ? (syncStatus === 'offline' || syncStatus === 'error' || syncStatus === 'needs-login'
                      ? <CloudOff className="w-3.5 h-3.5" strokeWidth={1.5} />
                      : <Cloud className="w-3.5 h-3.5 tk-acc" strokeWidth={1.5} />)
                  : null}
                {isSignedIn ? (SYNC_LABELS[syncStatus] || syncStatus) : t('ローカルモード')}
              </span>
              <button onClick={() => setMenuOpen(false)} className="tk-dim h-acc transition" title="閉じる">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            {isSignedIn ? (
              <button onClick={() => { setMenuOpen(false); setLogoutConfirm(true); }}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left">
                <LogOut className="w-4 h-4 tk-dim" strokeWidth={1.5} /> {t('Google からログアウト')}
              </button>
            ) : (
              <button onClick={() => { setMenuOpen(false); handleLogin(); }} disabled={authBusy}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left disabled:opacity-50">
                <LogIn className="w-4 h-4 tk-dim" strokeWidth={1.5} /> {authBusy ? t('接続中…') : t('Google でログイン')}
              </button>
            )}
            <button onClick={() => { setMenuOpen(false); handleExport(); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              <Download className="w-4 h-4 tk-dim" strokeWidth={1.5} /> Export(JSON)
            </button>
            <button onClick={() => { setMenuOpen(false); importInputRef.current?.click(); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              <Upload className="w-4 h-4 tk-dim" strokeWidth={1.5} /> Import(JSON)
            </button>
            <button onClick={() => { setMenuOpen(false); toggleTheme(); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              {theme === 'light' ? <Moon className="w-4 h-4 tk-dim" strokeWidth={1.5} /> : <Sun className="w-4 h-4 tk-dim" strokeWidth={1.5} />}
              {theme === 'light' ? t('ダークモード') : t('ライトモード')}
            </button>
            <div className="flex items-center gap-2 px-4 py-3 border-t bd-line2">
              <Globe className="w-4 h-4 tk-dim shrink-0" strokeWidth={1.5} />
              <div className="flex gap-1.5">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => changeLang(l.code)}
                    className={`text-[11px] px-3 py-1.5 rounded-[2px] border transition press ${lang === l.code ? 'bg-acc tk-onacc bd-acc' : 'bd-line tk-dim hbd-acc'}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={openGuide}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              <Info className="w-4 h-4 tk-dim" strokeWidth={1.5} /> {t('使い方')}
            </button>
            <button onClick={() => openInfoPage('about')}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              <Info className="w-4 h-4 tk-dim" strokeWidth={1.5} /> {t('このアプリについて')}
            </button>
            <button onClick={() => openInfoPage('privacy')}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-[13px] hbg-perisoft transition text-left border-t bd-line2">
              <ShieldCheck className="w-4 h-4 tk-dim" strokeWidth={1.5} /> {t('プライバシーポリシー')}
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile bottom tab bar (app-like nav; desktop keeps the top tabs) ── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-modal border-t bd-line flex"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {[
          { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
          { id: 'timeline', label: 'Timeline', Icon: History },
          { id: 'stats', label: 'Stats', Icon: TrendingUp },
          { id: 'menu', label: 'Menu', Icon: Menu, action: true },
        ].map(({ id, label, Icon, action }) => {
          const active = !action && view === id;
          return (
            <button
              key={id}
              onClick={() => action ? setMenuOpen(true) : setView(id)}
              className={`flex-1 pt-2.5 pb-2 flex flex-col items-center gap-1 press ${active ? 'tk-acc' : 'tk-dim'}`}
            >
              <Icon className="w-5 h-5 transition-transform" strokeWidth={active ? 2 : 1.5} style={{ transform: active ? 'scale(1.08)' : 'none' }} />
              <span className="text-[9px] uppercase font-medium" style={{ letterSpacing: '.18em' }}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Entry Modal ── */}
      {selectedDate && (
        <div
          className="fixed inset-0 bg-backdrop backdrop-blur-[2px] anim-backdrop flex items-end sm:items-center justify-center z-50 p-0 sm:p-6"
          onClick={closeModal}
        >
          <div
            className="bg-modal border bd-line rounded-t-[14px] sm:rounded-[2px] w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto sd-scroll relative shadow-2xl shadow-black/10 anim-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="sticky top-0 bg-modal border-b bd-line px-6 py-5 z-10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[9px] tk-acc uppercase mb-1.5 font-semibold" style={{ letterSpacing: '.28em' }}>Log entry</div>
                  <div className="sd-num text-2xl font-light">{formatDateKey(selectedDate)}</div>
                  <div className="text-[11px] tk-dim mt-0.5">
                    {selectedDate.toLocaleDateString('ja-JP', { weekday: 'long' })}
                  </div>
                </div>
                <button
                  onClick={closeModal}
                  className="p-2 tk-dim h-ink border border-transparent hbd-line rounded-[2px] transition"
                >
                  <X className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>

              {/* Multi-entry chips */}
              {selectedDayList.length > 0 && (
                <div className="flex gap-1.5 mt-3.5 flex-wrap">
                  {selectedDayList.map((e, idx) => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedEntryId(e.id)}
                      className={`sd-num text-[10px] border rounded-[2px] px-2.5 py-1.5 transition ${
                        selectedEntryId === e.id
                          ? 'bg-acc tk-onacc bd-acc'
                          : 'bd-line tk-dim hbd-acc h-acc'
                      }`}
                    >
                      #{idx + 1}{e.game ? ` ${e.game}` : ''}
                    </button>
                  ))}
                  <button
                    onClick={() => setSelectedEntryId(null)}
                    className={`text-[10px] border rounded-[2px] px-2.5 py-1.5 transition flex items-center gap-1 ${
                      selectedEntryId === null
                        ? 'bg-acc tk-onacc bd-acc'
                        : 'bd-line tk-dim hbd-acc h-acc'
                    }`}
                  >
                    <Plus className="w-3 h-3" strokeWidth={1.5} /> New
                  </button>
                </div>
              )}
            </div>

            {/* Form */}
            <div className="px-6 py-6 space-y-7">
              {/* Carry-over banner */}
              {prefilledFrom && (
                <div className="border bd-peri rounded-[2px] bg-perisoft px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-2.5 min-w-0">
                    <span className="text-[9px] uppercase font-semibold tk-acc shrink-0" style={{ letterSpacing: '.18em' }}>{t('前回から引き継ぎ')}</span>
                    <span className="sd-num text-[11px] tk-ink truncate">
                      {prefilledFrom}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearPrefilled}
                    className="text-[9px] uppercase tk-dim h-acc shrink-0 transition"
                    style={{ letterSpacing: '.14em' }}
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* 01 — Game */}
              <div className="relative">
                <label className="sd-label">01 — Game</label>
                <button
                  type="button"
                  onClick={() => setGameDropdownOpen(!gameDropdownOpen)}
                  className="sd-input flex items-center justify-between text-left"
                >
                  <span className={formData.game ? 'font-medium' : 'tk-faint'}>
                    {formData.game || t('ゲームを選択...')}
                  </span>
                  <ChevronDown className={`w-4 h-4 tk-dim transition ${gameDropdownOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />
                </button>
                {gameDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 border bd-line rounded-[2px] bg-modal max-h-64 overflow-y-auto sd-scroll z-30 shadow-lg shadow-black/10">
                    <div className="text-[8px] tk-dim uppercase px-3.5 py-2 border-b bd-line" style={{ letterSpacing: '.28em' }}>Presets</div>
                    {PRESET_GAMES.map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => { setFormData({ ...formData, game: g }); setGameDropdownOpen(false); }}
                        className={`w-full text-left px-3.5 py-2 text-[12px] border-b bd-line2 last:border-b-0 hbg-perisoft transition ${formData.game === g ? 'font-semibold tk-acc' : 'tk-dim'}`}
                      >
                        {g}
                      </button>
                    ))}
                    {customGames.length > 0 && (
                      <>
                        <div className="text-[8px] tk-dim uppercase px-3.5 py-2 border-t border-b bd-line" style={{ letterSpacing: '.28em' }}>Custom</div>
                        {customGames.map(g => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => { setFormData({ ...formData, game: g }); setGameDropdownOpen(false); }}
                            className={`w-full text-left px-3.5 py-2 text-[12px] border-b bd-line2 last:border-b-0 hbg-perisoft transition ${formData.game === g ? 'font-semibold tk-acc' : 'tk-dim'}`}
                          >
                            {g}
                          </button>
                        ))}
                      </>
                    )}
                    <div className="border-t bd-line p-2 flex gap-1.5">
                      <input
                        type="text"
                        value={newGameInput}
                        onChange={(e) => setNewGameInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomGame(); } }}
                        placeholder={t("新しいゲームを追加...")}
                        className="sd-input flex-1 !py-1.5 !px-2.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={addCustomGame}
                        className="px-3.5 py-1.5 text-[9px] uppercase border bd-line rounded-[2px] tk-dim h-onacc hbg-acc hbd-acc transition flex items-center gap-1"
                        style={{ letterSpacing: '.14em' }}
                      >
                        <Plus className="w-3 h-3" strokeWidth={1.5} /> Add
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 02 — Rating */}
              <div>
                <label className="sd-label">
                  02 — Rating
                  <span className="ml-auto normal-case font-normal" style={{ letterSpacing: '.04em' }}>{t('星の左右で 0.5 刻み')}</span>
                </label>
                <div className="flex items-center gap-4">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(i => {
                      const v = formData.rating || 0;
                      const full = v >= i;
                      const half = v >= i - 0.5 && v < i;
                      return (
                        <div key={i} className="relative w-8 h-8">
                          <button
                            type="button"
                            onClick={() => handleRatingClick(i - 0.5)}
                            className="absolute left-0 top-0 w-1/2 h-full z-10 hbg-perisoft rounded-l-[2px]"
                            aria-label={`${i - 0.5} stars`}
                          />
                          <button
                            type="button"
                            onClick={() => handleRatingClick(i)}
                            className="absolute right-0 top-0 w-1/2 h-full z-10 hbg-perisoft rounded-r-[2px]"
                            aria-label={`${i} stars`}
                          />
                          <Star className="absolute inset-0 w-8 h-8 tk-line" strokeWidth={1} />
                          {full && (
                            <Star className="absolute inset-0 w-8 h-8 tk-acc fill-acc" strokeWidth={1} />
                          )}
                          {half && (
                            <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ width: '50%' }}>
                              <Star className="w-8 h-8 tk-acc fill-acc" strokeWidth={1} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="sd-num text-[26px] font-light tk-acc">
                    {(formData.rating || 0).toFixed(1)}
                    <span className="text-[13px] tk-dim ml-1">/5.0</span>
                  </div>
                  {formData.rating > 0 && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, rating: 0 })}
                      className="text-[9px] uppercase tk-faint h-acc ml-auto transition"
                      style={{ letterSpacing: '.14em' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* 03 — Mouse */}
              <div>
                <label className="sd-label">03 — Mouse</label>
                <div className="border bd-line rounded-[2px] divide-y dv-line2">
                  <div className="p-3.5">
                    <input
                      type="text"
                      list="dl-mouse"
                      className="sd-input !border-0 !p-0 !text-[13px]"
                      placeholder={t("マウス名(例: Logitech G PRO X SUPERLIGHT 2)")}
                      value={formData.mouse}
                      onChange={(e) => setFormData({ ...formData, mouse: e.target.value })}
                    />
                    <datalist id="dl-mouse">
                      {mouseSuggestions.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 divide-x dv-line2">
                    {[
                      { key: 'dpi', label: 'DPI', ph: '800' },
                      { key: 'sens', label: 'Sens', ph: '0.40' },
                      { key: 'pollingRate', label: 'Polling Hz', ph: '1000' },
                      { key: 'lod', label: 'LoD mm', ph: '1' },
                    ].map(f => (
                      <div key={f.key} className="p-3">
                        <div className="text-[8px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.2em' }}>{f.label}</div>
                        <input
                          type="text"
                          className="sd-input sd-num !border-0 !p-0 !text-[14px]"
                          placeholder={f.ph}
                          value={formData[f.key]}
                          onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 04 — Mousepad */}
              <div>
                <label className="sd-label">04 — Mousepad</label>
                <input
                  type="text"
                  list="dl-mousepad"
                  className="sd-input"
                  placeholder={t("マウスパッド名(例: Artisan Zero XSOFT)")}
                  value={formData.mousepad}
                  onChange={(e) => setFormData({ ...formData, mousepad: e.target.value })}
                />
                <datalist id="dl-mousepad">
                  {mousepadSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              {/* 05 — Keyboard */}
              <div>
                <label className="sd-label">05 — Keyboard</label>
                <div className="border bd-line rounded-[2px] divide-y dv-line2">
                  <div className="p-3.5">
                    <input
                      type="text"
                      list="dl-keyboard"
                      className="sd-input !border-0 !p-0 !text-[13px]"
                      placeholder={t("キーボード名(例: Wooting 60HE)")}
                      value={formData.keyboard}
                      onChange={(e) => setFormData({ ...formData, keyboard: e.target.value })}
                    />
                    <datalist id="dl-keyboard">
                      {keyboardSuggestions.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div className="grid grid-cols-3 divide-x dv-line2">
                    {[
                      { key: 'kbAp', label: 'AP mm', ph: '1.5' },
                      { key: 'kbRt', label: 'RT mm', ph: '0.1' },
                      { key: 'kbPollingRate', label: 'Polling Hz', ph: '1000' },
                    ].map(f => (
                      <div key={f.key} className="p-3">
                        <div className="text-[8px] tk-dim uppercase mb-1.5" style={{ letterSpacing: '.2em' }}>{f.label}</div>
                        <input
                          type="text"
                          className="sd-input sd-num !border-0 !p-0 !text-[14px]"
                          placeholder={f.ph}
                          value={formData[f.key]}
                          onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 06 — Memo */}
              <div>
                <label className="sd-label">06 — Memo</label>
                <textarea
                  className="sd-input"
                  rows={4}
                  placeholder={t("今日の調子、感じたこと、調整した設定など...")}
                  value={formData.memo}
                  onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                />

                {/* Photos (multiple, Drive-backed; counts toward the 4-media cap with the clip) */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => { acceptPhotos(e.target.files); e.target.value = ''; }}
                  className="hidden"
                />
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {(formData.photos || []).map((p) => (
                    <div key={p.id || p.driveId} className="relative w-[72px] h-[72px] rounded-[3px] overflow-hidden border bd-line bg-perisofter group">
                      {(p.thumb || p.blobUrl) ? (
                        <img
                          src={p.thumb || p.blobUrl}
                          alt={p.name || ''}
                          onClick={() => openPhoto(p)}
                          className="w-full h-full object-cover cursor-pointer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 tk-faint" strokeWidth={1.5} /></div>
                      )}
                      {p.status === 'uploading' && (
                        <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                          <span className="sd-num text-[10px] text-white">{p.progress || 0}%</span>
                        </div>
                      )}
                      {p.status === 'error' && (
                        <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                          <AlertCircle className="w-4 h-4 text-white" strokeWidth={1.5} />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        title={t("削除")}
                      >
                        <X className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                  {mediaCount(formData) < MEDIA_MAX && (
                    <button
                      type="button"
                      onClick={() => isSignedIn ? photoInputRef.current?.click() : setImportNotice({ ok: false, msg: t('写真の保存には Google ログインが必要です') })}
                      className="w-[72px] h-[72px] rounded-[3px] border border-dashed bd-line hbd-acc flex flex-col items-center justify-center gap-1 tk-dim h-acc transition press"
                      title={t("写真を追加")}
                    >
                      <Plus className="w-4 h-4" strokeWidth={1.5} />
                      <span className="text-[8px] uppercase" style={{ letterSpacing: '.14em' }}>{t('写真')}</span>
                    </button>
                  )}
                </div>
                <div className="text-[9px] tk-faint mt-1.5" style={{ letterSpacing: '.06em' }}>
                  {t('写真・動画は合計 {n} つまで').replace('{n}', MEDIA_MAX)}（{t('残り {n}').replace('{n}', Math.max(0, MEDIA_MAX - mediaCount(formData)))}）
                </div>
              </div>

              {/* 07 — Clip */}
              <div>
                <label className="sd-label">07 — Clip</label>

                {!formData.clipFile && (
                  <>
                    <div
                      onDragEnter={handleDragEnter}
                      onDragOver={(e) => e.preventDefault()}
                      onDragLeave={handleDragLeave}
                      onDrop={handleFileDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border border-dashed rounded-[2px] p-7 text-center transition cursor-pointer ${
                        dragOver
                          ? 'bd-acc bg-perisofter'
                          : 'bd-line hbd-acc'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/*"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <Upload className={`w-6 h-6 mx-auto mb-2.5 ${dragOver ? 'tk-acc' : 'tk-faint'}`} strokeWidth={1.2} />
                      <div className={`text-[10px] uppercase ${dragOver ? 'tk-acc' : 'tk-dim'}`} style={{ letterSpacing: '.22em' }}>
                        {dragOver ? t('ここにドロップ') : t('動画をドラッグ')}
                      </div>
                      <div className="text-[9px] tk-faint mt-1.5" style={{ letterSpacing: '.1em' }}>
                        {isSignedIn ? t('またはタップして選択') : t('クリップの保存には Google ログインが必要です')}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 my-3.5">
                      <div className="flex-1 h-px bg-line" />
                      <span className="text-[8px] tk-faint uppercase" style={{ letterSpacing: '.24em' }}>or paste URL</span>
                      <div className="flex-1 h-px bg-line" />
                    </div>
                    <input
                      type="url"
                      className="sd-input sd-num !text-xs"
                      placeholder="https://youtu.be/... or medal.tv/..."
                      value={formData.clipUrl}
                      onChange={(e) => setFormData({ ...formData, clipUrl: e.target.value })}
                    />
                    {formData.clipUrl && (
                      <a href={formData.clipUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] tk-acc underline underline-offset-2 dec-peri hdec-acc mt-2 inline-block transition">
                        {t('クリップを開く ↗')}
                      </a>
                    )}
                  </>
                )}

                {formData.clipFile && (
                  <div className="border bd-line rounded-[2px] overflow-hidden">
                    {formData.clipFile.blobUrl ? (
                      <video
                        src={formData.clipFile.blobUrl}
                        controls
                        autoPlay
                        playsInline
                        className="w-full max-h-72 bg-black"
                      />
                    ) : formData.clipFile.driveId ? (
                      <div className="aspect-video bg-perisofter relative flex items-center justify-center flex-col gap-3 p-4 overflow-hidden">
                        {(formData.clipFile.thumb || thumbUrl) && (
                          <>
                            <img
                              src={formData.clipFile.thumb || thumbUrl}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={() => setThumbUrl(null)}
                            />
                            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.3)' }} />
                          </>
                        )}
                        {isSignedIn ? (
                          <button
                            type="button"
                            onClick={playClip}
                            disabled={clipLoading}
                            className="relative z-10 px-5 py-2.5 text-[10px] uppercase border bd-acc rounded-[2px] bg-acc tk-onacc transition disabled:opacity-60"
                            style={{ letterSpacing: '.18em' }}
                          >
                            {clipLoading ? t('読み込み中…') : t('▶ 再生')}
                          </button>
                        ) : (
                          <div className="relative z-10 text-[9px] tk-dim text-center" style={{ letterSpacing: '.08em' }}>
                            {t('Google ログインすると Drive から再生できます')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="aspect-video bg-perisofter flex items-center justify-center flex-col gap-2.5 p-4">
                        <Film className="w-7 h-7 tk-faint" strokeWidth={1.2} />
                        <div className="text-[9px] tk-dim text-center leading-relaxed" style={{ letterSpacing: '.08em' }}>
                          {t('動画本体は保存されていません')}<br/>
                          <span className="tk-faint">{t('(ファイル情報のみの記録)')}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-3.5 border-t bd-line gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate flex items-center gap-2">
                          <Film className="w-3 h-3 tk-dim shrink-0" strokeWidth={1.5} />
                          {formData.clipFile.name}
                        </div>
                        <div className="sd-num text-[10px] tk-dim mt-0.5">
                          {formatBytes(formData.clipFile.size)} · {formData.clipFile.type || 'video'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={removeClipFile}
                        className="text-[9px] uppercase tk-dim h-acc transition px-2"
                        style={{ letterSpacing: '.14em' }}
                      >
                        Remove
                      </button>
                    </div>
                    {formData.clipFile.status === 'uploading' && (
                      <div className="px-3.5 pb-3.5 pt-3 border-t bd-line2">
                        <div className="flex items-center justify-between text-[9px] tk-dim mb-1.5 uppercase" style={{ letterSpacing: '.14em' }}>
                          <span>{t('Drive へアップロード中…')}</span>
                          <span className="sd-num">{formData.clipFile.progress || 0}%</span>
                        </div>
                        <div className="h-1 bg-line rounded-full overflow-hidden">
                          <div className="h-full bg-acc transition-all" style={{ width: `${formData.clipFile.progress || 0}%` }} />
                        </div>
                      </div>
                    )}
                    {formData.clipFile.status === 'error' && (
                      <div className="px-3.5 py-3 border-t bd-line2 flex items-center gap-2 flex-wrap">
                        <AlertCircle className="w-3.5 h-3.5 tk-acc" strokeWidth={1.5} />
                        <span className="text-[10px] tk-acc flex-1">{t('アップロードに失敗しました(このまま保存してもクリップは記録されません)')}</span>
                        <button type="button" onClick={retryUpload} className="sd-tbtn">{t('再試行')}</button>
                      </div>
                    )}
                    {formData.clipFile.status === 'done' && (
                      <div className="px-3.5 py-2.5 border-t bd-line2 flex items-center gap-1.5 text-[9px] tk-dim" style={{ letterSpacing: '.1em' }}>
                        <Check className="w-3 h-3 tk-acc" strokeWidth={1.5} /> {t('Drive にアップロード済み — 保存すると記録に紐付きます')}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>

            {/* Action bar */}
            <div
              className="sticky bottom-0 bg-modal border-t bd-line px-6 py-4 flex items-center justify-between gap-3"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              {deleteClipConfirm ? (
                <>
                  <div className="text-[11px] flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 tk-acc shrink-0" strokeWidth={1.5} />
                    <span>{t('Drive 上のメディア(動画・写真)も削除しますか?')}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setDeleteClipConfirm(false)} className="sd-tbtn">{t('キャンセル')}</button>
                    <button onClick={() => performDelete(false)} className="sd-tbtn">{t('記録のみ削除')}</button>
                    <button onClick={() => performDelete(true)} className="sd-tbtn on">{t('メディアも削除')}</button>
                  </div>
                </>
              ) : (
                <>
              {selectedEntryId && selectedDayList.some(e => e.id === selectedEntryId) ? (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2.5 text-[9px] uppercase border bd-line rounded-[2px] tk-dim h-acc hbd-acc transition flex items-center gap-2"
                  style={{ letterSpacing: '.16em' }}
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Delete
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShareOpen(!shareOpen)}
                    disabled={!(formData.game || formData.mouse || formData.mousepad || formData.keyboard || formData.dpi || formData.sens)}
                    className="px-4 py-2.5 text-[9px] uppercase border bd-line rounded-[2px] tk-dim h-acc hbd-acc transition flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ letterSpacing: '.16em' }}
                  >
                    <Share2 className="w-3.5 h-3.5" strokeWidth={1.5} /> Share
                  </button>
                  {shareOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setShareOpen(false)} />
                      <div className="absolute bottom-full right-0 mb-2 border bd-line rounded-[2px] bg-modal shadow-xl shadow-black/10 z-40 min-w-[190px]">
                        <div className="text-[8px] tk-dim uppercase px-3.5 py-2 border-b bd-line" style={{ letterSpacing: '.28em' }}>Share to</div>
                        <button
                          onClick={shareOnX}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[12px] hbg-perisoft transition text-left"
                        >
                          <span className="w-5 h-5 flex items-center justify-center border bd-ink rounded-[2px] text-[10px] font-bold">𝕏</span>
                          <span>Post on X</span>
                        </button>
                        <button
                          onClick={copyShareText}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[12px] hbg-perisoft transition text-left border-t bd-line2"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4" strokeWidth={1.5} />
                              <span className="font-medium">{t('コピーしました')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4 tk-dim" strokeWidth={1.5} />
                              <span>{t('テキストをコピー')}</span>
                            </>
                          )}
                        </button>
                        {mediaList(formData).length > 0 && (
                          <button
                            onClick={shareVideoToX}
                            disabled={videoShare.status === 'preparing'}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[12px] hbg-perisoft transition text-left border-t bd-line2 disabled:opacity-50 press"
                          >
                            <span className="w-5 h-5 flex items-center justify-center border bd-ink rounded-[2px] text-[10px] font-bold shrink-0">𝕏</span>
                            <span className="flex-1">
                              {videoShare.status === 'preparing' ? t('メディアを準備中…') : t('メディア付きでポスト')}
                            </span>
                            <Film className={`w-4 h-4 shrink-0 ${videoShare.status === 'ready' ? 'tk-acc' : 'tk-faint'}`} strokeWidth={1.5} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={handleSave}
                  disabled={formData.clipFile?.status === 'uploading'}
                  className="px-6 py-2.5 text-[9px] uppercase rounded-[2px] border bg-acc tk-onacc bd-acc hbg-none h-acc transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ letterSpacing: '.16em' }}
                >
                  <Save className="w-3.5 h-3.5" strokeWidth={1.5} /> {saved ? 'Saved ✓' : formData.clipFile?.status === 'uploading' ? 'Uploading…' : 'Save entry'}
                </button>
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 text-[9px] tk-faint uppercase" style={{ letterSpacing: '.2em' }}>
          Loading...
        </div>
      )}
    </div>
  );
}
