# Settings Diary — 本番化 実装指示書

この文書は、既存の React モック(`settings-diary.jsx`)を本番運用可能な Web アプリ(PWA)にするための実装指示書です。Cursor / Claude Code にこのファイルと `settings-diary.jsx` を渡し、フェーズ順に実装を依頼してください。

---

## 0. プロジェクト概要と絶対条件

- **アプリ名**: Settings Diary — 競技ゲーマー向けのデバイス設定・感度記録アプリ
- **絶対条件1**: 運営側のランニングコスト **ゼロ**(サーバー・DB・有料APIを使わない)
- **絶対条件2**: データはすべて**ユーザー自身の Google Drive** に保存(BYOC方式)
- **絶対条件3**: iOS / Android 対応は **PWA**(ネイティブアプリ化しない)
- UI は `settings-diary.jsx` を正として移植する(デザイン・機能を変更しない)

## 1. 技術スタック

| 領域 | 採用技術 | 理由 |
|---|---|---|
| ビルド | Vite + React 18 | 高速・情報量が多い |
| 認証 | Google Identity Services (GIS) のトークンクライアント | サーバー不要のクライアントサイド OAuth |
| クラウド | Google Drive API v3、スコープは **`https://www.googleapis.com/auth/drive.file` のみ** | 非機密スコープのため Google の重い審査が不要 |
| ローカル保存 | IndexedDB(idb ライブラリ) | オフライン時のキャッシュ兼一次保存 |
| PWA | vite-plugin-pwa | manifest + Service Worker を自動生成 |
| ホスティング | Vercel(無料枠) | 無料・自動デプロイ |
| スタイル | Tailwind CSS(本物のビルド版) | モックは CDN 前提なので正式導入する |

**重要**: スコープは `drive.file` 以外を絶対に追加しないこと。`drive`(フルアクセス)や `drive.appdata` を足すと Google の審査区分が変わり、個人開発では公開が困難になる。

## 2. 【手作業】Google Cloud Console の設定(開発者本人が行う)

AI には任せられない部分。以下を順に行う:

1. https://console.cloud.google.com で新規プロジェクト作成(名前: settings-diary)
2. 「APIとサービス → ライブラリ」で **Google Drive API** を有効化
3. 「OAuth 同意画面」を設定
   - User Type: **外部(External)**
   - アプリ名・サポートメール・デベロッパー連絡先を入力
   - スコープに `.../auth/drive.file` を追加
   - 公開ステータス: 最初は「テスト中」+ 自分のアカウントをテストユーザーに追加。動作確認後に「本番」へ移行(drive.file のみなら検証は軽微)
4. 「認証情報 → OAuth クライアント ID 作成」
   - 種類: **ウェブアプリケーション**
   - 承認済み JavaScript 生成元に以下を追加:
     - `http://localhost:5173`(開発用)
     - `https://<あなたのプロジェクト名>.vercel.app`(デプロイ後に追加)
5. 発行された**クライアント ID** を控え、`.env` の `VITE_GOOGLE_CLIENT_ID` に設定する

## 3. データ設計

### 3.1 Drive 上の構造(アプリが自動作成)

```
(ユーザーの Drive ルート)
└── SettingsDiary/
    ├── data.json          ← 全エントリー・カスタムゲーム・設定
    └── clips/
        ├── 2026-06-12_a1b2c3_clip.mp4
        └── ...
```

### 3.2 data.json スキーマ

```json
{
  "app": "settings-diary",
  "version": 2,
  "updatedAt": "2026-06-12T10:00:00.000Z",
  "entries": {
    "2026-06-12": [
      {
        "id": "lx3k9a8b2",
        "game": "VALORANT",
        "rating": 4.5,
        "mouse": "...", "mousepad": "...", "keyboard": "...",
        "dpi": "800", "sens": "0.40", "pollingRate": "1000", "lod": "1",
        "kbAp": "1.5", "kbRt": "0.1", "kbPollingRate": "1000",
        "memo": "...", "clipUrl": "",
        "clipFile": { "driveId": "<DriveのfileId>", "name": "clip.mp4", "size": 12345678, "type": "video/mp4" }
      }
    ]
  },
  "customGames": ["THE FINALS"]
}
```

モックとの差分: `clipFile` の `_mock`/`blobUrl` は廃止し、`driveId` を正とする。

### 3.3 ストレージアダプタ(最重要の移植ポイント)

**モックの `window.storage` は Claude アーティファクト専用 API のため、本番には存在しない。** 以下のインターフェースでアダプタを実装し、UI 側の呼び出しを全て置き換えること:

```ts
interface StorageAdapter {
  loadAll(): Promise<AppData>;        // 起動時: IndexedDB → あれば即返し、裏で Drive と同期
  saveAll(data: AppData): Promise<void>; // IndexedDB へ即保存 + デバウンス(3秒)で Drive へ
}
```

