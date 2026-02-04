
import { useState } from 'react';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface TutorialOverlayProps {
    onComplete: () => void;
}

const STEPS = [
    {
        title: "Onteiへようこそ！",
        description: "あなたの歌の練習をサポートするAIツールです。基本的な使い方を1分でご案内します。",
        targetId: null, // Center
        position: 'center'
    },
    {
        title: "1. ファイルを読み込む",
        description: "まずはここから、MIDIファイルや音声ファイル（伴奏・練習曲）を読み込んでみましょう。",
        targetId: "top-bar-import-controls", // ID we need to add to App.tsx
        position: 'bottom-left'
    },
    {
        title: "2. 再生コントロール",
        description: "再生・停止、ループ設定、伴奏のON/OFFはここで行います。",
        targetId: "bottom-controls-panel", // ID to add to Controls.tsx
        position: 'top'
    },
    {
        title: "3. 視覚化エリア",
        description: "ここにあなたの歌声のピッチ（音程）と、ガイドメロディが表示されます。ズレを確認しながら練習しましょう。",
        targetId: "canvas-container", // ID to add to App.tsx/CanvasView
        position: 'center'
    },
    {
        title: "4. 設定",
        description: "マイク感度や音量の調整、移調（キー変更）などはここから行えます。",
        targetId: "settings-button", // ID to add to Controls.tsx
        position: 'top-right'
    },
    {
        title: "準備完了！",
        description: "さあ、練習を始めましょう！",
        targetId: null,
        position: 'center'
    }
];

export function TutorialOverlay({ onComplete }: TutorialOverlayProps) {
    const [stepIndex, setStepIndex] = useState(0);

    const step = STEPS[stepIndex];

    // Calculate rect using useMemo to avoid setState in useEffect
    const rect = step.targetId ? (() => {
        const el = typeof document !== 'undefined' ? document.getElementById(step.targetId) : null;
        return el ? el.getBoundingClientRect() : null;
    })() : null;

    const handleNext = () => {
        if (stepIndex < STEPS.length - 1) {
            setStepIndex(stepIndex + 1);
        } else {
            onComplete();
        }
    };

    const handlePrev = () => {
        if (stepIndex > 0) {
            setStepIndex(stepIndex - 1);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] pointer-events-auto">
            {/* Backdrop with cutout effect can be complex, for now simple semi-transparent bg */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-all duration-500" />

            {/* Spotlight Effect (Optional, simulated with absolute positioning) */}
            {rect && (
                <div
                    className="absolute border-2 border-yellow-400 box-content rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] transition-all duration-300 pointer-events-none"
                    style={{
                        top: rect.top - 4,
                        left: rect.left - 4,
                        width: rect.width + 8,
                        height: rect.height + 8,
                        zIndex: 10
                    }}
                />
            )}

            {/* Content Card */}
            <div
                className={cn(
                    "absolute transition-all duration-500 flex flex-col items-center justify-center p-6",
                    step.position === 'center' && "inset-0",
                    step.position !== 'center' && "z-20",
                )}
                style={step.position !== 'center' && rect ? {
                    top: step.position === 'top' ? rect.top - 180 : step.position === 'bottom-left' ? rect.bottom + 20 : rect.top - 180,
                    left: step.position === 'top-right' ? rect.right - 300 : rect.left,
                } : {}}
            >
                <div className="bg-[#1e1e24] border border-white/10 p-6 rounded-2xl shadow-2xl max-w-md w-full animate-in fade-in zoom-in-95 duration-300 relative overflow-hidden group">
                    {/* Background decoration */}
                    <div className="absolute -top-10 -right-10 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all" />
                    <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all" />

                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                                {step.title}
                            </h2>
                            <button onClick={onComplete} className="text-white/30 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <p className="text-white/70 mb-8 leading-relaxed">
                            {step.description}
                        </p>

                        <div className="flex items-center justify-between mt-auto">
                            <div className="flex gap-1">
                                {STEPS.map((_, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            "w-2 h-2 rounded-full transition-all duration-300",
                                            i === stepIndex ? "bg-blue-500 w-6" : "bg-white/20"
                                        )}
                                    />
                                ))}
                            </div>

                            <div className="flex gap-2">
                                {stepIndex > 0 && (
                                    <button
                                        onClick={handlePrev}
                                        className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors flex items-center gap-1"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                        戻る
                                    </button>
                                )}
                                <button
                                    onClick={handleNext}
                                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full shadow-lg hover:shadow-blue-500/25 transition-all flex items-center gap-2"
                                >
                                    {stepIndex === STEPS.length - 1 ? "始める" : "次へ"}
                                    {stepIndex < STEPS.length - 1 && <ChevronRight className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
