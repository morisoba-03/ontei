import { Trash2, X, FileX, Eraser } from 'lucide-react';
import { cn } from '../lib/utils';

interface ResetConfirmModalProps {
    open: boolean;
    onClose: () => void;
    onResetAll: () => void;
    onResetPitchOnly: () => void;
}

export function ResetConfirmModal({ open, onClose, onResetAll, onResetPitchOnly }: ResetConfirmModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Trash2 className="w-5 h-5 text-red-400" />
                        リセット
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Options */}
                <div className="p-4 space-y-3">
                    <p className="text-white/60 text-sm mb-4">
                        リセットする内容を選択してください。
                    </p>

                    {/* Option 1: Reset All */}
                    <button
                        onClick={() => {
                            onResetAll();
                            onClose();
                        }}
                        className={cn(
                            "w-full p-4 rounded-xl text-left transition-all",
                            "bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40",
                            "group"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                                <FileX className="w-5 h-5 text-red-400" />
                            </div>
                            <div>
                                <div className="text-white font-medium">すべて消去</div>
                                <div className="text-white/50 text-sm">ノーツ・緑の線・読み込んだファイルをすべて消去します</div>
                            </div>
                        </div>
                    </button>

                    {/* Option 2: Reset Pitch Only */}
                    <button
                        onClick={() => {
                            onResetPitchOnly();
                            onClose();
                        }}
                        className={cn(
                            "w-full p-4 rounded-xl text-left transition-all",
                            "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 hover:border-emerald-500/40",
                            "group"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                <Eraser className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div>
                                <div className="text-white font-medium">練習記録のみ消去</div>
                                <div className="text-white/50 text-sm">緑の線（ピッチ履歴）のみを消去し、ノーツは残します</div>
                            </div>
                        </div>
                    </button>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-zinc-800/30">
                    <button
                        onClick={onClose}
                        className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all text-sm font-medium"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
}
