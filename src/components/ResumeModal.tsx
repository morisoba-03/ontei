import { Music, PlusCircle } from 'lucide-react';

interface ResumeModalProps {
    onResume: () => void;
    onNew: () => void;
}

export function ResumeModal({ onResume, onNew }: ResumeModalProps) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-sm mx-4 bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-6">
                {/* Header */}
                <div className="flex flex-col items-center gap-2 text-center">
                    <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mb-1">
                        <Music className="w-6 h-6 text-purple-400" />
                    </div>
                    <h2 className="text-lg font-bold text-white">前回の練習データがあります</h2>
                    <p className="text-sm text-white/50">前回の続きから再開しますか？</p>
                </div>

                {/* Buttons */}
                <div className="flex flex-col gap-3">
                    <button
                        onClick={onResume}
                        className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                        <Music className="w-4 h-4" />
                        前回の続きから再開
                    </button>
                    <button
                        onClick={onNew}
                        className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <PlusCircle className="w-4 h-4" />
                        新しく始める
                    </button>
                </div>
            </div>
        </div>
    );
}
