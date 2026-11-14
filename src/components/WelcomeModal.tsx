import { Music, Mic, BarChart3 } from 'lucide-react';

interface Props {
    onClose: () => void;
}

export function WelcomeModal({ onClose }: Props) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-300">
                <div className="p-6 text-center border-b border-white/10">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                        <Music className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Ontei</h1>
                    <p className="text-white/60 text-sm mt-1">口笛・歌の音程練習アプリへようこそ</p>
                </div>

                <div className="p-6 space-y-3">
                    <p className="text-white/60 text-sm text-center mb-4">3ステップで始められます</p>

                    <div className="flex items-start gap-4 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                        <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 font-bold text-sm">1</div>
                        <div>
                            <div className="text-white font-medium text-sm flex items-center gap-2">
                                <Music className="w-4 h-4 text-blue-400" /> 曲を選ぶ
                            </div>
                            <div className="text-white/60 text-sm mt-1">左上の「曲リスト」を押して、練習したい曲を選びます。</div>
                        </div>
                    </div>

                    <div className="flex items-start gap-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                        <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0 font-bold text-sm">2</div>
                        <div>
                            <div className="text-white font-medium text-sm flex items-center gap-2">
                                <Mic className="w-4 h-4 text-red-400" /> マイクをONにする
                            </div>
                            <div className="text-white/60 text-sm mt-1">右上の「MIC」を押します。「マイクを使いますか？」と出たら「許可」を押してください。</div>
                        </div>
                    </div>

                    <div className="flex items-start gap-4 bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                        <div className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0 font-bold text-sm">3</div>
                        <div>
                            <div className="text-white font-medium text-sm flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-green-400" /> ▶ を押して吹く
                            </div>
                            <div className="text-white/60 text-sm mt-1">お手本（横の棒）に合わせて吹くと、吹いた音が線で表示されます。合っていると緑色になります。</div>
                        </div>
                    </div>
                </div>

                <p className="px-5 pb-3 text-xs text-white/50 leading-relaxed">
                    💡 ブラウザのメニューから「ホーム画面に追加」しておくと、次からアプリのように開けて、保存した曲も消えにくくなります。
                </p>

                <div className="p-4 border-t border-white/10">
                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold transition-all"
                    >
                        はじめる
                    </button>
                </div>
            </div>
        </div>
    );
}
