import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, Square, RotateCcw, Music, Music2, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { AudioEngine } from '../lib/AudioEngine';

// ────────────────────────────────────────────────────────────
// 定数・型定義
// ────────────────────────────────────────────────────────────

type ScalePracticeType = 'Major' | 'NaturalMinor' | 'Dorian' | 'Mixolydian' | 'MajorPentatonic' | 'Blues';

const SCALE_NAMES: Record<ScalePracticeType, string> = {
    Major: 'メジャースケール',
    NaturalMinor: 'ナチュラルマイナー',
    Dorian: 'ドリアン',
    Mixolydian: 'ミクソリディアン',
    MajorPentatonic: 'メジャーペンタトニック',
    Blues: 'ブルース',
};

/** 各スケールの構成音インターバル（半音数、ルート除く） */
const SCALE_INTERVALS: Record<ScalePracticeType, number[]> = {
    Major:          [0, 2, 4, 5, 7, 9, 11],
    NaturalMinor:   [0, 2, 3, 5, 7, 8, 10],
    Dorian:         [0, 2, 3, 5, 7, 9, 10],
    Mixolydian:     [0, 2, 4, 5, 7, 9, 10],
    MajorPentatonic:[0, 2, 4, 7, 9],
    Blues:          [0, 3, 5, 6, 7, 10],
};

/** ルート音選択肢（アルファベット） */
const ROOT_ALPHA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** ピッチクラスごとの音名（カタカナ） */
const KATA_NAMES = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];

/** 白鍵のピッチクラス（1オクターブ C=0〜B=11） */
const WHITE_KEY_PC = [0, 2, 4, 5, 7, 9, 11];
/** 黒鍵の「左隣の白鍵インデックス」マッピング（WHITE_KEY_PC内のindex → 黒鍵PC） */
const BLACK_KEY_MAP: { afterWhiteIdx: number; pc: number }[] = [
    { afterWhiteIdx: 0, pc: 1 },  // C# (after C)
    { afterWhiteIdx: 1, pc: 3 },  // D# (after D)
    { afterWhiteIdx: 3, pc: 6 },  // F# (after F)
    { afterWhiteIdx: 4, pc: 8 },  // G# (after G)
    { afterWhiteIdx: 5, pc: 10 }, // A# (after A)
];

// ────────────────────────────────────────────────────────────
// ピアノ鍵盤コンポーネント
// ────────────────────────────────────────────────────────────

interface PianoKeyboardProps {
    scalePCs: Set<number>;
    rootPC: number;
    playingPC: number | null;
    noteNotation: 'alphabet' | 'katakana';
    startOctave: number;
    numOctaves: number;
    onKeyClick: (midi: number) => void;
}

