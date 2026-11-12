# Ontei — 口笛・歌の音程練習アプリ

吹いた（歌った）音の高さをリアルタイムに線で表示し、お手本と比べながら練習できるブラウザアプリです。スマホで開くだけで使えます（登録不要）。

**アプリ:** https://morisoba-03.github.io/ontei/

---

## 主な機能

- **音程の可視化** — マイクで拾った口笛・歌声の音程をリアルタイムに描画。お手本に合うと緑色
- **高精度の音程判定** — 波形の周期と倍音の並びの両方から判定し、時間方向にも追跡。雑音に強く、1オクターブ上下の誤判定がほとんどない
- **オクターブ違いも正解に** — お手本と違うオクターブで吹いても、音名が合っていれば正解（設定で切替）
- **口笛の音域に自動調整** — 曲を読み込むと、お手本が口笛の音域（初期設定 C5〜G7、中心 C6）に収まるようオクターブを自動で調整
- **サークル課題曲** — 曲リストに、全員共通の課題曲を表示（`public/circle/pack.json`）
- **マイリスト** — 自分で読み込んだ曲を端末に保存。作者の端末どうしは Google ドライブで同期
- **採点** — 音程・安定性・表現力・リズム・技術の 5 軸で評価
- **かんたん表示** — 初期状態は練習に使うボタンだけ。「くわしく」で録音・ループ・マーカー・保存などを表示

## 使い方（メンバー向け）

1. アプリのアドレスをスマホで開く（LINE から開いたときは「ブラウザで開く」）
2. 左上の「曲リスト」から課題曲を選ぶ
3. 右上の「MIC」を押し、「許可」を押す
4. 下の ▶ を押して、お手本に合わせて吹く

## 課題曲の入れ替え（管理者向け）

```bash
# 合言葉なし（誰でも表示）
node scripts/circle-pack.mjs --no-pass --manifest songs.json
# 合言葉あり（入力した人だけ表示）
node scripts/circle-pack.mjs --pass "合言葉" --manifest songs.json
```

`songs.json` の例:

```json
{ "title": "サークル課題曲", "songs": [
  { "file": "song.mid", "name": "曲名（第1パート）", "description": "フルート1st", "track": 0 }
] }
```

出力された `public/circle/pack.json` を main に push すると反映されます。

## PC とスマホの同期（作者専用）

設定画面のバージョン表示を 5 回タップすると「PCとスマホの同期（Googleドライブ）」が表示されます。Google ドライブのアプリ専用フォルダ（`drive.appdata`）だけを使います。OAuth 同意画面は「テスト中」で、テストユーザーに登録したアカウントだけがログインできます。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # 自動テスト（音程エンジン・同期の合併・音域調整）
npm run lint       # 静的解析
npm run build      # ビルド
```

main に push すると GitHub Actions がテスト → ビルド → GitHub Pages へ公開します。

## 技術スタック

React 19 + TypeScript / Vite / Tailwind CSS v4 / @tonejs/midi / Web Audio API / Vitest

## クレジット

- ピアノ音源: Salamander Grand Piano（Alexander Holm, CC BY 3.0）
