import React, { useState } from 'react';
import { AudioEngine } from '../lib/AudioEngine';
import { X, Play, Square, Activity, Settings2, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ScaleType, ArpeggioType, PracticeConfig } from '../lib/types';

interface Props {
    audioEngine: AudioEngine;
    isPracticing: boolean;
    onClose: () => void;
}

const SCALE_TYPES: ScaleType[] = ['Major', 'NaturalMinor', 'HarmonicMinor', 'MelodicMinor', 'MajorPentatonic', 'MinorPentatonic', 'Chromatic'];
const ARP_TYPES: ArpeggioType[] = ['Major', 'Minor', 'Major7', 'Minor7', 'Dominant7'];
const EXERCISE_TYPES: import('../lib/types').ExerciseType[] = ['LongTone', 'FiveNote', 'Triad', 'Thirds', 'Octave'];

export const PracticeControlPanel: React.FC<Props> = ({ audioEngine, isPracticing, onClose }) => {
    const [mode, setMode] = useState<'Mix' | 'Scale' | 'Arpeggio' | 'Exercise'>('Exercise');
    const [selectedScales, setSelectedScales] = useState<ScaleType[]>(['Major', 'NaturalMinor']);
    const [selectedArps, setSelectedArps] = useState<ArpeggioType[]>(['Major', 'Minor']);
    const [selectedExercises, setSelectedExercises] = useState<import('../lib/types').ExerciseType[]>(['LongTone', 'FiveNote', 'Triad']);
    const [maxPitch, setMaxPitch] = useState<number>(103); // Default G7
    const [showConfig, setShowConfig] = useState(true); // Always show config on start

    const handleStart = () => {
        const config: PracticeConfig = {
            mode,
            allowedScales: selectedScales,
            allowedArpeggios: selectedArps,
            allowedExercises: selectedExercises,
            maxPitch // Pass selected max pitch
        };
        audioEngine.startPractice(config);
        setShowConfig(false);
    };

    const handleStop = () => {
        audioEngine.stopPractice();
    };

    const toggleScale = (t: ScaleType) => {
        if (selectedScales.includes(t)) {
            setSelectedScales(selectedScales.filter(s => s !== t));
        } else {
            setSelectedScales([...selectedScales, t]);
        }
    };

    const toggleArp = (t: ArpeggioType) => {
        if (selectedArps.includes(t)) {
            setSelectedArps(selectedArps.filter(a => a !== t));
        } else {
            setSelectedArps([...selectedArps, t]);
        }
    };

    const toggleExercise = (t: import('../lib/types').ExerciseType) => {
        if (selectedExercises.includes(t)) {
            setSelectedExercises(selectedExercises.filter(e => e !== t));
        } else {
            setSelectedExercises([...selectedExercises, t]);
        }
    };

    return (
        <div className="absolute top-20 right-4 z-40 w-80 bg-black/90 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden text-white/90 animate-in fade-in slide-in-from-right-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
                <h3 className="font-bold flex items-center gap-2">
                    <span className="p-1 rounded bg-green-500/20 text-green-400">
                        <Activity size={16} />
                    </span>
                    練習モード
                </h3>
                <div className="flex items-center gap-1">
                    {!isPracticing && (
                        <button
                            onClick={() => setShowConfig(!showConfig)}
                            className={cn(
                                "p-2 rounded-full transition-colors",
                                showConfig ? "bg-white/20 text-white" : "hover:bg-white/10 text-white/60"
                            )}
                            title="設定"
                        >
                            <Settings2 size={18} />
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        aria-label="閉じる"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="space-y-2">
                    <p className="text-sm text-white/60 leading-relaxed">
                        ランダムなパターントレーニングを行います。
                    </p>
                </div>

                {/* Configuration Panel */}
                {(showConfig && !isPracticing) && (
                    <div className="space-y-4 bg-white/5 p-4 rounded-xl border border-white/5">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-white/40 uppercase tracking-wider">モード</label>
                            <div className="flex bg-black/40 p-1 rounded-lg">
                                {(['Exercise', 'Mix', 'Scale', 'Arpeggio'] as const).map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setMode(m)}
                                        className={cn(
                                            "flex-1 py-1.5 text-xs font-medium rounded-md transition-all",
                                            mode === m ? "bg-white/20 text-white shadow-sm" : "text-white/40 hover:text-white/60"
                                        )}
                                    >
                                        {m === 'Mix' ? 'ミックス' : m === 'Scale' ? 'スケール' : m === 'Arpeggio' ? 'アルペジオ' : '基礎連'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {(mode === 'Scale' || mode === 'Mix') && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-white/40 uppercase tracking-wider">スケールタイプ</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {SCALE_TYPES.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => toggleScale(t)}
                                            className={cn(
                                                "px-2 py-1.5 text-[10px] text-left rounded border transition-all flex items-center justify-between",
                                                selectedScales.includes(t)
                                                    ? "bg-green-500/20 border-green-500/30 text-green-300"
                                                    : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                                            )}
                                        >
                                            <span className="truncate">
                                                {t === 'Major' ? 'メジャー (長調)'
                                                    : t === 'NaturalMinor' ? 'ナチュラルマイナー'
                                                        : t === 'HarmonicMinor' ? 'ハーモニックマイナー'
                                                            : t === 'MelodicMinor' ? 'メロディックマイナー'
                                                                : t === 'MajorPentatonic' ? 'メジャーペンタ'
                                                                    : t === 'MinorPentatonic' ? 'マイナーペンタ'
                                                                        : 'クロマチック (半音)'}
                                            </span>
                                            {selectedScales.includes(t) && <Check size={10} />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(mode === 'Arpeggio' || mode === 'Mix') && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-white/40 uppercase tracking-wider">アルペジオタイプ</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {ARP_TYPES.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => toggleArp(t)}
                                            className={cn(
                                                "px-2 py-1.5 text-[10px] text-left rounded border transition-all flex items-center justify-between",
                                                selectedArps.includes(t)
                                                    ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                                                    : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                                            )}
                                        >
                                            <span className="truncate">
                                                {t === 'Major' ? 'メジャー'
                                                    : t === 'Minor' ? 'マイナー'
                                                        : t === 'Major7' ? 'メジャー7th'
                                                            : t === 'Minor7' ? 'マイナー7th'
                                                                : 'ドミナント7th'}
                                            </span>
                                            {selectedArps.includes(t) && <Check size={10} />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {(mode === 'Exercise' || mode === 'Mix') && (
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-white/40 uppercase tracking-wider">基礎練習パターン</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {EXERCISE_TYPES.map(t => (
                                        <button
                                            key={t}
                                            onClick={() => toggleExercise(t)}
                                            className={cn(
                                                "px-2 py-1.5 text-[10px] text-left rounded border transition-all flex items-center justify-between",
                                                selectedExercises.includes(t)
                                                    ? "bg-purple-500/20 border-purple-500/30 text-purple-300"
                                                    : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                                            )}
                                        >
                                            <span className="truncate">
                                                {t === 'LongTone' ? 'ロングトーン'
                                                    : t === 'FiveNote' ? '5音スケール'
                                                        : t === 'Triad' ? 'トライアド (3和音)'
                                                            : t === 'Thirds' ? '3度進行'
                                                                : 'オクターブ跳躍'}
                                            </span>
                                            {selectedExercises.includes(t) && <Check size={10} />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-white/40 uppercase tracking-wider">上限音域</label>
                            <div className="flex bg-black/40 p-1 rounded-lg">
                                {([
                                    { label: 'G6 (普通)', val: 91 },
                                    { label: 'C7 (高い)', val: 96 },
                                    { label: 'G7 (超高音)', val: 103 },
                                    { label: 'C8 (極限)', val: 108 }
                                ]).map(opt => (
                                    <button
                                        key={opt.val}
                                        onClick={() => setMaxPitch(opt.val)}
                                        className={cn(
                                            "flex-1 py-1.5 text-[10px] font-medium rounded-md transition-all",
                                            maxPitch === opt.val ? "bg-white/20 text-white shadow-sm" : "text-white/40 hover:text-white/60"
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {!isPracticing ? (
                    <button
                        onClick={handleStart}
                        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-green-500/20 active:scale-95"
                    >
                        <Play size={18} className="fill-white" />
                        練習を開始
                    </button>
                ) : (
                    <div className="space-y-4">
                        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl space-y-2 animate-pulse">
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
                                <span className="text-green-400 font-medium text-sm">トレーニング進行中...</span>
                            </div>
                            <div className="text-[10px] text-green-300/60 pl-5">
                                Mode: {audioEngine.state.practiceConfig?.mode === 'Mix' ? 'ミックス' :
                                    audioEngine.state.practiceConfig?.mode === 'Scale' ? 'スケール' :
                                        audioEngine.state.practiceConfig?.mode === 'Arpeggio' ? 'アルペジオ' :
                                            audioEngine.state.practiceConfig?.mode === 'Exercise' ? '基礎連' : '通常'}
                            </div>
                        </div>

                        {/* Octave Control */}
                        <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/10">
                            <span className="text-xs text-white/60">ガイド音程</span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        audioEngine.updateState({ guideOctaveOffset: audioEngine.state.guideOctaveOffset - 1 });
                                    }}
                                    className="p-1 hover:bg-white/10 rounded"
                                >
                                    -
                                </button>
                                <span className="text-sm font-bold w-4 text-center">
                                    {audioEngine.state.guideOctaveOffset > 0 ? '+' : ''}{audioEngine.state.guideOctaveOffset}
                                </span>
                                <button
                                    onClick={() => {
                                        audioEngine.updateState({ guideOctaveOffset: audioEngine.state.guideOctaveOffset + 1 });
                                    }}
                                    className="p-1 hover:bg-white/10 rounded"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={handleStop}
                            className="w-full py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 font-bold rounded-xl flex items-center justify-center gap-2 transition-all border border-red-500/20 active:scale-95"
                        >
                            <Square size={18} className="fill-current" />
                            終了する
                        </button>
                    </div>
                )}

                <div className="pt-2 text-[10px] text-center text-white/20 border-t border-white/5">
                    Continuous Practice Generator v1.1
                </div>
            </div>
        </div>
    );
};
