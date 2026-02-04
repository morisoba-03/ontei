// Built-in preset songs for practice

import type { GhostNote } from './types';

export interface PresetSong {
    id: string;
    name: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    bpm: number;
    notes: GhostNote[];
}

// Helper to create notes
function createNote(midi: number, time: number, duration: number): GhostNote {
    return { midi, time, duration, role: 'call' };
}

// C Major Scale (ド レ ミ ファ ソ ラ シ ド)
const cMajorScale: GhostNote[] = [
    createNote(60, 0, 0.5),   // C
    createNote(62, 0.5, 0.5), // D
    createNote(64, 1, 0.5),   // E
    createNote(65, 1.5, 0.5), // F
    createNote(67, 2, 0.5),   // G
    createNote(69, 2.5, 0.5), // A
    createNote(71, 3, 0.5),   // B
    createNote(72, 3.5, 1),   // C (high)
    // Descending
    createNote(71, 4.5, 0.5), // B
    createNote(69, 5, 0.5),   // A
    createNote(67, 5.5, 0.5), // G
    createNote(65, 6, 0.5),   // F
    createNote(64, 6.5, 0.5), // E
    createNote(62, 7, 0.5),   // D
    createNote(60, 7.5, 1),   // C
];

// C Major Arpeggio (ド ミ ソ ド)
const cMajorArpeggio: GhostNote[] = [
    createNote(60, 0, 0.5),   // C
    createNote(64, 0.5, 0.5), // E
    createNote(67, 1, 0.5),   // G
    createNote(72, 1.5, 1),   // C (high)
    createNote(67, 2.5, 0.5), // G
    createNote(64, 3, 0.5),   // E
    createNote(60, 3.5, 1),   // C
];

// Simple Intervals (2度, 3度, 4度, 5度)
const intervals: GhostNote[] = [
    // 2度
    createNote(60, 0, 0.5),
    createNote(62, 0.5, 0.5),
    createNote(60, 1, 0.5),
    // 3度
    createNote(60, 2, 0.5),
    createNote(64, 2.5, 0.5),
    createNote(60, 3, 0.5),
    // 4度
    createNote(60, 4, 0.5),
    createNote(65, 4.5, 0.5),
    createNote(60, 5, 0.5),
    // 5度
    createNote(60, 6, 0.5),
    createNote(67, 6.5, 0.5),
    createNote(60, 7, 0.5),
    // Octave
    createNote(60, 8, 0.5),
    createNote(72, 8.5, 0.5),
    createNote(60, 9, 1),
];

// Twinkle Twinkle Little Star (きらきら星)
const twinkleTwinkle: GhostNote[] = [
    // Do Do So So La La So~
    createNote(60, 0, 0.5), createNote(60, 0.5, 0.5),
    createNote(67, 1, 0.5), createNote(67, 1.5, 0.5),
    createNote(69, 2, 0.5), createNote(69, 2.5, 0.5),
    createNote(67, 3, 1),
    // Fa Fa Mi Mi Re Re Do~
    createNote(65, 4, 0.5), createNote(65, 4.5, 0.5),
    createNote(64, 5, 0.5), createNote(64, 5.5, 0.5),
    createNote(62, 6, 0.5), createNote(62, 6.5, 0.5),
    createNote(60, 7, 1),
    // So So Fa Fa Mi Mi Re~
    createNote(67, 8, 0.5), createNote(67, 8.5, 0.5),
    createNote(65, 9, 0.5), createNote(65, 9.5, 0.5),
    createNote(64, 10, 0.5), createNote(64, 10.5, 0.5),
    createNote(62, 11, 1),
    // So So Fa Fa Mi Mi Re~
    createNote(67, 12, 0.5), createNote(67, 12.5, 0.5),
    createNote(65, 13, 0.5), createNote(65, 13.5, 0.5),
    createNote(64, 14, 0.5), createNote(64, 14.5, 0.5),
    createNote(62, 15, 1),
];

// Chromatic Scale
const chromaticScale: GhostNote[] = Array.from({ length: 13 }, (_, i) =>
    createNote(60 + i, i * 0.4, 0.35)
);

// Pentatonic Scale (ド レ ミ ソ ラ)
const pentatonicScale: GhostNote[] = [
    createNote(60, 0, 0.5),   // C
    createNote(62, 0.5, 0.5), // D
    createNote(64, 1, 0.5),   // E
    createNote(67, 1.5, 0.5), // G
    createNote(69, 2, 0.5),   // A
    createNote(72, 2.5, 1),   // C
    // Descending
    createNote(69, 3.5, 0.5), // A
    createNote(67, 4, 0.5),   // G
    createNote(64, 4.5, 0.5), // E
    createNote(62, 5, 0.5),   // D
    createNote(60, 5.5, 1),   // C
];

export const presetSongs: PresetSong[] = [
    {
        id: 'c-major-scale',
        name: 'ドレミファソラシド',
        description: 'C Major Scale (音階練習)',
        difficulty: 'easy',
        bpm: 80,
        notes: cMajorScale
    },
    {
        id: 'c-major-arpeggio',
        name: 'ドミソド (アルペジオ)',
        description: 'C Major Arpeggio',
        difficulty: 'easy',
        bpm: 80,
        notes: cMajorArpeggio
    },
    {
        id: 'intervals',
        name: '音程練習',
        description: '2度〜オクターブまで',
        difficulty: 'medium',
        bpm: 70,
        notes: intervals
    },
    {
        id: 'twinkle-twinkle',
        name: 'きらきら星',
        description: 'Twinkle Twinkle Little Star',
        difficulty: 'easy',
        bpm: 90,
        notes: twinkleTwinkle
    },
    {
        id: 'chromatic',
        name: '半音階',
        description: 'Chromatic Scale',
        difficulty: 'hard',
        bpm: 60,
        notes: chromaticScale
    },
    {
        id: 'pentatonic',
        name: 'ペンタトニック',
        description: 'Pentatonic Scale (5音階)',
        difficulty: 'medium',
        bpm: 80,
        notes: pentatonicScale
    }
];
