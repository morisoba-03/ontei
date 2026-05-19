import { X, RotateCcw } from 'lucide-react';
import type { AudioEngine } from '../lib/AudioEngine';

interface TransposeModalProps {
    audioEngine: AudioEngine;
    onClose: () => void;
}

export function TransposeModal({ audioEngine, onClose }: TransposeModalProps) {
    const semitones = audioEngine.state.transposeOffset;
    const octave = audioEngine.state.guideOctaveOffset;

    const setSemitones = (v: number) => {
        audioEngine.updateState({ transposeOffset: Math.max(-12, Math.min(12, v)) });
    };
    const setOctave = (v: number) => {
        audioEngine.updateState({ guideOctaveOffset: Math.max(-2, Math.min(2, v)) });
    };
    const reset = () => {
        audioEngine.updateState({ transposeOffset: 0, guideOctaveOffset: 0 });
    };

    const totalSemitones = semitones + octave * 12;
    const label = totalSemitones === 0 ? '移調なし' : totalSemitones > 0 ? `+${totalSemitones} 半音` : `${totalSemitones} 半音`;

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-sm bg-[#1e1e24] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 flex flex-col gap-5"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white">ガイドノーツ 移調</h3>
                    <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Total offset label */}
                <div className="text-center text-2xl font-mono font-bold text-purple-300">
                    {label}
                </div>

                {/* Semitone control */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-white/50 font-medium tracking-wide uppercase">半音（±12）</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSemitones(semitones - 1)}
                            className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-colors"
                        >−</button>
                        <div className="flex-1 text-center text-lg font-mono text-white">
                            {semitones > 0 ? `+${semitones}` : semitones}
                        </div>
                        <button
                            onClick={() => setSemitones(semitones + 1)}
                            className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-colors"
                        >+</button>
                    </div>
                </div>

                {/* Octave control */}
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-white/50 font-medium tracking-wide uppercase">オクターブ（±2）</span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setOctave(octave - 1)}
                            className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-colors"
                        >−</button>
                        <div className="flex-1 text-center text-lg font-mono text-white">
                            {octave > 0 ? `+${octave}` : octave}
                        </div>
                        <button
                            onClick={() => setOctave(octave + 1)}
                            className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 text-white text-xl font-bold hover:bg-white/10 transition-colors"
                        >+</button>
                    </div>
                </div>

                {/* Reset */}
                <button
                    onClick={reset}
                    className="w-full py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                    <RotateCcw size={14} />
                    リセット
                </button>
            </div>
        </div>
    );
}
