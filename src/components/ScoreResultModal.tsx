
import { useRef, useEffect } from 'react';
import type { ScoreResult } from '../lib/ScoreAnalyzer';
import { historyManager } from '../lib/HistoryManager';
import { audioEngine } from '../lib/AudioEngine';
import { X, Trophy, Activity, Target, Music, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
    result: ScoreResult;
    onClose: () => void;
}

// Helper
const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const ScoreResultModal: React.FC<Props> = ({ result, onClose }) => {
    // Save to history on mount
    const savedRef = useRef(false);
    useEffect(() => {
        if (!savedRef.current) {
            historyManager.saveRecord({
                score: result.totalScore,
                accuracy: result.radar.pitch, // Use pitch score as general accuracy for now
                songName: "Unknown Song", // Ideally we'd pass the song name here
                duration: 0 // We aren't tracking duration yet, can add later
            });
            savedRef.current = true;
        }
    }, [result]);

    // Radar Chart Logic
    const radarData = [
        { label: '音程', val: result.radar.pitch, full: 100 },
        { label: '安定性', val: result.radar.stability, full: 100 },
        { label: '表現力', val: result.radar.expressiveness, full: 100 },
        { label: 'リズム', val: result.radar.rhythm, full: 100 },
        { label: '技術', val: result.radar.technique, full: 100 },
    ];

    const radius = 80;
    const center = 100;
    const points = radarData.map((d, i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const r = (d.val / 100) * radius;
        const x = center + r * Math.cos(angle);
        const y = center + r * Math.sin(angle);
        return `${x},${y}`;
    }).join(' ');

    const fullPoints = radarData.map((_, i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
            <div className="w-full max-w-4xl bg-[#1a1a1e] rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 p-6 flex items-center justify-between border-b border-white/10">
                    <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                        <Trophy className="text-yellow-400 fill-yellow-400" />
                        診断結果
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white">
                        <X />
                    </button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Left: Score & Comment */}
                    <div className="space-y-6 text-center md:text-left">
                        <div className="space-y-2">
                            <span className="text-sm font-bold tracking-widest text-white/40 uppercase">Total Score</span>
                            <div className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-white/50 shadow-glow">
                                {result.totalScore}
                                <span className="text-2xl text-white/30 font-normal ml-2">pts</span>
                            </div>
                        </div>

                        <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                            <h3 className="text-sm font-bold text-blue-300 mb-1">アドバイス</h3>
                            <p className="text-white/80 leading-relaxed text-sm">
                                {result.comment}
                            </p>
                        </div>

                        {/* Tendency Bar */}
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-white/40 uppercase font-bold">
                                <span>Flat (♭)</span>
                                <span>Perfect</span>
                                <span>Sharp (♯)</span>
                            </div>
                            <div className="h-4 bg-black/50 rounded-full relative overflow-hidden">
                                <div className="absolute top-0 bottom-0 w-0.5 bg-white/30 left-1/2 -ml-[0.5px]" />
                                {/* Bar */}
                                <div
                                    className={cn(
                                        "absolute top-1 bottom-1 rounded-full transition-all",
                                        result.tendency > 0 ? "bg-red-500 left-1/2" : "bg-blue-500 right-1/2"
                                    )}
                                    style={{
                                        [result.tendency > 0 ? 'width' : 'width']: `${Math.min(50, Math.abs(result.tendency))}%`
                                    }}
                                />
                                {/* If tendency is 0, nothing shows. If 20 (sharp), width 20% from center to right. */}
                            </div>
                            <div className="text-center text-xs text-white/30 font-mono">
                                傾向: {Math.abs(result.tendency).toFixed(1)} cent {result.tendency > 0 ? '高め' : result.tendency < 0 ? '低め' : ''}
                            </div>
                        </div>

                        {/* Expert Advice List */}
                        {result.advice && result.advice.length > 0 && (
                            <div className="space-y-3 pt-4 border-t border-white/10">
                                <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest flex items-center gap-2">
                                    <Zap size={14} className="text-yellow-400" />
                                    Expert Analysis
                                </h3>
                                <div className="space-y-2 max-h-[150px] overflow-y-auto pr-2 custom-scrollbar">
                                    {result.advice.map((adv, i) => (
                                        <div key={i} className={cn(
                                            "flex items-start gap-3 p-3 rounded-lg border text-sm",
                                            adv.level === 'warning' ? "bg-red-500/10 border-red-500/30 text-red-200" :
                                                adv.level === 'positive' ? "bg-green-500/10 border-green-500/30 text-green-200" :
                                                    "bg-blue-500/10 border-blue-500/30 text-blue-200"
                                        )}>
                                            <div className="mt-0.5 shrink-0">
                                                {adv.level === 'warning' ? <X size={16} /> :
                                                    adv.level === 'positive' ? <Trophy size={16} /> :
                                                        <Music size={16} />}
                                            </div>
                                            <span className="leading-snug">{adv.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: Radar & Details */}
                    <div className="relative">
                        {/* Radar Chart SVG */}
                        <div className="aspect-square w-full max-w-[280px] mx-auto relative">
                            <svg viewBox="-30 -30 260 260" className="w-full h-full drop-shadow-2xl">
                                {/* Grid Background */}
                                <polygon points={fullPoints} fill="#ffffff05" stroke="#ffffff20" strokeWidth="1" />
                                {[0.8, 0.6, 0.4, 0.2].map(scale => (
                                    <polygon
                                        key={scale}
                                        points={radarData.map((_, i) => {
                                            const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                                            const r = scale * radius;
                                            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
                                        }).join(' ')}
                                        fill="none"
                                        stroke="#ffffff10"
                                        strokeWidth="1"
                                    />
                                ))}

                                {/* Data Polygon */}
                                <polygon points={points} fill="rgba(99, 102, 241, 0.4)" stroke="#818cf8" strokeWidth="2" />

                                {/* Labels */}
                                {radarData.map((d, i) => {
                                    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                                    const r = radius + 20;
                                    const x = center + r * Math.cos(angle);
                                    const y = center + r * Math.sin(angle);
                                    return (
                                        <text
                                            key={i}
                                            x={x} y={y}
                                            fill="white"
                                            fontSize="10"
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                        >
                                            {d.label}
                                        </text>
                                    );
                                })}
                            </svg>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3 mt-4">
                            <div className="bg-white/5 p-3 rounded-xl flex items-center gap-3 border border-white/5">
                                <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400"><Activity size={16} /></div>
                                <div>
                                    <div className="text-[10px] text-white/40 uppercase">Vibrato</div>
                                    <div className="font-bold text-white">{result.vibratoCount}回 <span className="text-xs font-normal text-white/40">({result.vibratoSec.toFixed(1)}s)</span></div>
                                </div>
                            </div>
                            <div className="bg-white/5 p-3 rounded-xl flex items-center gap-3 border border-white/5">
                                <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400"><Target size={16} /></div>
                                <div>
                                    <div className="text-[10px] text-white/40 uppercase">Accuracy</div>
                                    <div className="font-bold text-white">{result.radar.pitch}<span className="text-xs">%</span></div>
                                </div>
                            </div>
                        </div>

                        {/* Pitch Tendency Analysis */}
                        {result.weakNotes && result.weakNotes.length > 0 && (
                            <div className="mt-4 bg-white/5 p-4 rounded-xl border border-white/5">
                                <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Target size={14} className="text-red-400" />
                                    Weak Point Analysis
                                </h3>
                                <div className="space-y-2">
                                    {result.weakNotes.map((stat, i) => {
                                        const alpha = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                                        const kata = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];
                                        // Access audio engine state via global or prop? 
                                        // ScoreResultModal doesn't have direct access to state unless passed or imported.
                                        // App.tsx passes `state`? No, just result.
                                        // We can direct import audioEngine state.
                                        const notation = audioEngine.state.noteNotation || 'alphabet';
                                        const name = notation === 'katakana' ? kata[stat.noteIndex] : alpha[stat.noteIndex];

                                        return (
                                            <div key={i} className="flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold w-12 h-6 flex items-center justify-center bg-white/10 rounded text-white/80 text-xs">{name}</span>
                                                    <span className="text-white/60">が</span>
                                                    <span className={cn(
                                                        "font-bold",
                                                        stat.diff > 0 ? "text-red-400" : "text-blue-400"
                                                    )}>
                                                        {stat.diff > 0 ? "高くなる" : "低くなる"}
                                                    </span>
                                                    <span className="text-white/60">傾向があります</span>
                                                </div>
                                                <div className="font-mono text-xs opacity-50">
                                                    {stat.diff > 0 ? '+' : ''}{stat.diff.toFixed(1)} cent
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Phrase Breakdown */}
                        {result.phraseScores && result.phraseScores.length > 0 && (
                            <div className="mt-6 space-y-3">
                                <h3 className="text-sm font-bold text-white/50 uppercase tracking-widest flex items-center gap-2">
                                    <Activity size={14} className="text-blue-400" />
                                    Phrase Analysis
                                </h3>
                                <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                    {result.phraseScores.map(p => (
                                        <div key={p.phraseId} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <span className="text-xs font-mono text-white/50">
                                                    {formatTime(p.startTime)}
                                                    <span className="mx-1">~</span>
                                                </span>
                                                <span className={cn(
                                                    "text-xs font-bold px-2 py-0.5 rounded-full border",
                                                    p.evaluation === 'Perfect' ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" :
                                                        p.evaluation === 'Good' ? "bg-green-500/20 text-green-300 border-green-500/30" :
                                                            "bg-white/10 text-white/40 border-white/10"
                                                )}>
                                                    {p.evaluation}
                                                </span>
                                            </div>
                                            <div className="font-bold text-white">
                                                {p.score} <span className="text-xs font-normal text-white/30">pts</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
