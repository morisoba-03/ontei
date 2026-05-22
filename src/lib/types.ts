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