function PianoKeyboard({ scalePCs, rootPC, playingPC, noteNotation, startOctave, numOctaves, onKeyClick }: PianoKeyboardProps) {
    const whiteKeys: { midi: number; pc: number; label: string }[] = [];
    const blackKeys: { midi: number; pc: number; afterGlobalWhiteIdx: number }[] = [];

    const WHITE_LABELS_ALPHA = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const WHITE_LABELS_KATA  = ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'];

    for (let oct = startOctave; oct < startOctave + numOctaves; oct++) {
        const baseWhiteIdx = (oct - startOctave) * 7;
        for (let i = 0; i < 7; i++) {
            const pc = WHITE_KEY_PC[i];
            const midi = 12 * (oct + 1) + pc;
            const label = noteNotation === 'katakana' ? WHITE_LABELS_KATA[i] : WHITE_LABELS_ALPHA[i];
            whiteKeys.push({ midi, pc, label });
        }
        for (const bk of BLACK_KEY_MAP) {
            const midi = 12 * (oct + 1) + bk.pc;
            blackKeys.push({ midi, pc: bk.pc, afterGlobalWhiteIdx: baseWhiteIdx + bk.afterWhiteIdx });
        }
    }

    const totalWhite = whiteKeys.length;

    const whiteKeyColor = (pc: number) => {
        const isPlaying = pc === playingPC;
        const isRoot = pc === rootPC;
        const inScale = scalePCs.has(pc);
        if (isPlaying && isRoot) return 'bg-orange-400';
        if (isPlaying) return 'bg-cyan-400';
        if (isRoot) return 'bg-orange-200 hover:bg-orange-300';
        if (inScale) return 'bg-cyan-100 hover:bg-cyan-200';
        return 'bg-white hover:bg-gray-100';
    };

    const blackKeyColor = (pc: number) => {
        const isPlaying = pc === playingPC;
        const isRoot = pc === rootPC;
        const inScale = scalePCs.has(pc);
        if (isPlaying && isRoot) return 'bg-orange-400';
        if (isPlaying) return 'bg-cyan-400';
        if (isRoot) return 'bg-orange-700 hover:bg-orange-600';
        if (inScale) return 'bg-cyan-700 hover:bg-cyan-600';
        return 'bg-gray-800 hover:bg-gray-700';
    };

    const wPct = 100 / totalWhite; // 白鍵1つの幅（%）

    return (
        <div className="relative select-none" style={{ height: 120 }}>
            {/* 白鍵 */}
            <div className="flex h-full">
                {whiteKeys.map((key, i) => (
                    <button
                        key={i}
                        className={cn(
                            'relative flex-1 border border-gray-400 rounded-b-md cursor-pointer transition-colors flex flex-col justify-end items-center pb-1 focus:outline-none',
                            whiteKeyColor(key.pc)
                        )}
                        style={{ minWidth: 26 }}
                        onClick={() => onKeyClick(key.midi)}
                    >
                        <span className="text-[9px] text-gray-500 font-medium leading-none pointer-events-none">{key.label}</span>
                    </button>
                ))}
            </div>

            {/* 黒鍵 */}
            {blackKeys.map((key, i) => {
                const leftPct = (key.afterGlobalWhiteIdx + 1) * wPct - (wPct * 0.33);
                const widthPct = wPct * 0.60;
                return (
                    <button
                        key={i}
                        className={cn(
                            'absolute top-0 rounded-b-md cursor-pointer transition-colors z-10 focus:outline-none',
                            blackKeyColor(key.pc)
                        )}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, height: '60%' }}
                        onClick={(e) => { e.stopPropagation(); onKeyClick(key.midi); }}
                    />
                );
            })}
        </div>
    );
}

// ────────────────────────────────────────────────────────────
// メインモーダル
// ────────────────────────────────────────────────────────────

interface Props {
    audioEngine: AudioEngine;
    onClose: () => void;
}

