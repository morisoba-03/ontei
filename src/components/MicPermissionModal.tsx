import { Mic } from 'lucide-react';

interface Props {
    onConfirm: () => void;
    onCancel: () => void;
}

export function MicPermissionModal({ onConfirm, onCancel }: Props) {
    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 text-center space-y-4">
                    <div className="w-14 h-14 mx-auto rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                        <Mic className="w-7 h-7 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-semibold text-lg">マイクの使用を許可</h3>
                        <p className="text-white/60 text-sm mt-2 leading-relaxed">
                            音程を検知するためにマイクが必要です。<br />
                            次の画面でブラウザのマイク使用を<br />
                            <span className="text-green-400 font-medium">「許可」</span>してください。
                        </p>
                        <p className="text-white/30 text-xs mt-3">
                            マイク音声はサーバーに送信されません。<br />
                            すべての処理はブラウザ内で行われます。
                        </p>
                    </div>
                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={onCancel}
                            className="flex-1 py-2.5 rounded-xl border border-white/10 text-white/60 hover:bg-white/5 transition-colors text-sm"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium transition-colors text-sm"
                        >
                            許可する
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
