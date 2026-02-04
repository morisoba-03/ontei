import { X, Music, Mic, Settings, Edit3 } from 'lucide-react';
// let X: any = () => null; let Music: any = () => null; let Mic: any = () => null; let Settings: any = () => null; let Edit3: any = () => null;
import { useState } from 'react';
import { cn } from '../lib/utils';

interface HelpModalProps {
    onClose: () => void;
}

export function HelpModal({ onClose }: HelpModalProps) {
    const [activeTab, setActiveTab] = useState<'basic' | 'tools' | 'settings'>('basic');

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
                    <button
                        onClick={() => setActiveTab('basic')}
                        className={cn("px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap", activeTab === 'basic' ? "text-blue-400 border-b-2 border-blue-400 bg-blue-500/5" : "text-white/50 hover:text-white hover:bg-white/5")}
                    >
                        基本操作
                    </button>
                    <button
                        onClick={() => setActiveTab('tools')}
                        className={cn("px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap", activeTab === 'tools' ? "text-blue-400 border-b-2 border-blue-400 bg-blue-500/5" : "text-white/50 hover:text-white hover:bg-white/5")}
                    >
                        ツール・練習
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={cn("px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap", activeTab === 'settings' ? "text-blue-400 border-b-2 border-blue-400 bg-blue-500/5" : "text-white/50 hover:text-white hover:bg-white/5")}
                    >
                        設定・トラブル
                    </button>
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
                                    <li>画面上部の <span className="text-blue-300">🎼 ガイド読込</span> から、練習したい曲のMIDIファイルまたは音声ファイルを読み込みます。</li>
                                    <li><span className="text-purple-300">🎵 伴奏</span> から、カラオケ音源などを読み込むと、ガイドと一緒に再生されます。</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-white font-bold text-lg mb-3 flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-red-400" />
                                    歌う・録音する
                                </h3>
                                <div className="space-y-2 text-sm ml-2">
                                    <p>画面下のマイクボタン <span className="inline-block p-1 bg-red-500/20 rounded border border-red-500/50"><Mic className="w-3 h-3 inline" /></span> を押すと、マイク入力がオンになります。</p>
                                    <p>録音ボタン（赤丸）を押すと、歌声を録音できます。</p>
                                    <p>歌うと、リアルタイムで自分の音程が<span className="text-green-400 font-bold">緑色の線</span>で描画されます。</p>
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
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-300">
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
                                    <li><span className="font-bold text-white">マイクが反応しない:</span> ブラウザのマイク権限が許可されているか確認してください。</li>
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
