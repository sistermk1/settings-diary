// ── i18n: 日本語をソース(キー)に英語へ変換 ───────────────────────────────────
//
// t('日本語') は、lang==='en' かつ辞書に対応があれば英語を、無ければ日本語を返す。
// → 日本語モードは常に完全。英語モードで訳が抜けても日本語のままで壊れない。
// 補間が要る文言は {n} 等のプレースホルダを含むキーにし、呼び出し側で .replace する。

export const LANGS = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
];

export function detectLang(saved) {
  if (saved === 'ja' || saved === 'en') return saved;
  const n = (typeof navigator !== 'undefined' && navigator.language || 'ja').toLowerCase();
  return n.startsWith('ja') ? 'ja' : 'en';
}

const EN = {
  // ── Welcome guide ──
  'VILDUP へようこそ': 'Welcome to VILDUP',
  '日々のセットアップを記録して、自分だけの最適解を積み上げていく「セットアップ日記」です。':
    'A setup diary to log your gear day by day and build up your own perfect configuration.',
  '記録する': 'Log it',
  '日付をタップして、マウス・感度・キーボード設定と、その日の手応えを評価(★)で記録しましょう。':
    'Tap a date to record your mouse, sensitivity and keyboard settings — and rate how the day felt (★).',
  '同期 & クリップ': 'Sync & clips',
  'Google ログインで PC とスマホの記録を同期。プレイ動画も添付できます(動画はあなた自身の Google Drive に保存されます)。':
    'Sign in with Google to sync across PC and phone. Attach gameplay clips too — they’re stored in your own Google Drive.',
  '続けるほど見えてくる': 'The more you log, the more you see',
  'Record で記録した日数に応じて称号を集め、Analysis で「勝てた日の構成」を分析。ホーム画面に追加すればアプリとして使えます。':
    'Earn ranks by total days logged in Record, and analyze your best-rated setups in Analysis. Add to your home screen to use it like an app.',
  'スキップ': 'Skip',
  'はじめる': 'Get started',
  '次へ': 'Next',

  // ── Sync status ──
  '接続中…': 'Connecting…',
  '同期中…': 'Syncing…',
  'Drive 同期済み': 'Synced with Drive',
  'オフライン(未同期)': 'Offline (not synced)',
  '再ログインが必要': 'Sign-in required',
  '同期エラー(自動再試行)': 'Sync error (auto-retry)',
  'ローカル保存': 'Saved locally',
  'ローカルモード': 'Local mode',

  // ── Menu ──
  'Google でログイン': 'Sign in with Google',
  'Google からログアウト': 'Sign out of Google',
  'ダークモード': 'Dark mode',
  'ライトモード': 'Light mode',
  '使い方': 'How to use',
  'このアプリについて': 'About',
  'プライバシーポリシー': 'Privacy policy',
  '広告ポリシー': 'Ad policy',

  // ── Notices / messages ──
  'Google クライアント ID が未設定です(.env の VITE_GOOGLE_CLIENT_ID を設定してください)':
    'Google client ID is not set (configure VITE_GOOGLE_CLIENT_ID in .env)',
  'Google Drive と接続しました。データを同期します。': 'Connected to Google Drive. Syncing your data.',
  '写真の保存には Google ログインが必要です': 'Sign in with Google to save photos',
  '写真の読み込みに失敗しました': 'Failed to load the photo',
  'クリップ動画の保存には Google ログインが必要です(URL 欄はログインなしで使えます)':
    'Sign in with Google to save clip videos (the URL field works without signing in)',
  'クリップの読み込みに失敗しました': 'Failed to load the clip',
  'クリップの再生には Google ログインが必要です': 'Sign in with Google to play clips',
  'メディア付きポストには Google ログインが必要です': 'Sign in with Google to post with media',
  'メディアの準備に失敗しました': 'Failed to prepare media',
  '準備ができました。もう一度タップすると共有シートが開きます(共有先で X を選択)':
    'Ready. Tap again to open the share sheet (choose X).',
  '形式が正しくありません(entries が見つかりません)': 'Invalid format (no entries found)',
  'インポートできるエントリーがありませんでした': 'No importable entries found',
  'JSON の読み込みに失敗しました': 'Failed to read the JSON',
  '自分に合うセットアップを分析しました #VILDUP': 'Analyzed the setup that works best for me #VILDUP',
  'シェア画像を保存しました。X の投稿画面で画像を添付してください。':
    'Saved the share image. Attach it in the X composer.',
  'シェア画像の作成に失敗しました': 'Failed to create the share image',

  // ── Logout / import confirm ──
  'Google からログアウトします。このブラウザのデータはどうしますか?':
    'Signing out of Google. What should happen to this browser’s data?',
  '(Drive 上の data.json はどちらの場合も残ります)': '(data.json on Drive is kept either way)',
  'キャンセル': 'Cancel',
  '残してログアウト': 'Keep & sign out',
  '削除してログアウト': 'Delete & sign out',
  '現在のデータはすべて置き換えられます。': 'All current data will be replaced.',
  'のエントリーをインポートします。': ' entries will be imported.',
  '置き換えて続行': 'Replace & continue',

  // ── Drive re-login hint ──
  '前回 Google Drive 同期を使用していました。ログインすると同期を再開します。':
    'You used Google Drive sync before. Sign in to resume syncing.',
  'あとで': 'Later',
  'ログイン': 'Sign in',

  // ── iOS install hint ──
  'ホーム画面に追加するとアプリとして使えます:Safari の': 'Add to your home screen to use it like an app: in Safari, tap the',
  '共有ボタン': 'Share button',
  '「ホーム画面に追加」': '“Add to Home Screen”',
  '閉じる': 'Close',

  // ── Tabs / views ──
  'すべて': 'All',
  'まだ記録がありません': 'No records yet',
  '条件に一致する記録がありません': 'No records match your filter',
  'フィルタをクリア': 'Clear filter',
  '読み込み中…': 'Loading…',
  '▶ 再生': '▶ Play',
  'Google ログインすると Drive から再生できます': 'Sign in with Google to play from Drive',
  '動画本体は保存されていません': 'No video file is stored',
  '(ファイル情報のみの記録)': '(file info only)',
  'クリップを開く ↗': 'Open clip ↗',

  // ── Record ──
  '現在の称号': 'Current rank',
  '次の称号': 'Next rank',
  '累計記録日数': 'Total days logged',
  '日': ' d',
  '直近 12 週間': 'Last 12 weeks',
  '今日はまだ記録していません。1件記録して累計を伸ばしましょう。':
    'You haven’t logged today. Add an entry to grow your total.',
  '今日を記録': 'Log today',
  '称号ロードマップ': 'Rank roadmap',

  // ── Analysis ──
  'ベストギア': 'Best gear',
  '(平均評価順)': '(by average rating)',
  '記録なし': 'No data',
  'あなたのベスト構成': 'Your best configuration',
  'まだ集計に十分な記録がありません(評価付きの記録が 5 件以上必要です)':
    'Not enough data yet (at least 5 rated entries are needed)',
  '評価付きで記録する': 'Add a rated entry',

  // ── Entry modal ──
  '前回から引き継ぎ': 'Carried over',
  '色付きの値 = 前回(同ゲーム)から変更': 'Colored values = changed since last entry (same game)',
  'ゲームを選択...': 'Select a game...',
  '星の左右で 0.5 刻み': 'Tap left/right of a star for 0.5 steps',
  '写真': 'Photo',
  'ここにドロップ': 'Drop here',
  '動画をドラッグ': 'Drag a video',
  'またはタップして選択': 'or tap to choose',
  'クリップの保存には Google ログインが必要です': 'Sign in with Google to save clips',
  'Drive へアップロード中…': 'Uploading to Drive…',
  'アップロードに失敗しました(このまま保存してもクリップは記録されません)':
    'Upload failed (saving now won’t attach the clip)',
  '再試行': 'Retry',
  'Drive にアップロード済み — 保存すると記録に紐付きます': 'Uploaded to Drive — save to attach it to this entry',
  'Drive 上のメディア(動画・写真)も削除しますか?': 'Also delete the media (video & photos) on Drive?',
  '記録のみ削除': 'Delete entry only',
  'メディアも削除': 'Delete media too',
  'コピーしました': 'Copied',
  'テキストをコピー': 'Copy text',
  'メディアを準備中…': 'Preparing media…',
  'メディア付きでポスト': 'Post with media',

  // ── Footer / WP ──
  '日付を選択して記録 — Google Drive と同期': 'Pick a date to log — synced with Google Drive',
  '日付を選択して記録 — ローカル保存(ログインなしで全機能利用可)':
    'Pick a date to log — saved locally (all features work without signing in)',
  '本サイトには PR・アフィリエイトリンクを含みます。詳しくは': 'This site contains PR / affiliate links. See the',
  'をご覧ください。': ' for details.',
  'このページは準備中です。': 'This page is coming soon.',
  '<p>このページは準備中です。</p>': '<p>This page is coming soon.</p>',

  // ── Interpolated (use .replace at call site) ──
  'メディアは1記録あたり合計{n}つまでです': 'Up to {n} media items per entry',
  'メディアは1記録あたり合計{n}つまでです(写真を減らしてください)': 'Up to {n} media items per entry (remove a photo first)',
  '合計{n}つまでのため {m} 枚だけ追加しました': 'Only {m} added (max {n} total)',
  'メディアを保存しました({n}件)。開いた X の投稿画面にドラッグ&ドロップしてください。':
    'Saved {n} media file(s). Drag & drop them into the X composer that opened.',
  '{n} 件のエントリーをインポートしました': 'Imported {n} entries',
  'ログインできませんでした: {e}': 'Couldn’t sign in: {e}',
  '同期状態: {s}': 'Sync status: {s}',
  '{n}日分のセットアップを記録 — 称号「{tier}」 #VILDUP':
    'Logged {n} days of my setup — rank “{tier}” #VILDUP',
  '{n}日': '{n} d',
  'スライド {n}': 'Slide {n}',
  '残り {n}': '{n} left',
  '写真・動画は合計 {n} つまで': 'Up to {n} photos/videos total',

  // ── attribute strings (title / placeholder) ──
  'メニュー': 'Menu',
  'メモ・デバイス名で検索': 'Search memo or device name',
  'タップで再生': 'Tap to play',
  'シェア画像を作成して X へ': 'Create a share image for X',
  '新しいゲームを追加...': 'Add a new game...',
  'マウス名(例: Logitech G PRO X SUPERLIGHT 2)': 'Mouse name (e.g. Logitech G PRO X SUPERLIGHT 2)',
  'マウスパッド名(例: Artisan Zero XSOFT)': 'Mousepad name (e.g. Artisan Zero XSOFT)',
  'キーボード名(例: Wooting 60HE)': 'Keyboard name (e.g. Wooting 60HE)',
  '今日の調子、感じたこと、調整した設定など...': 'Today’s form, how it felt, settings you tweaked...',
  '削除': 'Delete',
  '写真を追加': 'Add photo',

  // ── Gem-tier praise (Record) ──
  '最初の一歩があなたの原石になります。今日の記録から始めましょう。':
    'Your first step becomes your raw gem. Start with today’s entry.',
  '原石を手にしました。磨くほどに輝くのは、あなたも同じです。':
    'You’ve got the raw stone. Like it, you shine the more you polish.',
  '3日継続。地道な努力が琥珀のように結晶化し始めています。':
    '3 days in. Steady effort is crystallizing, like amber.',
  '1週間継続。深い青は静かな集中の色。習慣付いてきましたね。':
    'One week in. Deep blue is the color of quiet focus — it’s becoming a habit.',
  '2週間継続。努力が形になってきました。時にはアナリティクスを確認してみましょう。':
    'Two weeks in. Your effort is taking shape — check Analysis now and then.',
  '30日到達。あなたには努力の才能があります。このデータにはサファイアよりも価値があります。':
    '30 days. You have a talent for consistency — this data is worth more than sapphire.',
  '60日。成長の緑。時に振り返れば、最適解への道筋が見えてくるはずです。':
    '60 days. The green of growth — look back now and then, and the path to your best setup appears.',
  '100日。気品の紫。ここまで続けられる人は本当にごくわずかです。自己分析を継続しましょう。':
    '100 days. The purple of refinement — very few make it this far. Keep analyzing yourself.',
  '180日。半年分の記録は、ダイヤモンドよりも硬い自信になるはずです。':
    '180 days. Half a year of records — confidence harder than diamond.',
  '365日。光で色を変える奇跡の石。あなたの探求はもはや伝説です。様々な色からあなたは何を見つけましたか？':
    '365 days. The miracle stone that changes color in light. Your quest is now legend — what did you find across all those colors?',
};

const TABLES = { ja: {}, en: EN };

export function makeT(lang) {
  const table = TABLES[lang] || {};
  return (s) => (table[s] != null ? table[s] : s);
}