export function ScalePracticeModal({ audioEngine, onClose }: Props) {
    // ─── タブ & 共通設定 ───
    const [activeTab, setActiveTab] = useState<'play' | 'keyboard' | 'quiz'>('play');
    const [selectedScale, setSelectedScale] = useState<ScalePracticeType>('Major');
    const [rootNote, setRootNote] = useState('C');
    const [octave, setOctave] = useState(4);

    // ─── 再生設定 ───
    const [direction, setDirection] = useState<'up' | 'down' | 'updown'>('updown');
    const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
    const [isPlaying, setIsPlaying] = useState(false);
    const [playingMidi, setPlayingMidi] = useState<number | null>(null);
    const playTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // ─── クイズ ───
    const [quizScore, setQuizScore] = useState({ correct: 0, total: 0 });
    const [quizMidi, setQuizMidi] = useState<number | null>(null);
    const [quizFeedback, setQuizFeedback] = useState<{ correct: boolean; answered: number } | null>(null);

    // ─── 音名表記（グローバル設定に追従） ───
    const [noteNotation, setNoteNotation] = useState<'alphabet' | 'katakana'>(audioEngine.state.noteNotation);
    useEffect(() => {
        return audioEngine.subscribe(() => setNoteNotation(audioEngine.state.noteNotation));
    }, [audioEngine]);

    // ─── ユーティリティ ───
    const rootPC = ROOT_ALPHA.indexOf(rootNote);

    const getNoteName = useCallback((pc: number) => {
        return noteNotation === 'katakana' ? KATA_NAMES[pc] : ROOT_ALPHA[pc];
    }, [noteNotation]);

    const getScalePCs = useCallback((): Set<number> => {
        const intervals = SCALE_INTERVALS[selectedScale];
        return new Set(intervals.map(i => (rootPC + i) % 12));
    }, [selectedScale, rootPC]);

    const getScaleMidis = useCallback((): number[] => {
        const rootMidi = 12 * (octave + 1) + rootPC;
        return SCALE_INTERVALS[selectedScale].map(i => rootMidi + i);
    }, [selectedScale, rootPC, octave]);

    // ─── 単音再生 ───
    const playNote = useCallback(async (midi: number, duration = 0.45) => {
        await audioEngine.ensureAudio();
        const ctx = audioEngine.audioCtx;
        const masterGain = audioEngine.masterGain;
        if (!ctx || !masterGain) return;

        const when = ctx.currentTime + 0.01;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(0.38, when + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, when + duration - 0.01);
        gain.gain.setValueAtTime(0, when + duration);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(when);
        osc.stop(when + duration + 0.05);
        setTimeout(() => { try { osc.disconnect(); gain.disconnect(); } catch { /* noop */ } }, (duration + 0.15) * 1000);
    }, [audioEngine]);

    // ─── スケール再生 ───
    const stopPlayback = useCallback(() => {
        playTimersRef.current.forEach(clearTimeout);
        playTimersRef.current = [];
        setIsPlaying(false);
        setPlayingMidi(null);
    }, []);

    const startPlayback = useCallback(async () => {
        await audioEngine.ensureAudio();
        const intervals = SCALE_INTERVALS[selectedScale];
        const rootMidi = 12 * (octave + 1) + rootPC;

        // 上行シーケンス（ルート→オクターブ上ルート）
        const asc = [...intervals.map(i => rootMidi + i), rootMidi + 12];
        let sequence: number[];
        if (direction === 'up')   sequence = asc;
        else if (direction === 'down') sequence = [...asc].reverse();
        else sequence = [...asc, ...[...asc].reverse().slice(1)];

        const msPer = speed === 'slow' ? 680 : speed === 'fast' ? 240 : 430;
        const dur = (msPer / 1000) * 0.82;

        setIsPlaying(true);
        const timers: ReturnType<typeof setTimeout>[] = [];

        sequence.forEach((midi, i) => {
            timers.push(
                setTimeout(() => { setPlayingMidi(midi); playNote(midi, dur); }, i * msPer),
                setTimeout(() => {
                    setPlayingMidi(null);
                    if (i === sequence.length - 1) setIsPlaying(false);
                }, i * msPer + msPer * 0.88)
            );
        });

        playTimersRef.current = timers;
    }, [audioEngine, selectedScale, rootPC, octave, direction, speed, playNote]);

    useEffect(() => () => stopPlayback(), [stopPlayback]);

    // ─── クイズ ───
    const startQuiz = useCallback(async () => {
        const notes = getScaleMidis();
        const midi = notes[Math.floor(Math.random() * notes.length)];
        setQuizMidi(midi);
        setQuizFeedback(null);
        await playNote(midi, 1.2);
    }, [getScaleMidis, playNote]);

    const replayQuizNote = useCallback(async () => {
        if (quizMidi !== null) await playNote(quizMidi, 1.2);
    }, [quizMidi, playNote]);

    const answerQuiz = useCallback((degreeIdx: number) => {
        if (quizMidi === null || quizFeedback !== null) return;
        const notes = getScaleMidis();
        const correct = notes.indexOf(quizMidi) === degreeIdx;
        setQuizFeedback({ correct, answered: degreeIdx });
        setQuizScore(s => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    }, [quizMidi, quizFeedback, getScaleMidis]);

    // 鍵盤クリックでクイズ回答
    const answerQuizByMidi = useCallback((clickedMidi: number) => {
        if (quizMidi === null || quizFeedback !== null) return;
        const notes = getScaleMidis();
        const degreeIdx = notes.indexOf(clickedMidi);
        if (degreeIdx === -1) {
            // スケール外の音 → 不正解
            setQuizFeedback({ correct: false, answered: -1 });
            setQuizScore(s => ({ correct: s.correct, total: s.total + 1 }));
        } else {
            const correct = clickedMidi === quizMidi;
            setQuizFeedback({ correct, answered: degreeIdx });
            setQuizScore(s => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
        }
    }, [quizMidi, quizFeedback, getScaleMidis]);

    // ─── 派生値 ───
    const scalePCs = getScalePCs();
    const scaleMidis = getScaleMidis();
    const playingPC = playingMidi !== null ? ((playingMidi % 12) + 12) % 12 : null;
    const intervals = SCALE_INTERVALS[selectedScale];
    const degreeCount = intervals.length; // ルート抜きの音数

    // 度数ラベル（1,2,3...）
    const degreeLabels = intervals.map((_, i) => `${i + 1}`);

    // ─── レンダリング ───
    const tabs = [
        { id: 'play' as const,     icon: <Play size={14} />,       label: '再生' },
        { id: 'keyboard' as const, icon: <Music2 size={14} />,     label: '鍵盤' },
        { id: 'quiz' as const,     icon: <HelpCircle size={14} />, label: 'クイズ' },
    ];

    return (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[88dvh] animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 overflow-hidden text-white">

                {/* ヘッダー */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-zinc-800/60 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="p-1 rounded-md bg-purple-500/20 text-purple-400"><Music size={15} /></span>
                        <span className="font-semibold text-sm">スケール練習</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* 共通設定 */}
                <div className="px-4 py-3 border-b border-white/8 bg-zinc-800/30 shrink-0 space-y-2.5">
                    {/* スケール選択 */}
                    <div>
                        <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">スケール</p>
                        <div className="grid grid-cols-3 gap-1">
                            {(Object.keys(SCALE_NAMES) as ScalePracticeType[]).map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSelectedScale(s)}
                                    className={cn(
                                        'text-xs py-1.5 px-2 rounded-lg transition-colors text-left truncate',
                                        selectedScale === s
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-white/5 text-white/60 hover:bg-white/10'
                                    )}
                                >
                                    {SCALE_NAMES[s]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ルート音・オクターブ */}
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">ルート音</p>
                            <div className="flex flex-wrap gap-1">
                                {ROOT_ALPHA.map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setRootNote(n)}
                                        className={cn(
                                            'text-xs px-2 py-1 rounded-md transition-colors',
                                            rootNote === n
                                                ? 'bg-orange-500 text-white'
                                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        )}
                                    >
                                        {noteNotation === 'katakana' ? KATA_NAMES[ROOT_ALPHA.indexOf(n)] : n}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">オクターブ</p>
                            <div className="flex gap-1">
                                {[3, 4, 5].map(o => (
                                    <button
                                        key={o}
                                        onClick={() => setOctave(o)}
                                        className={cn(
                                            'text-xs w-8 py-1 rounded-md transition-colors',
                                            octave === o
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                        )}
                                    >
                                        {o}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* タブバー */}
                <div className="flex border-b border-white/10 shrink-0 bg-zinc-900">
                    {tabs.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2',
                                activeTab === t.id
                                    ? 'border-purple-500 text-purple-400'
                                    : 'border-transparent text-white/40 hover:text-white/70'
                            )}
                        >
                            {t.icon}
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* タブコンテンツ */}
                <div className="flex-1 overflow-y-auto">

                    {/* ──── 再生タブ ──── */}
                    {activeTab === 'play' && (
                        <div className="p-4 space-y-4">

                            {/* 構成音の表示 */}
                            <div>
                                <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">構成音</p>
                                <div className="flex flex-wrap gap-2">
                                    {scaleMidis.map((midi, i) => {
                                        const pc = ((midi % 12) + 12) % 12;
                                        const isPlaying = midi === playingMidi;
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => playNote(midi, 0.6)}
                                                className={cn(
                                                    'flex flex-col items-center justify-center w-12 h-12 rounded-xl border text-xs font-semibold transition-all',
                                                    isPlaying
                                                        ? 'bg-purple-500 border-purple-400 text-white scale-110'
                                                        : i === 0
                                                            ? 'bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30'
                                                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                                                )}
                                            >
                                                <span className="text-[10px] text-white/40">{i + 1}</span>
                                                <span>{getNoteName(pc)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 方向・速度 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">方向</p>
                                    <div className="flex gap-1">
                                        {(['up', 'down', 'updown'] as const).map(d => (
                                            <button
                                                key={d}
                                                onClick={() => setDirection(d)}
                                                className={cn(
                                                    'flex-1 text-xs py-1.5 rounded-lg transition-colors',
                                                    direction === d ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
                                                )}
                                            >
                                                {d === 'up' ? '↑' : d === 'down' ? '↓' : '↑↓'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5">速さ</p>
                                    <div className="flex gap-1">
                                        {(['slow', 'normal', 'fast'] as const).map(s => (
                                            <button
                                                key={s}
                                                onClick={() => setSpeed(s)}
                                                className={cn(
                                                    'flex-1 text-xs py-1.5 rounded-lg transition-colors',
                                                    speed === s ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
                                                )}
                                            >
                                                {s === 'slow' ? '遅' : s === 'fast' ? '速' : '普'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* 再生ボタン */}
                            <button
                                onClick={isPlaying ? stopPlayback : startPlayback}
                                className={cn(
                                    'w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all',
                                    isPlaying
                                        ? 'bg-red-600/80 hover:bg-red-600 text-white'
                                        : 'bg-purple-600 hover:bg-purple-500 text-white'
                                )}
                            >
                                {isPlaying
                                    ? <><Square size={15} /> 停止</>
                                    : <><Play size={15} /> 再生</>
                                }
                            </button>
                        </div>
                    )}

                    {/* ──── 鍵盤タブ ──── */}
                    {activeTab === 'keyboard' && (
                        <div className="p-4 space-y-4">
                            {/* 凡例 */}
                            <div className="flex items-center gap-4 text-xs text-white/50">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded bg-orange-300 inline-block" />ルート音
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded bg-cyan-200 inline-block" />スケール音
                                </span>
                            </div>

                            {/* 鍵盤（PCは2オクターブ、スマホは1オクターブ） */}
                            <div>
                                {/* スマホ: 1オクターブ */}
                                <div className="block sm:hidden overflow-x-auto pb-2">
                                    <div style={{ minWidth: 280 }}>
                                        <PianoKeyboard
                                            scalePCs={scalePCs}
                                            rootPC={rootPC}
                                            playingPC={playingPC}
                                            noteNotation={noteNotation}
                                            startOctave={octave}
                                            numOctaves={1}
                                            onKeyClick={(midi) => playNote(midi, 0.6)}
                                        />
                                    </div>
                                </div>
                                {/* PC: 2オクターブ */}
                                <div className="hidden sm:block overflow-x-auto pb-2">
                                    <div style={{ minWidth: 400 }}>
                                        <PianoKeyboard
                                            scalePCs={scalePCs}
                                            rootPC={rootPC}
                                            playingPC={playingPC}
                                            noteNotation={noteNotation}
                                            startOctave={octave}
                                            numOctaves={2}
                                            onKeyClick={(midi) => playNote(midi, 0.6)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* 構成音リスト */}
                            <div>
                                <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">構成音（クリックで試聴）</p>
                                <div className="flex flex-wrap gap-2">
                                    {scaleMidis.map((midi, i) => {
                                        const pc = ((midi % 12) + 12) % 12;
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => playNote(midi, 0.6)}
                                                className={cn(
                                                    'flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                                                    i === 0
                                                        ? 'bg-orange-500/20 border-orange-500/40 text-orange-300 hover:bg-orange-500/30'
                                                        : 'bg-cyan-900/30 border-cyan-700/40 text-cyan-300 hover:bg-cyan-900/50'
                                                )}
                                            >
                                                <span className="text-white/30">{i + 1}.</span>
                                                {getNoteName(pc)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 再生ボタン（鍵盤タブでも再生可） */}
                            <button
                                onClick={isPlaying ? stopPlayback : startPlayback}
                                className={cn(
                                    'w-full py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-all',
                                    isPlaying
                                        ? 'bg-red-600/80 hover:bg-red-600 text-white'
                                        : 'bg-purple-600/80 hover:bg-purple-600 text-white'
                                )}
                            >
                                {isPlaying ? <><Square size={13} /> 停止</> : <><Play size={13} /> 順番に再生</>}
                            </button>
                        </div>
                    )}

                    {/* ──── クイズタブ ──── */}
                    {activeTab === 'quiz' && (
                        <div className="p-4 space-y-4">
                            {/* スコア */}
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-white/60">
                                    スコア：
                                    <span className="text-white font-bold ml-1">{quizScore.correct}</span>
                                    <span className="text-white/40"> / {quizScore.total}</span>
                                </p>
                                <button
                                    onClick={() => setQuizScore({ correct: 0, total: 0 })}
                                    className="flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors"
                                >
                                    <RotateCcw size={11} /> リセット
                                </button>
                            </div>

                            {/* 問題エリア */}
                            <div className="bg-white/5 rounded-xl p-4 text-center space-y-3 border border-white/8">
                                <p className="text-xs text-white/40">
                                    {SCALE_NAMES[selectedScale]}（{noteNotation === 'katakana' ? KATA_NAMES[rootPC] : rootNote}）の何番目の音？
                                </p>

                                {quizMidi === null ? (
                                    <p className="text-white/30 text-sm">「出題」を押してください</p>
                                ) : (
                                    <div className="space-y-3">
                                        {/* フィードバック */}
                                        {quizFeedback && (
                                            <div className={cn(
                                                'text-sm font-bold py-2 rounded-lg',
                                                quizFeedback.correct ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
                                            )}>
                                                {quizFeedback.correct ? '✓ 正解！' : '✗ 不正解'}
                                                {!quizFeedback.correct && quizMidi !== null && (() => {
                                                    const correctDeg = getScaleMidis().indexOf(quizMidi) + 1;
                                                    const pc = ((quizMidi % 12) + 12) % 12;
                                                    return <span className="text-white/60 text-xs ml-2">（正解：第{correctDeg}音 {getNoteName(pc)}）</span>;
                                                })()}
                                            </div>
                                        )}

                                        {/* 再聴ボタン */}
                                        <button
                                            onClick={replayQuizNote}
                                            className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors mx-auto"
                                        >
                                            <Play size={11} /> もう一度聴く
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 度数ボタン */}
                            {quizMidi !== null && (
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">第何音？</p>
                                    <div className="grid grid-cols-4 gap-2">
                                        {degreeLabels.map((label, i) => {
                                            const answered = quizFeedback?.answered === i;
                                            const correctIdx = quizMidi !== null ? getScaleMidis().indexOf(quizMidi) : -1;
                                            const isCorrectDeg = i === correctIdx;
                                            let cls = 'bg-white/5 text-white/60 hover:bg-white/10 border-white/10';
                                            if (quizFeedback) {
                                                if (isCorrectDeg) cls = 'bg-green-600/40 border-green-500/50 text-green-300';
                                                else if (answered) cls = 'bg-red-600/40 border-red-500/50 text-red-300';
                                                else cls = 'bg-white/5 text-white/30 border-white/5';
                                            }
                                            return (
                                                <button
                                                    key={i}
                                                    onClick={() => answerQuiz(i)}
                                                    disabled={quizFeedback !== null}
                                                    className={cn(
                                                        'py-3 rounded-xl border text-sm font-semibold transition-colors',
                                                        cls,
                                                        quizFeedback ? 'cursor-default' : 'cursor-pointer'
                                                    )}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* 鍵盤で回答（スマホは1oct、PCは2oct） */}
                            {quizMidi !== null && (
                                <div>
                                    <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2">または鍵盤で回答</p>
                                    <div className="block sm:hidden overflow-x-auto pb-1">
                                        <div style={{ minWidth: 260 }}>
                                            <PianoKeyboard
                                                scalePCs={scalePCs}
                                                rootPC={rootPC}
                                                playingPC={quizFeedback ? (((quizMidi % 12) + 12) % 12) : null}
                                                noteNotation={noteNotation}
                                                startOctave={octave}
                                                numOctaves={1}
                                                onKeyClick={answerQuizByMidi}
                                            />
                                        </div>
                                    </div>
                                    <div className="hidden sm:block overflow-x-auto pb-1">
                                        <div style={{ minWidth: 380 }}>
                                            <PianoKeyboard
                                                scalePCs={scalePCs}
                                                rootPC={rootPC}
                                                playingPC={quizFeedback ? (((quizMidi % 12) + 12) % 12) : null}
                                                noteNotation={noteNotation}
                                                startOctave={octave}
                                                numOctaves={2}
                                                onKeyClick={answerQuizByMidi}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 出題ボタン */}
                            <button
                                onClick={startQuiz}
                                className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                            >
                                <Music size={14} />
                                {quizMidi === null ? '出題する' : '次の問題'}
                            </button>

                            {/* ヒント */}
                            <p className="text-[10px] text-white/25 text-center">
                                ヒント：構成音は「鍵盤」タブで確認できます
                            </p>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
