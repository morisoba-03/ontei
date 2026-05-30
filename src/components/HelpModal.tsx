import { X, Music, Mic, Settings, Edit3, Trophy, Keyboard, Repeat, Gauge, Waves, Wrench, Target, FileAudio } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';

interface HelpModalProps {
    onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
    const [activeTab, setActiveTab] = useState<'basic' | 'tools' | 'score' | 'settings' | 'trouble'>('basic');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                    <h2 className="text-lg font-bold flex items-center gap-2 text-white">
                        <span className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">?</span>
                        使い方ガイド
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/70 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10 bg-black/20 overflow-x-auto">
                    {([
                        { id: 'basic', label: '基本操作' },
                        { id: 'tools', label: 'ツール・練習' },
                        { id: 'score', label: '採点' },
                        { id: 'settings', label: '設定' },
                        { id: 'trouble', label: 'トラブル' },
                    ] as const).map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn("px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap", activeTab === tab.id ? "text-blue-400 border-b-2 border-blue-400 bg-blue-500/5" : "text-white/50 hover:text-white hover:bg-white/5")}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 text-white/80 space-y-8">

                    {activeTab === 'basic' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Music className="w-5 h-5 text-blue-400" />
                                    ファイル読み込み
                                </h3>
                                <ul className="list-disc list-inside space-y-2 text-sm ml-2">
                                    <li>画面上部の <span className="text-blue-300 font-medium">ガイド</span> から、練習したい曲のMIDIファイルまたは音声ファイルを読み込みます。</li>
                                    <li><span className="text-purple-300 font-medium">伴奏</span> から、カラオケ音源などを読み込むと、ガイドと一緒に再生されます。</li>
                                    <li><span className="text-pink-300 font-medium">練習曲</span> から、以前保存した曲やプリセット曲を選んで素早く読み込めます。</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <FileAudio className="w-5 h-5 text-orange-400" />
                                    MIDI と MP3、2つのガイド
                                </h3>
                                <div className="space-y-3 text-sm ml-2">
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-blue-300 mb-1">MIDI ファイル → バー型ノート</div>
                                        <div className="text-xs text-white/60">音符が横長のバーで表示されます。1音ずつの音程・長さが明確で、譜面の編集にも向いています。</div>
                                    </div>
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-orange-300 mb-1">ボーカルのみの MP3 → 折れ線ガイド</div>
                                        <div className="text-xs text-white/60">音源を自動解析し、歌の音程の動きを <span className="text-orange-400 font-medium">オレンジの折れ線</span> として配置します。しゃくり・ビブラートなどの自然な動きをそのまま目標にでき、採点も折れ線に追従します。読み込んだ MP3 の原音が「お手本」として再生されます。</div>
                                    </div>
                                    <p className="text-white/50 text-xs">※ MP3 読み込み時は、口笛で吹きやすい音域へガイドのオクターブを自動調整します（キーは変わりません）。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-red-400" />
                                    マイクと録音
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>画面上部の <span className="inline-block px-2 py-0.5 bg-red-500/20 rounded border border-red-500/50 text-red-300 text-xs font-medium">MIC</span> ボタンでマイク入力をON/OFFします。初回はブラウザの許可が必要です。</p>
                                    <p>マイクをONにして再生ボタンを押すと、吹いた音程が<span className="text-green-400 font-bold">緑色の線</span>でリアルタイムに描画されます。</p>
                                    <p>録音ボタン（赤丸）を押すと、演奏を録音してあとで聴き返せます。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Keyboard className="w-5 h-5 text-cyan-400" />
                                    キーボードショートカット
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {[
                                        { key: 'Space', desc: '再生 / 停止' },
                                        { key: 'R', desc: '録音 開始 / 停止' },
                                        { key: 'M', desc: 'マイク ON / OFF' },
                                    ].map(({ key, desc }) => (
                                        <div key={key} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                            <kbd className="px-2 py-1 bg-zinc-700 border border-white/20 rounded text-xs font-mono text-white font-bold shrink-0">{key}</kbd>
                                            <span className="text-sm text-white/70">{desc}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'tools' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Edit3 className="w-5 h-5 text-yellow-400" />
                                    編集ツール
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-white mb-1">✋ 移動 (Pan)</div>
                                        <div className="text-xs text-white/60">画面をドラッグして、譜面を自由に移動できます。</div>
                                    </div>
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-white mb-1">👆 選択 (Select)</div>
                                        <div className="text-xs text-white/60">ノートをクリックして選択したり、ドラッグで移動・長さ変更ができます。</div>
                                    </div>
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-white mb-1">✏️ 鉛筆 (Pencil)</div>
                                        <div className="text-xs text-white/60">クリック＆ドラッグで、新しいノートを書き込めます。クリックした位置で高さが決まり、ドラッグで長さを調整できます。</div>
                                    </div>
                                    <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                                        <div className="font-bold text-white mb-1">🧹 消しゴム (Eraser)</div>
                                        <div className="text-xs text-white/60">クリックまたはドラッグして、不要なノートを削除します。</div>
                                    </div>
                                </div>
                                <p className="text-[11px] text-white/40 mt-2 ml-1">※ 編集はバー型ノート（MIDI）が対象です。MP3 の折れ線ガイドは編集できません。</p>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Repeat className="w-5 h-5 text-orange-400" />
                                    再生コントロール
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-orange-300 font-medium">ループ</span> — ループ範囲を設定して、難しいフレーズを繰り返し練習できます。譜面上のループ端をドラッグして範囲を調整できます。</p>
                                    <p><span className="text-indigo-300 font-medium">速度</span> — 再生速度を1%単位で調整できます。難しいフレーズはスローで練習しましょう（音程・キーは変わりません）。</p>
                                    <p><span className="text-purple-300 font-medium">ガイド音 / 伴奏音</span> — お手本のガイドメロディーと伴奏それぞれのON/OFF・音量を切り替えます。MP3 ガイドの場合は原音そのものがお手本になります。</p>
                                    <p><span className="text-cyan-300 font-medium">カウントイン</span> — 再生前に1小節分のカウントを入れて、入りを合わせやすくします（設定でON/OFF）。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Target className="w-5 h-5 text-pink-400" />
                                    マーカー・移調・オクターブ
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-pink-300 font-medium">マーカー（A〜Z）</span> — 譜面上の任意の位置に印を付けて、頭出し・ループ範囲の指定に使えます。</p>
                                    <p><span className="text-emerald-300 font-medium">キー変更（移調）</span> — 曲全体を半音単位で上げ下げできます（±12半音）。自分の出しやすいキーに合わせましょう。</p>
                                    <p><span className="text-blue-300 font-medium">オクターブ調整</span> — ガイドを丸ごとオクターブ単位で移動します。口笛など高音域で吹くときに便利です。移調と組み合わせると±6オクターブ以上の調整も可能です。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Music className="w-5 h-5 text-violet-400" />
                                    練習モード
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>曲の読み込みとは別に、<span className="text-violet-300 font-medium">スケール・アルペジオ・エクササイズ</span> などの基礎練習パターンを自動生成して練習できます。</p>
                                    <p>ルート音・音域・テンポを指定でき、テンポを段階的に上げていく <span className="text-white font-medium">テンポ・プログレッション</span> にも対応しています。</p>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'score' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Trophy className="w-5 h-5 text-yellow-400" />
                                    採点の見方
                                </h3>
                                <p className="text-sm text-white/60 mb-4">練習後に「結果」ボタンを押すと、5つの指標でレーダーチャート採点が表示されます。</p>
                                <div className="space-y-3">
                                    {[
                                        { label: '音程', color: 'text-blue-400', desc: 'ガイドの音程と自分の吹いた音程がどれだけ一致しているかを表します。最も基本的な指標です。' },
                                        { label: '安定性', color: 'text-green-400', desc: '音程のブレや揺れが少なく、安定して発音できているかを評価します。' },
                                        { label: '表現力', color: 'text-pink-400', desc: 'ビブラートなど音の表情豊かさを評価します。単調すぎず、かつ揺れすぎないバランスが高得点のポイントです。' },
                                        { label: 'リズム', color: 'text-orange-400', desc: '音の開始タイミングがガイドとどれだけ合っているかを評価します。' },
                                        { label: '技術', color: 'text-purple-400', desc: '音程変化の追従精度や音の切り替わりの鋭さなどを総合的に評価します。' },
                                    ].map(({ label, color, desc }) => (
                                        <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                                            <div className={cn("font-bold text-base mb-1", color)}>{label}</div>
                                            <div className="text-sm text-white/60">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Waves className="w-5 h-5 text-emerald-400" />
                                    ヒートマップ（ノート色分け）
                                </h3>
                                <p className="text-sm text-white/70 ml-2">
                                    演奏を止めると、各ノートが安定度に応じて色分けされます。
                                    <span className="text-green-400 font-medium"> 緑＝よく合っている</span>、
                                    <span className="text-red-400 font-medium"> 赤＝要練習</span> です。
                                    どのフレーズが苦手かが一目で分かります（設定でON/OFF）。
                                </p>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Trophy className="w-5 h-5 text-fuchsia-400" />
                                    自己ベストのゴースト
                                </h3>
                                <p className="text-sm text-white/70 ml-2">
                                    同じ曲での自己ベスト演奏のピッチ軌跡を、薄い紫の線で重ねて表示できます。
                                    過去の自分と比べながら練習でき、ベストを更新すると自動で記録が保存されます（設定でON/OFF）。
                                </p>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Repeat className="w-5 h-5 text-orange-400" />
                                    苦手区間の集中練習
                                </h3>
                                <div className="space-y-2 text-sm text-white/70 ml-2">
                                    <p>採点結果には、音程が外れやすかった <span className="text-white font-medium">苦手区間</span> が自動で検出されて並びます。</p>
                                    <p>各区間の「ループ練習」で1か所を繰り返したり、<span className="text-orange-300 font-medium">「全区間を連続練習（各2回）」</span> ボタンで、すべての苦手区間を順番に集中練習できます。</p>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <p className="text-sm text-white/50">設定は画面の歯車アイコンから開けます。主な項目は次の通りです。</p>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Gauge className="w-5 h-5 text-amber-400" />
                                    判定の厳しさ
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-white font-medium">厳しさプリセット</span> — <span className="text-green-300">緩い</span> / <span className="text-blue-300">標準</span> / <span className="text-orange-300">厳しい</span> / <span className="text-red-300">ストイック</span> から選べます。許容誤差（セント）が一括で切り替わります。</p>
                                    <p><span className="text-white font-medium">許容誤差</span> — どこまでのズレをOKとするかを細かく調整できます。数値が小さいほど厳密になります。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Waves className="w-5 h-5 text-violet-400" />
                                    判定エンジン
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-violet-300 font-medium">従来 (v1)</span> — ガイド音を基準にオクターブ補正・平滑化を行う、安定重視の方式です。普段はこちらが扱いやすいです。</p>
                                    <p><span className="text-violet-300 font-medium">厳密 (v2)</span> — ガイドに依存せず、検出した音程をそのまま判定する厳密な方式です。よりシビアに自分の実力を測りたいときに。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Target className="w-5 h-5 text-cyan-400" />
                                    チューナー・表示
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-cyan-300 font-medium">チューナー表示</span> — 再生中、現在の音程のズレをチューナーで確認できます。<span className="text-white font-medium">音名表示</span> をONにすると「A5」のような音名も出ます。</p>
                                    <p><span className="text-white font-medium">音名表記</span> — アルファベット（C, D, E…）／カタカナ（ド, レ, ミ…）を切り替えられます。</p>
                                    <p><span className="text-white font-medium">表示の平滑化</span> — カーソルやチューナーの揺れを滑らかにします（採点や履歴には影響しません）。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-gray-300" />
                                    音・基準ピッチ・自動調整
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-white font-medium">基準ピッチ (A4)</span> — 430〜446Hz の範囲で基準を調整できます。原曲のチューニングに合わせたいときに。</p>
                                    <p><span className="text-white font-medium">メトロノーム</span> — 音量と音色（<span className="text-white">ビープ / クリック / ウッド</span>）を選べます。鳴らすタイミング（常時・録音時のみ等）も切り替えられます。</p>
                                    <p><span className="text-white font-medium">オクターブ自動調整</span> — ファイル読み込み時に、口笛で吹きやすい音域へガイドのオクターブを自動で合わせます（キーは変わりません）。</p>
                                    <p><span className="text-white font-medium">マイク感度 (Gate)</span> — 小さな音を拾う／雑音を抑えるしきい値を調整します。</p>
                                    <p><span className="text-white font-medium">入力遅延の補正</span> — マイクや環境による遅れを補正し、判定タイミングを合わせます。</p>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'trouble' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-red-400" />
                                    マイクが反応しない
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>ブラウザのアドレスバー横の <span className="text-white font-medium">カメラ/マイクアイコン</span> をクリックし、このサイトへのマイク使用を「許可」に変更してください。</p>
                                    <p className="text-white/50">iOS の場合は Safari の設定からも許可が必要なことがあります。それでも反応が弱い場合は、設定でマイク感度 (Gate) を上げてみてください。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-gray-400" />
                                    設定とデータの保存
                                </h3>
                                <p className="text-sm ml-2">
                                    感度・音量・表示などの設定や、練習曲・自己ベスト記録は、お使いのブラウザに自動的に保存されます。次回も同じ環境で練習を再開できます。
                                </p>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Wrench className="w-5 h-5 text-red-400" />
                                    その他のトラブル
                                </h3>
                                <ul className="list-disc list-inside space-y-2 text-sm ml-2">
                                    <li><span className="font-bold text-white">音が聞こえない:</span> スマホのマナーモードを解除し、音量がゼロになっていないか確認してください。ガイド音／伴奏音がOFFになっていないかも確認しましょう。</li>
                                    <li><span className="font-bold text-white">音程が1オクターブずれて判定される:</span> 「オクターブ調整」または「オクターブ自動調整」で、ガイドを自分の音域に合わせてください。</li>
                                    <li><span className="font-bold text-white">判定が厳しすぎる／甘すぎる:</span> 設定の「厳しさプリセット」や「許容誤差」で調整できます。</li>
                                    <li><span className="font-bold text-white">タイミングがズレる:</span> 設定の「入力遅延の補正」を調整すると改善することがあります。</li>
                                    <li><span className="font-bold text-white">練習曲が消えた:</span> 練習曲はブラウザのローカルストレージに保存されます。ブラウザのデータ削除で消えることがあるため、大切な曲は「保存」でファイルとして書き出してください。</li>
                                    <li><span className="font-bold text-white">表示がおかしい:</span> ページを再読み込み（リロード）してみてください。</li>
                                </ul>
                            </section>
                        </div>
                    )}

                </div>

                <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors">
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}
