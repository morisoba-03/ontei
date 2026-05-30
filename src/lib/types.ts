export interface Note {
    midi: number;
    time: number;
    duration: number;
    _timeSec?: number;
    _durSec?: number;
    ticks?: number;
    durationTicks?: number;
}

export interface Track {
    name: string;
    notes: Note[];
    pitchData?: { time: number, freq: number }[];
    type?: 'midi' | 'audio';
}

export interface PitchPoint {
    time: number;
    visOff: number;
    freq: number;
    conf: number;
    sid?: number;
    dCents?: number;
}

export interface GhostNote {
    midi: number;
    time: number;
    duration: number;
    role: 'call' | 'resp' | 'calib' | string;
    label?: string;
}

export interface ScoreStats {
    total: number;
    bins: {
        count: number;
        sum: number;
        sumAbs: number;
        inTol: number;
        outTol: number;
        sharp: number;
        flat: number;
    }[];
}

export interface Marker {
    id: string; // 'A' through 'Z'
    time: number; // seconds
}

export interface AudioEngineState {
    isPlaying: boolean;
    isPracticing: boolean;
    isCalibrating: boolean;
    isPitchOnlyMode: boolean;
    playbackPosition: number;
    timelineOffsetSec: number;
    verticalZoom: number; // 1.0 = default
    verticalOffset: number; // 0..100
    tempoFactor: number;
    pxPerSec: number;
    guideLineWidth: number;
    showNoteNames: boolean;
    toleranceCents: number;
    currentTracks: Track[];
    melodyTrackIndex: number;
    pitchHistory: PitchPoint[];
    midiGhostNotes: GhostNote[];
    phrases: Phrase[];
    practiceExpectedNotes: GhostNote[] | null;
    micRenderMode: 'dot' | 'graph' | 'segment';
    practiceMode: string;
    editTool: 'view' | 'select' | 'pencil' | 'eraser';
    gateThreshold: number;
    guideVolume: number;
    accompVolume: number;
    selectedNote: Note | null;
    bpm: number;
    baseBpm: number;
    isMonophonic: boolean;
    practiceConfig?: PracticeConfig;
    currentMicPitch?: number;
    currentMicConf?: number;
    isVibrato?: boolean;
    guideOctaveOffset: number;
    scoreResult: import('./ScoreAnalyzer').ScoreResult | null;
    loadingProgress: number | null; // 0-100, or null
    isGuideSoundEnabled: boolean;
    isBackingSoundEnabled: boolean;
    tempoMap?: { time: number, bpm: number }[];
    timeSignatureMap?: { time: number, numerator: number, denominator: number }[];
    currentBpm?: number; // 再生位置に対応する実効BPM（表示用）
    // テンポ・拍子変化を反映した正確な絶対時刻（秒）
    beatTimes?: number[];
    measureTimes?: number[];
    // Loop Practice
    loopEnabled: boolean;
    loopStart: number; // seconds
    loopEnd: number;   // seconds
    // Key Change (Transposition)
    transposeOffset: number; // semitones
    lastPhraseResult?: PhraseResult;
    isParticlesEnabled: boolean;
    midiTrackCandidates?: { id: number, name: string, instrument: string, noteCount: number, channel: number }[];
    midiAvailableTracks?: { id: number, name: string, instrument: string, noteCount: number, channel: number }[];
    loadedMidiFileName?: string;
    selectedMidiTrackId?: number;
    noteNotation: 'alphabet' | 'katakana';
    metronomeMode: 'off' | 'on' | 'rec_only' | 'measure' | 'beat';
    meterColor?: string;
    inputLatency: number; // seconds
    countIn: boolean;
    showPitchDeviation: boolean;
    showTuner: boolean;
    showTolerancePreview: boolean;
    markers: Marker[];
    // 音程判定エンジンのバージョン
    //  'v1' = 従来（ガイドスナップ + EMA平滑 + 多段確認）
    //  'v2' = 厳密（ガイド非依存・無平滑・最小オクターブスパイク保護）
    pitchEngineVersion: 'v1' | 'v2';
    // MIDI読み込み時に口笛で吹きやすい音域へガイドのオクターブを自動調整する（キーは変えない）
    autoOctaveEstimate: boolean;
    // メトロノーム音量（0〜1）と音色
    metronomeVolume: number;
    metronomeTone: 'beep' | 'click' | 'wood';
    // ライブピッチ表示（カーソル/チューナー）の平滑化量（0=生〜0.9=滑らか）。判定・履歴には影響しない
    pitchSmoothing: number;
    // チューナーに音名（例: A5）を表示する
    tunerShowNote: boolean;
    // 基準ピッチ A4 の周波数（既定 440Hz）。ガイド音生成・判定・表示に反映される
    a4Reference: number;
    // 直近の演奏のノート別品質（ヒートマップ）。停止時に集計される
    noteHeatmap?: import('./ScoreAnalyzer').NoteHeat[];
    // ヒートマップ（演奏後のノート色分け）を表示する
    showHeatmap: boolean;
    // 現在の曲のベスト記録のピッチ軌跡（ゴースト）。重ね表示用
    bestGhost?: PitchPoint[];
    // ベスト記録のスコア（バッジ表示用）
    bestGhostScore?: number;
    // ベストゴーストを重ね表示する
    showBestGhost: boolean;
}

export type ScaleType = 'Major' | 'NaturalMinor' | 'HarmonicMinor' | 'MelodicMinor' | 'MajorPentatonic' | 'MinorPentatonic' | 'Chromatic' | 'Dorian' | 'Mixolydian' | 'Blues';
export type ArpeggioType = 'Major' | 'Minor' | 'Major7' | 'Minor7' | 'Dominant7';
export type ExerciseType = 'LongTone' | 'Thirds' | 'Triad' | 'FiveNote' | 'Octave' | 'Glissando';

export interface PracticeConfig {
    mode: 'Mix' | 'Scale' | 'Arpeggio' | 'Exercise' | 'Midi';
    allowedScales?: ScaleType[];
    allowedArpeggios?: ArpeggioType[];
    allowedExercises?: ExerciseType[];
    rootNote?: number | 'Random';
    maxPitch?: number; // MIDI note number maximum
    chromaticMode?: boolean;
    breathEnabled?: boolean;
    articulationType?: 'normal' | 'legato' | 'staccato';
    tempoProgression?: boolean;
    tempoProgressionStep?: number;   // default 5 BPM
    tempoProgressionEvery?: number;  // increment every N blocks, default 2
}

export interface Phrase {
    id: string;
    startTime: number;
    endTime: number;
    notes: GhostNote[];
    score?: number; // 0-100
}

export interface PhraseResult {
    phraseId: string;
    score: number;
    startTime: number;
    evaluation: 'Perfect' | 'Good' | 'Bad';
}
