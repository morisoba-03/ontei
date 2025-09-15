# Web版 音程練習アプリ - README

## 起動方法

index.html を Webブラウザ（Chrome/Edge 等）で開いて使用します。  
**注意:** file:// (ローカルファイル) で開いた場合、ブラウザの仕様によりマイク入力がブロックされることがあります。その場合は、簡易なローカルHTTPサーバーを使用して `http://localhost` 経由で開いてください（例: VS CodeのLive Server拡張機能など）。

## 必要資材

本アプリはオフラインで動作します。音源として高音質ピアノSoundFontを使用できますが、同梱していないため、必要に応じて `assets/soundfont/` フォルダにSoundFontファイル（例: `piano.sf2`）を配置し、app.js内でその読み込み処理を追加してください。デフォルトではWebAudioのオシレータ音源で再生します。

### 高音質ピアノ (ZIP パック方式 β)

`piano_pack.zip` を読み込むことで多層サンプルピアノを段階的に利用できます。iOS Safari を含む file:// 環境でも `<input type=file>` により展開可能です。

#### ZIP 構造例
```
piano_pack.zip
 ├─ manifest.json
 ├─ samples/
 │   ├─ mf/m60.mp3
 │   ├─ mf/m61.mp3
 │   ├─ ff/m60.mp3
 │   └─ pp/m60.mp3
 ├─ release/
 │   └─ r60.mp3
 └─ ir/
		 └─ body_short.mp3
```

#### manifest.json フォーマット (v1)
```
{
	"version": 1,
	"sampleRate": 48000,          // (任意) 元サンプル収録レート
	"layers": ["pp","mf","ff"], // 使用するダイナミクス層 (任意)
	"center": 60,                 // 中心音 (優先ロード用)。省略時 60
	"files": [
		{ "m": 60, "layer": "mf", "file": "samples/mf/m60.mp3", "gain": -1.2, "loop": {"s":12345,"e":45678} },
		{ "m": 60, "layer": "ff", "file": "samples/ff/m60.mp3" },
		{ "m": 59, "layer": "mf", "file": "samples/mf/m59.mp3" },
		{ "m": 60, "release": true, "file": "release/r60.mp3" }
	],
	"impulse": "ir/body_short.mp3"  // (任意) 共鳴 IR
}
```
フィールド説明:
- `m` / `midi`: MIDI ノート番号
- `layer`: ダイナミクス層名 (省略可)
- `gain`: そのサンプルの基準正規化 (dB)。省略時 0
- `loop.s`, `loop.e`: ループ開始/終了サンプルインデックス (未対応: まだ UI から有効化していません)
- `release: true`: リリースサンプル (ノートオフ/減衰時に再生予定)
- `impulse`: 簡易共鳴用 IR ファイルパス

#### 使い方
1. ZIP を作成し `manifest.json` を含める
2. 画面右側コントロール「高音質ピアノ (ZIP)」の `ZIP読込` ボタンで選択
3. ステータスが「デコード n / 総数」→「サンプル準備完了」に変われば利用可能
4. 中心域 mf 層を優先的にデコード、残りはバックグラウンドで順次処理
5. ペダル (Sustain) チェックでループ長延長・リリースサンプル抑制

#### 推奨音名→ファイル命名規則
`samples/<layer>/m<NUMBER>.mp3` 例: `samples/mf/m60.mp3`
リリース: `release/r<NUMBER>.mp3`

#### 注意
- ループ/リリース/IR の基本再生は実装済（loop.s/e による簡易ループ、ペダルOFF時のみ release）
- OGG/Opus は iOS Safari の互換に揺れがあるため MP3 推奨
- ファイルサイズは初期ロードを軽くするため中心域(±6半音) だけでも動作します
- デコード済サンプルが多くなると古い遠音域を自動的に LRU 解放（メモリ節約）


## 既知の制約・注意事項

- MusicXMLファイルの読み込みは基本的な音符情報のみ対応しています。リピート記号や跳躍（D.S.やCodaなど）は展開処理されません。
- 再生中にテンポ倍率を変更しても即時反映されません（再度再生し直してください）。
- マイク入力の音程解析は簡易アルゴリズムのため、ビブラートが強い場合などに揺れやオクターブ誤認が発生する場合があります。
- ブラウザでマイク利用の許可が求められます。ページを開いて初めて「再生」を押す際に許可ダイアログが表示されます。
- file://経由でマイクが動作しない場合は上記のようにローカルサーバー経由でアクセスしてください。

## ファイル一覧

- **index.html**: メインのHTMLファイル。UIとCanvas描画領域を含みます。
- **app.js**: アプリの主要ロジック（JavaScript）。
- **styles.css**: スタイルシート。
- **assets/libs/fflate.min.js**: MXL圧縮ファイル解凍ライブラリ (fflate)。
- **assets/libs/tonejs-midi.min.js**: MIDIファイル解析ライブラリ。
- **README.md**: このファイル。起動方法や注意事項を記載。
- **help.html**: ヘルプページ（各設定項目の説明や採点仕様の解説）。

