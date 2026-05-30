
import { useState } from 'react';
import type { ScoreResult } from '../lib/ScoreAnalyzer';
import { audioEngine } from '../lib/AudioEngine';
import { toast } from './Toast';
import { X, Trophy, Activity, Target, Music, Zap, TrendingUp, TrendingDown, AlertCircle, CheckCircle, Info, Repeat, ListChecks, Play } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
    result: ScoreResult;
    onClose: () => void;
}

const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const getGrade = (score: number): { letter: string; color: string; bg: string; border: string; desc: string } => {
    if (score >= 95) return { letter: 'S', color: 'text-yellow-300', bg: 'bg-yellow-500/20', border: 'border-yellow-400/50', desc: '完璧' };
    if (score >= 85) return { letter: 'A', color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/50', desc: '優秀' };
    if (score >= 75) return { letter: 'B', color: 'text-blue-300', bg: 'bg-blue-500/20', border: 'border-blue-400/50', desc: '良好' };
    if (score >= 60) return { letter: 'C', color: 'text-purple-300', bg: 'bg-purple-500/20', border: 'border-purple-400/50', desc: '普通' };
    if (score >= 45) return { letter: 'D', color: 'text-orange-300', bg: 'bg-orange-500/20', border: 'border-orange-400/50', desc: '要練習' };
    return { letter: 'F', color: 'text-red-300', bg: 'bg-red-500/20', border: 'border-red-400/50', desc: '要基礎練習' };
};

const radarLabel = (key: string) => ({ pitch: '音程', stability: '安定性', expressiveness: '表現力', rhythm: 'リズム', technique: '技術' })[key] ?? key;

export const ScoreResultModal: React.FC<Props> = ({ result, onClose }) => {
    const grade = getGrade(result.totalScore);
    const [showOvercomingList, setShowOvercomingList] = useState(false);

    const difficultSections = result.difficultSections ?? [];

    const startLoopPractice = (section: { extendedStart: number; extendedEnd: number; start: number; end: number }) => {
        audioEngine.updateState({
            loopEnabled: true,
            loopStart: section.extendedStart,
            loopEnd: section.extendedEnd,
            playbackPosition: section.extendedStart,
        });
        // 練習開始
        audioEngine.startPlayback();
        toast.show(
            `${formatTime(section.extendedStart)} 〜 ${formatTime(section.extendedEnd)} をループ練習開始`,
            'info',
            { duration: 2500 }
        );
        onClose();
    };

    const radarData = [
        { label: '音程', val: result.radar.pitch },
        { label: '安定性', val: result.radar.stability },
        { label: '表現力', val: result.radar.expressiveness },
        { label: 'リズム', val: result.radar.rhythm },
        { label: '技術', val: result.radar.technique },
    ];

    const radius = 80;
    const center = 100;
    const points = radarData.map((d, i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const r = (d.val / 100) * radius;
        return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(' ');

    const fullPoints = radarData.map((_, i) => {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        return `${center + radius * Math.cos(angle)},${center + radius * Math.sin(angle)}`;
    }).join(' ');

    // 最も低いスコアと最も高いスコアの項目
    const radarEntries = Object.entries(result.radar) as [string, number][];
    const bestArea = radarEntries.reduce((a, b) => b[1] > a[1] ? b : a);
    const worstArea = radarEntries.reduce((a, b) => b[1] < a[1] ? b : a);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300 p-4">
            <div className="w-full max-w-4xl bg-[#1a1a1e] rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90dvh]">

                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 p-4 md:p-6 flex items-center justify-between border-b border-white/10 shrink-0 gap-3">
                    <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2 text-white">
                        <Trophy className="text-yellow-400 fill-yellow-400" />
                        演奏診断結果
                    </h2>
                    <div className="flex items-center gap-2">
                        {difficultSections.length > 0 && (
                            <button
                                onClick={() => setShowOvercomingList(true)}
                                className="px-3 md:px-4 py-2 rounded-xl bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 font-bold text-sm transition-colors border border-orange-500/30 flex items-center gap-1.5"
                                title="苦手区間をリスト形式で表示"
                            >
                                <ListChecks size={16} />
                                <span className="hidden sm:inline">克服リスト</span>
                                <span className="bg-orange-500/40 text-orange-100 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                    {difficultSections.length}
                                </span>
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-5 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 overflow-y-auto overscroll-contain custom-scrollbar">

                    {/* ── 左カラム ── */}
                    <div className="space-y-5">

                        {/* スコア + グレード */}
                        <div className="flex items-center gap-5">
                            <div>
                                <div className="text-xs font-bold tracking-widest text-white/40 uppercase mb-1">Total Score</div>
                                <div className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white to-white/40 leading-none">
                                    {result.totalScore}
                                    <span className="text-xl text-white/30 font-normal ml-1">pts</span>
                                </div>
                            </div>
                            <div className={cn(
                                "w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center shrink-0",
                                grade.bg, grade.border
                            )}>
                                <span className={cn("text-4xl font-black leading-none", grade.color)}>{grade.letter}</span>
                                <span className={cn("text-[10px] font-bold mt-0.5", grade.color)}>{grade.desc}</span>
                            </div>
                        </div>

                        {/* アドバイスコメント */}
                        <div className="p-4 bg-white/5 rounded-2xl border border-white/8">
                            <h3 className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                <Music size={12} />
                                今回の総評
                            </h3>
                            <p className="text-white/85 leading-relaxed text-sm">{result.comment}</p>
                        </div>

                        {/* ベスト・改善点サマリー */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/25">
                                <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <CheckCircle size={10} /> 最も良かった点
                                </div>
                                <div className="text-sm font-bold text-white/90">{radarLabel(bestArea[0])}</div>
                                <div className="text-lg font-black text-emerald-400 leading-none">{bestArea[1]}<span className="text-xs font-normal text-emerald-400/60">点</span></div>
                            </div>
                            <div className="p-3 bg-orange-500/10 rounded-xl border border-orange-500/25">
                                <div className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <AlertCircle size={10} /> 重点強化ポイント
                                </div>
                                <div className="text-sm font-bold text-white/90">{radarLabel(worstArea[0])}</div>
                                <div className="text-lg font-black text-orange-400 leading-none">{worstArea[1]}<span className="text-xs font-normal text-orange-400/60">点</span></div>
                            </div>
                        </div>

                        {/* ピッチ傾向バー */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] text-white/40 uppercase font-bold">
                                <span>♭ Flat</span>
                                <span>Perfect</span>
                                <span>Sharp ♯</span>
                            </div>
                            <div className="h-3 bg-black/50 rounded-full relative overflow-hidden">
                                <div className="absolute top-0 bottom-0 w-px bg-white/30 left-1/2" />
                                <div
                                    className={cn(
                                        "absolute top-0.5 bottom-0.5 rounded-full transition-all",
                                        result.tendency > 0 ? "bg-red-500 left-1/2" : "bg-blue-500 right-1/2"
                                    )}
                                    style={{ width: `${Math.min(50, Math.abs(result.tendency / 2))}%` }}
                                />
                            </div>
                            <div className="text-center text-[10px] text-white/30 font-mono">
                                {Math.abs(result.tendency) < 5
                                    ? "ピッチ傾向：ほぼ中央 ✓"
                                    : `ピッチ傾向：${Math.abs(result.tendency).toFixed(1)} cent ${result.tendency > 0 ? '高め (Sharp)' : '低め (Flat)'}`
                                }
                            </div>
                        </div>

                        {/* Expert Advice */}
                        {result.advice && result.advice.length > 0 && (
                            <div className="space-y-2 pt-3 border-t border-white/8">
                                <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest flex items-center gap-1.5">
                                    <Zap size={12} className="text-yellow-400" />
                                    詳細アドバイス
                                </h3>
                                <div className="space-y-2">
                                    {result.advice.map((adv, i) => {
                                        const Icon = adv.level === 'warning' ? AlertCircle
                                            : adv.level === 'positive' ? CheckCircle
                                            : Info;
                                        const colors = adv.level === 'warning'
                                            ? "bg-red-500/10 border-red-500/25 text-red-200"
                                            : adv.level === 'positive'
                                            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-200"
                                            : "bg-blue-500/10 border-blue-500/25 text-blue-200";
                                        const iconColor = adv.level === 'warning' ? "text-red-400"
                                            : adv.level === 'positive' ? "text-emerald-400"
                                            : "text-blue-400";
                                        return (
                                            <div key={i} className={cn("flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed", colors)}>
                                                <Icon size={14} className={cn("shrink-0 mt-0.5", iconColor)} />
                                                <span>{adv.message}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── 右カラム ── */}
                    <div className="space-y-5">

                        {/* レーダーチャート */}
                        <div>
                            <div className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                <Activity size={12} />
                                パフォーマンスレーダー
                            </div>
                            <div className="aspect-square w-full max-w-[260px] mx-auto">
                                <svg viewBox="-30 -30 260 260" className="w-full h-full drop-shadow-2xl">
                                    <polygon points={fullPoints} fill="#ffffff05" stroke="#ffffff20" strokeWidth="1" />
                                    {[0.8, 0.6, 0.4, 0.2].map(scale => (
                                        <polygon
                                            key={scale}
                                            points={radarData.map((_, i) => {
                                                const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                                                const r = scale * radius;
                                                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
                                            }).join(' ')}
                                            fill="none" stroke="#ffffff10" strokeWidth="1"
                                        />
                                    ))}
                                    <polygon points={points} fill="rgba(99,102,241,0.35)" stroke="#818cf8" strokeWidth="2" />
                                    {radarData.map((d, i) => {
                                        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                                        const r = radius + 22;
                                        return (
                                            <text key={i} x={center + r * Math.cos(angle)} y={center + r * Math.sin(angle)}
                                                fill="rgba(255,255,255,0.7)" fontSize="10" textAnchor="middle" dominantBaseline="middle">
                                                {d.label}
                                            </text>
                                        );
                                    })}
                                </svg>
                            </div>
                        </div>

                        {/* スコア詳細グリッド */}
                        <div className="grid grid-cols-2 gap-2">
                            {radarData.map(d => (
                                <div key={d.label} className="bg-white/5 px-3 py-2 rounded-xl border border-white/5 flex items-center justify-between">
                                    <span className="text-xs text-white/50">{d.label}</span>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className={cn("h-full rounded-full transition-all",
                                                    d.val >= 85 ? "bg-emerald-400" : d.val >= 65 ? "bg-blue-400" : d.val >= 45 ? "bg-yellow-400" : "bg-red-400"
                                                )}
                                                style={{ width: `${d.val}%` }}
                                            />
                                        </div>
                                        <span className={cn("text-sm font-bold w-8 text-right",
                                            d.val >= 85 ? "text-emerald-400" : d.val >= 65 ? "text-blue-300" : d.val >= 45 ? "text-yellow-300" : "text-red-300"
                                        )}>{d.val}</span>
                                    </div>
                                </div>
                            ))}
                            <div className="bg-white/5 px-3 py-2 rounded-xl border border-white/5 flex items-center justify-between">
                                <span className="text-xs text-white/50">ビブラート</span>
                                <span className="text-sm font-bold text-pink-300">{result.vibratoCount}回</span>
                            </div>
                            <div className="bg-white/5 px-3 py-2 rounded-xl border border-white/5 flex items-center justify-between">
                                <span className="text-xs text-white/50">正確度</span>
                                <span className="text-sm font-bold text-emerald-300">{result.radar.pitch}%</span>
                            </div>
                        </div>

                        {/* 苦手な音 */}
                        {result.weakNotes && result.weakNotes.length > 0 && (
                            <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                                    <Target size={12} className="text-red-400" />
                                    ピッチが外れやすかった音
                                </h3>
                                <div className="space-y-2">
                                    {result.weakNotes.map((stat, i) => {
                                        const alpha = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                                        const kata = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];
                                        const notation = audioEngine.state.noteNotation || 'alphabet';
                                        const name = notation === 'katakana' ? kata[stat.noteIndex] : alpha[stat.noteIndex];
                                        const isSharp = stat.diff > 0;
                                        const TrendIcon = isSharp ? TrendingUp : TrendingDown;

                                        return (
                                            <div key={i} className="flex items-center gap-3 text-sm">
                                                <span className="font-bold w-10 h-7 flex items-center justify-center bg-white/10 rounded-lg text-white/85 text-xs shrink-0">{name}</span>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <TrendIcon size={13} className={isSharp ? "text-red-400" : "text-blue-400"} />
                                                        <span className={cn("font-bold text-xs", isSharp ? "text-red-300" : "text-blue-300")}>
                                                            {isSharp ? '高め' : '低め'}
                                                        </span>
                                                        <span className="text-white/40 text-xs">（平均 {isSharp ? '+' : ''}{stat.diff.toFixed(0)} ¢）</span>
                                                    </div>
                                                    <div className="text-[10px] text-white/30 mt-0.5">
                                                        {isSharp
                                                            ? '息の圧力を少し緩めて吹きましょう'
                                                            : '息のスピードを少し上げてみましょう'}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 苦手区間（克服リスト・トップ3） */}
                        {difficultSections.length > 0 && (
                            <div className="bg-orange-500/5 p-4 rounded-xl border border-orange-500/20">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold text-orange-300 uppercase tracking-widest flex items-center gap-1.5">
                                        <Repeat size={12} />
                                        反復練習したい苦手区間
                                    </h3>
                                    {difficultSections.length > 3 && (
                                        <button
                                            onClick={() => setShowOvercomingList(true)}
                                            className="text-[10px] text-orange-300/80 hover:text-orange-200 underline"
                                        >
                                            すべて見る ({difficultSections.length})
                                        </button>
                                    )}
                                </div>
                                {/* 連続練習（プレイリスト） */}
                                {difficultSections.length > 1 && (
                                    <button
                                        onClick={() => {
                                            audioEngine.startDifficultPlaylist(
                                                difficultSections.map(s => ({ start: s.extendedStart, end: s.extendedEnd })),
                                                2
                                            );
                                            onClose();
                                        }}
                                        className="w-full mb-2 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-200 text-xs font-bold transition-all active:scale-95"
                                    >
                                        <ListChecks size={14} />
                                        全{difficultSections.length}区間を連続練習（各2回）
                                    </button>
                                )}
                                <div className="space-y-1.5">
                                    {difficultSections.slice(0, 3).map((s, i) => (
                                        <button
                                            key={i}
                                            onClick={() => startLoopPractice(s)}
                                            className="w-full flex items-center gap-2 p-2.5 bg-white/5 hover:bg-orange-500/15 rounded-lg border border-white/5 hover:border-orange-500/30 transition-all text-left group"
                                        >
                                            <div className="w-7 h-7 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-300 font-bold text-xs shrink-0 group-hover:bg-orange-500/40">
                                                {i + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-white/90">
                                                    {formatTime(s.start)} 〜 {formatTime(s.end)}
                                                    <span className="text-[10px] text-white/40 ml-2 font-normal">
                                                        （練習範囲 {formatTime(s.extendedStart)}〜{formatTime(s.extendedEnd)}）
                                                    </span>
                                                </div>
                                                <div className="text-[10px] text-orange-300/70 mt-0.5">
                                                    平均ズレ ±{Math.round(s.avgCents)}¢
                                                </div>
                                            </div>
                                            <Play size={14} className="text-orange-300/60 group-hover:text-orange-300 shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* フレーズ別評価 */}
                        {result.phraseScores && result.phraseScores.length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                    <Activity size={12} className="text-blue-400" />
                                    フレーズ別評価
                                </h3>
                                <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                                    {result.phraseScores.map((p, idx) => (
                                        <div key={p.phraseId} className="flex items-center gap-2 p-2.5 bg-white/5 rounded-lg border border-white/5 hover:bg-white/8 transition-colors">
                                            <span className="text-[10px] font-mono text-white/35 w-10 shrink-0">#{idx + 1}</span>
                                            <span className="text-[10px] font-mono text-white/40 shrink-0">{formatTime(p.startTime)}〜</span>
                                            <span className={cn(
                                                "text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0",
                                                p.evaluation === 'Perfect' ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" :
                                                    p.evaluation === 'Good' ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" :
                                                        "bg-white/8 text-white/35 border-white/10"
                                            )}>
                                                {p.evaluation}
                                            </span>
                                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className={cn("h-full rounded-full",
                                                        p.score >= 90 ? "bg-yellow-400" : p.score >= 70 ? "bg-emerald-400" : "bg-white/30"
                                                    )}
                                                    style={{ width: `${p.score}%` }}
                                                />
                                            </div>
                                            <span className="text-xs font-bold text-white/60 w-8 text-right shrink-0">{p.score}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-black/20 flex justify-center shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full md:w-auto px-8 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all border border-white/5 shadow-lg active:scale-95"
                    >
                        閉じる
                    </button>
                </div>
            </div>

            {/* 克服リスト全表示オーバーレイ */}
            {showOvercomingList && (
                <div
                    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
                    onClick={() => setShowOvercomingList(false)}
                >
                    <div
                        className="w-full max-w-2xl bg-[#1a1a1e] rounded-2xl border border-orange-500/30 shadow-2xl overflow-hidden max-h-[85dvh] flex flex-col animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-5 border-b border-white/10 bg-gradient-to-r from-orange-900/40 to-red-900/40 flex items-center justify-between shrink-0">
                            <h2 className="text-lg md:text-xl font-bold flex items-center gap-2 text-white">
                                <ListChecks className="text-orange-300" />
                                克服リスト
                                <span className="text-xs font-normal text-white/50">
                                    （{difficultSections.length}件の苦手区間）
                                </span>
                            </h2>
                            <button
                                onClick={() => setShowOvercomingList(false)}
                                className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto custom-scrollbar space-y-2">
                            <p className="text-xs text-white/60 mb-3 leading-relaxed">
                                各項目をクリックすると、前後2小節を含めた範囲でループ練習を開始します。
                            </p>
                            {difficultSections.length > 1 && (
                                <button
                                    onClick={() => {
                                        audioEngine.startDifficultPlaylist(
                                            difficultSections.map(s => ({ start: s.extendedStart, end: s.extendedEnd })),
                                            2
                                        );
                                        onClose();
                                    }}
                                    className="w-full mb-3 flex items-center justify-center gap-2 py-3 rounded-xl bg-orange-500/25 hover:bg-orange-500/35 border border-orange-500/40 text-orange-100 text-sm font-bold transition-all active:scale-95"
                                >
                                    <ListChecks size={16} />
                                    全{difficultSections.length}区間を連続練習（各2回ループ）
                                </button>
                            )}
                            {difficultSections.map((s, i) => (
                                <button
                                    key={i}
                                    onClick={() => startLoopPractice(s)}
                                    className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-orange-500/15 rounded-xl border border-white/10 hover:border-orange-500/40 transition-all text-left group"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-300 font-black text-base shrink-0 group-hover:bg-orange-500/40">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold text-white/95">
                                            苦手区間：{formatTime(s.start)} 〜 {formatTime(s.end)}
                                        </div>
                                        <div className="text-[11px] text-white/50 mt-0.5">
                                            練習範囲（前後2小節）：{formatTime(s.extendedStart)} 〜 {formatTime(s.extendedEnd)}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                                            <span className="text-orange-300/90">
                                                平均ピッチズレ <span className="font-bold">±{Math.round(s.avgCents)}¢</span>
                                            </span>
                                            <span className="text-white/40">
                                                苦手度 <span className="font-bold text-orange-300">{Math.round(s.badRatio * 100)}%</span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-center justify-center bg-orange-500/20 group-hover:bg-orange-500/40 rounded-lg px-3 py-2 shrink-0 transition-colors">
                                        <Play size={16} className="text-orange-200" />
                                        <span className="text-[9px] text-orange-200 font-bold mt-0.5">練習</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
