import { X, Music, Mic, Settings, Edit3, Trophy, Keyboard } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';

interface HelpModalProps {
    onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
    const [activeTab, setActiveTab] = useState<'basic' | 'tools' | 'score' | 'settings'>('basic');

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
                        { id: 'settings', label: '設定・トラブル' },
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
                                    <li><span className="text-pink-300 font-medium">練習曲</span> から、以前保存した曲を選んで素早く読み込めます。</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-red-400" />
                                    マイクと歌の録音
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>画面上部の <span className="inline-block px-2 py-0.5 bg-red-500/20 rounded border border-red-500/50 text-red-300 text-xs font-medium">MIC</span> ボタンでマイク入力をON/OFFします。初回はブラウザの許可が必要です。</p>
                                    <p>マイクをONにして再生ボタンを押すと、歌った音程が<span className="text-green-400 font-bold">緑色の線</span>でリアルタイムに描画されます。</p>
                                    <p>録音ボタン（赤丸）を押すと、歌声を録音してあとで聴き返せます。</p>
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
                                        <div className="text-xs text-white/60">ノートをクリックして選択したり、範囲選択したりできます。</div>
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
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3">再生コントロール</h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p><span className="text-orange-300 font-medium">ループ</span> — ループ範囲を設定して繰り返し練習できます。</p>
                                    <p><span className="text-indigo-300 font-medium">速度</span> — ±ボタンで再生速度を1%単位で調整できます。難しいフレーズはスローで練習しましょう。</p>
                                    <p><span className="text-purple-300 font-medium">ガイド音</span> — 練習中のガイドメロディーのON/OFFを切り替えます。</p>
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
                                        { label: '音程', color: 'text-blue-400', desc: 'ガイドの音程と自分の歌った音程がどれだけ一致しているかを表します。最も基本的な指標です。' },
                                        { label: '安定性', color: 'text-green-400', desc: '音程のブレや揺れが少なく、安定して発声できているかを評価します。' },
                                        { label: '表現力', color: 'text-pink-400', desc: 'ビブラートなど声の表情豊かさを評価します。単調すぎず、かつ揺れすぎないバランスが高得点のポイントです。' },
                                        { label: 'リズム', color: 'text-orange-400', desc: '音符の開始タイミングがガイドとどれだけ合っているかを評価します。' },
                                        { label: '技術', color: 'text-purple-400', desc: '音程変化の追従精度や音の切り替わりの鋭さなどを総合的に評価します。' },
                                    ].map(({ label, color, desc }) => (
                                        <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                                            <div className={cn("font-bold text-base mb-1", color)}>{label}</div>
                                            <div className="text-sm text-white/60">{desc}</div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-red-400" />
                                    マイク設定
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>マイクが認識されない場合、ブラウザのアドレスバー横の <span className="text-white font-medium">カメラ/マイクアイコン</span> をクリックして、このサイトへのマイク使用を「許可」に変更してください。</p>
                                    <p className="text-white/50">設定ページ（歯車アイコン）では、マイク感度・音量などの詳細設定が可能です。</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-gray-400" />
                                    設定の保存
                                </h3>
                                <p className="text-sm">
                                    マイク感度や音量、表示設定などは、お使いのブラウザに自動的に保存されます。
                                    次回アクセス時も同じ設定で練習を再開できます。
                                </p>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 text-red-400">
                                    トラブルシューティング
                                </h3>
                                <ul className="list-disc list-inside space-y-2 text-sm ml-2">
                                    <li><span className="font-bold text-white">音が聞こえない:</span> スマホのマナーモードを解除してください。また、音量がゼロになっていないか確認してください。</li>
                                    <li><span className="font-bold text-white">マイクが反応しない:</span> ブラウザのマイク権限が許可されているか確認してください。iOSの場合はSafariの設定からも許可が必要な場合があります。</li>
                                    <li><span className="font-bold text-white">練習曲が消えた:</span> 練習曲はブラウザのローカルストレージに保存されます。ブラウザのデータ削除を行うと消えることがあります。大切な曲は「保存」ボタンでJSONファイルとして書き出してください。</li>
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
