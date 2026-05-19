import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { cn } from '../lib/utils';

export function PitchIndicator() {
    const [pitchData, setPitchData] = useState<{
        currentPitch: number;
        targetPitch: number;
        cents: number;
        isActive: boolean;
        showTuner: boolean;
    }>({ currentPitch: 0, targetPitch: 0, cents: 0, isActive: false, showTuner: true });

    useEffect(() => {
        const update = () => {
            const state = audioEngine.state;
            const currentPitch = state.currentMicPitch || 0;

            // Find current guide note
            let targetPitch = 0;
            const pos = state.playbackPosition + state.timelineOffsetSec;
            const ghostNote = state.midiGhostNotes.find(
                n => pos >= n.time && pos <= n.time + n.duration
            );

            if (ghostNote) {
                const offset = state.guideOctaveOffset * 12;
                targetPitch = 440 * Math.pow(2, (ghostNote.midi + offset - 69) / 12);
            }

            let cents = 0;
            if (currentPitch > 0 && targetPitch > 0) {
                cents = Math.round(1200 * Math.log2(currentPitch / targetPitch));
            }

            setPitchData({
                currentPitch,
                targetPitch,
                cents,
                isActive: state.isPlaying && (currentPitch > 0 || !!ghostNote),
                showTuner: state.showTuner,
            });
        };

        const interval = setInterval(update, 50);
        return () => clearInterval(interval);
    }, []);

    if (!pitchData.showTuner || !pitchData.isActive || pitchData.targetPitch === 0) return null;

    const absCents = Math.abs(pitchData.cents);
    const isGood = absCents <= 20;
    const isOk = absCents <= 50;

    const displayCents = Math.max(-100, Math.min(100, pitchData.cents));
    const barPosition = 50 + (displayCents / 100) * 50;

    return (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50">
            <div className="relative bg-black/70 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/10 shadow-2xl">
                {/* Close button */}
                <button
                    onClick={() => audioEngine.updateState({ showTuner: false })}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors"
                    title="チューナーを非表示"
                >
                    <X className="w-3 h-3 text-white" />
                </button>

                {/* Pitch meter bar */}
                <div className="w-48 h-3 bg-white/10 rounded-full relative overflow-hidden mb-2">
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/30 -translate-x-1/2" />
                    <div className="absolute left-[40%] right-[40%] top-0 bottom-0 bg-emerald-500/20" />
                    {pitchData.currentPitch > 0 && (
                        <div
                            className={cn(
                                "absolute top-0 bottom-0 w-2 rounded-full transition-all duration-75 -translate-x-1/2",
                                isGood ? "bg-emerald-400 shadow-lg shadow-emerald-400/50" :
                                    isOk ? "bg-yellow-400 shadow-lg shadow-yellow-400/50" :
                                        "bg-red-400 shadow-lg shadow-red-400/50"
                            )}
                            style={{ left: `${barPosition}%` }}
                        />
                    )}
                </div>

                {/* Labels */}
                <div className="flex justify-between text-xs text-white/50">
                    <span>♭低い</span>
                    <span className={cn(
                        "font-mono font-bold text-sm",
                        isGood ? "text-emerald-400" :
                            isOk ? "text-yellow-400" :
                                "text-red-400"
                    )}>
                        {pitchData.cents > 0 ? '+' : ''}{pitchData.cents}¢
                    </span>
                    <span>高い♯</span>
                </div>

                {/* Feedback text */}
                <div className={cn(
                    "text-center text-xs font-medium mt-1 min-h-[1.5em]",
                    pitchData.currentPitch > 0 ? (
                        isGood ? "text-emerald-400" :
                            isOk ? "text-yellow-400" :
                                "text-red-400"
                    ) : "text-white/30"
                )}>
                    {pitchData.currentPitch > 0 ? (
                        isGood ? "🎯 Perfect!" :
                            isOk ? (pitchData.cents > 0 ? "少し高い" : "少し低い") :
                                (pitchData.cents > 0 ? "高すぎ！" : "低すぎ！")
                    ) : "待機中..."}
                </div>
            </div>
        </div>
    );
}
