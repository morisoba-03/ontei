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
    micRenderMode: 'dot' | 'graph';
    practiceMode: string;
    editTool: 'view' | 'select' | 'pencil' | 'eraser';
    gateThreshold: number;
    guideVolume: number;
    accompVolume: number;
    selectedNote: Note | null;
    bpm: number;
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
    // Loop Practice
    loopEnabled: boolean;
    loopStart: number; // seconds
    loopEnd: number;   // seconds
    // Key Change (Transposition)
    transposeOffset: number; // semitones (-12 to +12)
    lastPhraseResult?: PhraseResult;
    isParticlesEnabled: boolean;
    midiTrackCandidates?: { id: number, name: string, instrument: string, noteCount: number, channel: number }[];
    noteNotation: 'alphabet' | 'katakana';
    metronomeMode: 'off' | 'measure' | 'beat';
}

export type ScaleType = 'Major' | 'NaturalMinor' | 'HarmonicMinor' | 'MelodicMinor' | 'MajorPentatonic' | 'MinorPentatonic' | 'Chromatic';
export type ArpeggioType = 'Major' | 'Minor' | 'Major7' | 'Minor7' | 'Dominant7';
export type ExerciseType = 'LongTone' | 'Thirds' | 'Triad' | 'FiveNote' | 'Octave';

export interface PracticeConfig {
    mode: 'Mix' | 'Scale' | 'Arpeggio' | 'Exercise' | 'Midi';
    allowedScales?: ScaleType[];
    allowedArpeggios?: ArpeggioType[];
    allowedExercises?: ExerciseType[];
    rootNote?: number | 'Random';
    maxPitch?: number; // MIDI note number maximum
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