- 未ログイン時: IndexedDB のみで完結(モックと同じ使用感)
- ログイン時: IndexedDB を一次、Drive を真実のソースとして同期

### 3.4 同期ポリシー

- 起動時: Drive の `data.json` の `updatedAt` とローカルを比較し、**新しい方を採用**(last-write-wins)
- 保存時: ローカル即時 → 3秒デバウンスで Drive に upload(`files.update`)
- 競合の細かいマージは V1 ではやらない(個人利用前提のため LWW で十分)
- オフライン時: ローカルに書き、オンライン復帰時に Drive へ送る(`navigator.onLine` + 再試行)

## 4. 認証フロー(Google Identity Services)

1. `https://accounts.google.com/gsi/client` を読み込み
2. `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })` でトークンクライアント生成
3. ヘッダーに「Google でログイン」ボタンを設置(未ログインでもローカルモードで全機能使用可、と明記)
4. アクセストークンはメモリ保持のみ(localStorage に保存しない)。失効時(401)は `requestAccessToken({ prompt: '' })` でサイレント再取得、失敗時のみ再ログイン UI
5. ログアウト: `google.accounts.oauth2.revoke(token)` + ローカルキャッシュは保持(消すかはユーザーに確認)

## 5. クリップアップロード

- Drive の **resumable upload**(`uploadType=resumable`)を使用。大容量動画で必須
- 進捗バーをエントリーモーダル内に表示(XHR の `upload.onprogress`)
- 完了後 `clipFile.driveId` に fileId を保存
- 再生: `https://www.googleapis.com/drive/v3/files/{id}?alt=media` を fetch して Blob URL で `<video>` 再生(Authorization ヘッダーが必要なため `<video src>` 直指定は不可)
- サムネイル: `files.get` の `thumbnailLink` フィールドを利用
- 削除: エントリー削除時に Drive 上のファイルも削除するか確認ダイアログを出す

## 6. PWA 要件

- vite-plugin-pwa を導入し、以下を設定:
  - `name`: "Settings Diary" / `short_name`: "SetDiary"
  - `theme_color`: `#4F0C28` / `background_color`: `#f6f6f4`
  - アイコン: 192px / 512px / maskable(ブランドマーク: ペーパー地にプラムの正方形)
  - `display`: "standalone"
- iOS 用に `apple-touch-icon` と `apple-mobile-web-app-capable` メタタグを追加
- Service Worker: アプリシェルをプリキャッシュ(オフラインでも起動・閲覧・記録が可能なこと)
- 初回訪問時、iOS Safari では「共有 → ホーム画面に追加」の案内バナーを表示(一度閉じたら再表示しない)

## 7. 実装フェーズと完了条件

### Phase 1: プロジェクト化とデプロイ
- Vite + React + Tailwind プロジェクトを作成し、`settings-diary.jsx` を移植
- `window.storage` を IndexedDB アダプタに置換(この時点ではローカルのみ)
- Vercel にデプロイ
- **完了条件**: 公開 URL でモックと同じ全機能が動き、リロードしてもデータが残る

### Phase 2: Google ログイン + データ同期
- GIS 認証、`SettingsDiary/data.json` の作成・読み書き、同期ポリシー実装
- **完了条件**: PC で記録 → スマホのブラウザで同じ Google アカウントでログイン → 同じデータが見える

### Phase 3: クリップアップロード
- resumable upload + 進捗 UI + Drive からの再生
- **完了条件**: 100MB 級の動画をアップロードでき、別デバイスで再生できる

### Phase 4: PWA 化
- manifest / Service Worker / iOS 対応メタタグ / インストール案内
- **完了条件**: iPhone のホーム画面から起動でき、機内モードでも過去の記録が閲覧できる

## 8. セキュリティ・品質チェックリスト

- [ ] アクセストークンを localStorage / Cookie に保存していない
- [ ] スコープが `drive.file` のみである
- [ ] クライアント ID 以外の秘密情報がフロントに存在しない(クライアント ID は公開可で問題ない)
- [ ] 動画 Blob URL は不要になったら `URL.revokeObjectURL` している(モックの実装を踏襲)
- [ ] Drive API のエラー(401 / 403 / 429 / ネットワーク断)でデータが消えない(ローカルが常に保全される)
- [ ] エクスポート / インポート機能は本番でも残す(Drive 障害時の保険)

## 9. 既知の制約(ユーザー向け文言にも反映)

- iOS の PWA はブラウザデータが長期間未使用で消されることがある → 「Google ログインしておけばデータは Drive に保存されるため安全」と案内
- Drive 無料枠は 15GB(Gmail 等と共有)→ クリップの容量はユーザー管理
- 動画の変換・トリミングはアプリでは行わない(ユーザーが事前に行う)
