# Settings Diary

競技ゲーマー向けのデバイス設定・感度記録アプリ。Vite + React + Tailwind で構築した PWA(予定)。

このリポジトリは [`production-spec.md`](./production-spec.md) のフェーズ順に実装します。**現在は Phase 3(クリップアップロード)まで完了。**

## 技術スタック

| 領域 | 採用技術 |
|---|---|
| ビルド | Vite + React 18 |
| 認証 | Google Identity Services(トークンクライアント)|
| クラウド | Google Drive API v3(スコープは `drive.file` のみ)|
| ローカル保存 | IndexedDB(`idb`)|
| スタイル | Tailwind CSS(ビルド版)|
| ホスティング | Vercel(無料枠)|

PWA 化(Phase 4)は今後追加します。

## クリップ動画(Phase 3)

- エントリーモーダルで動画を選択すると、即座に Drive の `SettingsDiary/clips/` へ
  **resumable upload**(進捗バー付き、ネットワーク断は中断位置から再開、3回まで自動リトライ)
- 保存すると `clipFile.driveId` が記録に紐付く(アップロード未完了のまま保存はできない)
- 再生は「▶ 再生」ボタンで Drive から取得(`alt=media` + Blob URL。サムネイルは `thumbnailLink`)
- クリップ付き記録の削除時は「記録のみ削除 / クリップも削除」を確認
- クリップを差し替え・除去して保存した場合、古い Drive ファイルは自動削除(孤児ファイル防止)
- クリップ機能はログイン時のみ(未ログインでは URL 欄のみ利用可)

## Google ログインを有効にする(Phase 2)

仕様書 §2 の手作業(Google Cloud Console)を行ったうえで:

1. `.env` を作成し `VITE_GOOGLE_CLIENT_ID=<クライアントID>` を設定(`.env.example` 参照)
2. Cloud Console の「承認済み JavaScript 生成元」に `http://localhost:5173` と本番 URL を登録
3. アプリのヘッダー「Google でログイン」をクリック

未設定・未ログインでも**全機能がローカルモードで動作**します。ログインすると
`SettingsDiary/data.json` が Drive に作成され、起動時は `updatedAt` の新しい側を採用
(last-write-wins)、保存時はローカル即時 + 3 秒デバウンスで Drive へアップロードします。
アクセストークンはメモリのみ保持(リロード後は再ログインが必要)。

## ローカル開発

```bash
npm install
npm run dev      # http://localhost:5173
```

## ビルド / プレビュー

```bash
npm run build    # dist/ に出力
npm run preview  # 本番ビルドをローカル確認
```

## Vercel へのデプロイ

1. このリポジトリを GitHub に push
2. [Vercel](https://vercel.com) で New Project → リポジトリを import
3. Framework Preset は **Vite** が自動検出される(`vercel.json` でも指定済み)
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Deploy

> Phase 2 以降で Google ログインを実装する際は、Vercel の環境変数に
> `VITE_GOOGLE_CLIENT_ID` を設定し、Google Cloud Console の「承認済み JavaScript 生成元」に
> 本番 URL(`https://<project>.vercel.app`)を追加してください(`.env.example` 参照)。

## アーキテクチャ メモ

- **`src/SettingsDiary.jsx`** — UI 本体。モック(`settings-diary.jsx`)を正として移植。
- **`src/storage.js`** — IndexedDB の低レベル kv(`get / set / list / delete`)。テーマなど端末ローカル設定もここ。
- **`src/syncAdapter.js`** — 仕様書 §3.3 の StorageAdapter。アプリデータ全体を data.json
  スキーマの単一ドキュメントとして IndexedDB に保持し(`loadAll / saveAll`)、ログイン時は
  3 秒デバウンスで Drive へアップロード。オフライン時は `online` イベント + 30 秒間隔で再試行。
  Phase 1 の per-key データは初回起動時に自動マイグレーションされる。
- **`src/googleAuth.js`** — GIS トークンクライアント。トークンはメモリのみ、401 時はサイレント再取得。
- **`src/drive.js`** — Drive API v3(フォルダ/ファイル確保、ダウンロード、`files.update` アップロード)。

## データの保存先

常にブラウザの IndexedDB(DB 名 `settings-diary`)が一次保存先で、リロードしてもデータは残ります。
Google ログイン時は Drive の `SettingsDiary/data.json` が真実のソースとして同期されます。
Export / Import の JSON バックアップは Drive 障害時の保険として残しています。
