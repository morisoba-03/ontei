// Built-in preset songs for practice

import type { GhostNote } from './types';

export interface PresetSong {
    id: string;
    name: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    bpm: number;
    notes?: GhostNote[]; // For hardcoded patterns
    midiUrl?: string;    // For external MIDI files
    backingUrl?: string; // Optional backing track (Audio or MIDI)
}

// Helper to create notes
function createNote(midi: number, time: number, duration: number): GhostNote {
    return { midi, time, duration, role: 'call' };
}

// Helper to repeat a pattern to reach target duration (approx 60s)
function repeatPattern(pattern: GhostNote[], loopCount: number, shift: number = 0): GhostNote[] {
    const result: GhostNote[] = [];
    let timeOffset = 0;

    // Calculate pattern duration
    const lastNote = pattern[pattern.length - 1];
    const duration = lastNote.time + lastNote.duration;

    for (let i = 0; i < loopCount; i++) {
        const octaveShift = (i % 2 === 0) ? 0 : shift; // Alternate octave if shift provided

        pattern.forEach(n => {
            result.push({
                ...n,
                time: n.time + timeOffset,
                midi: n.midi + octaveShift
            });
        });
        timeOffset += duration + 0.5; // Add valid rest
    }
    return result;
}

// 1. C Major Scale (Extended)
const baseScale: GhostNote[] = [
    createNote(60, 0, 0.5), createNote(62, 0.5, 0.5), createNote(64, 1, 0.5), createNote(65, 1.5, 0.5),
    createNote(67, 2, 0.5), createNote(69, 2.5, 0.5), createNote(71, 3, 0.5), createNote(72, 3.5, 1),
    createNote(71, 4.5, 0.5), createNote(69, 5, 0.5), createNote(67, 5.5, 0.5), createNote(65, 6, 0.5),
    createNote(64, 6.5, 0.5), createNote(62, 7, 0.5), createNote(60, 7.5, 1)
];
const cMajorScale = repeatPattern(baseScale, 6, 12); // 6 loops, alternate octave up

// 2. C Major Arpeggio (Extended)
const baseArp: GhostNote[] = [
    createNote(60, 0, 0.5), createNote(64, 0.5, 0.5), createNote(67, 1, 0.5), createNote(72, 1.5, 1),
    createNote(67, 2.5, 0.5), createNote(64, 3, 0.5), createNote(60, 3.5, 1)
];
const cMajorArpeggio = repeatPattern(baseArp, 10, 12);

// 3. Intervals (Extended)
const baseIntervals: GhostNote[] = [
    createNote(60, 0, 0.5), createNote(62, 0.5, 0.5), createNote(60, 1, 1), // 2nd
    createNote(60, 2, 0.5), createNote(64, 2.5, 0.5), createNote(60, 3, 1), // 3rd
    createNote(60, 4, 0.5), createNote(65, 4.5, 0.5), createNote(60, 5, 1), // 4th
    createNote(60, 6, 0.5), createNote(67, 6.5, 0.5), createNote(60, 7, 1), // 5th
];
const intervals = repeatPattern(baseIntervals, 5, 0);

// 4. Twinkle Twinkle (Longer)
const baseTwinkle: GhostNote[] = [
    createNote(60, 0, 0.5), createNote(60, 0.5, 0.5), createNote(67, 1, 0.5), createNote(67, 1.5, 0.5),
    createNote(69, 2, 0.5), createNote(69, 2.5, 0.5), createNote(67, 3, 1),
    createNote(65, 4, 0.5), createNote(65, 4.5, 0.5), createNote(64, 5, 0.5), createNote(64, 5.5, 0.5),
    createNote(62, 6, 0.5), createNote(62, 6.5, 0.5), createNote(60, 7, 1)
];
const twinkleTwinkle = repeatPattern(baseTwinkle, 3, 0);

// 5. Chromatic (Longer)
const baseChromatic = Array.from({ length: 13 }, (_, i) => createNote(60 + i, i * 0.4, 0.35));
const chromaticScale = repeatPattern(baseChromatic, 4, 0);

// 6. Pentatonic (Longer)
const basePentatonic: GhostNote[] = [
    createNote(60, 0, 0.5), createNote(62, 0.5, 0.5), createNote(64, 1, 0.5), createNote(67, 1.5, 0.5),
    createNote(69, 2, 0.5), createNote(72, 2.5, 1),
    createNote(69, 3.5, 0.5), createNote(67, 4, 0.5), createNote(64, 4.5, 0.5), createNote(62, 5, 0.5), createNote(60, 5.5, 1)
];
const pentatonicScale = repeatPattern(basePentatonic, 6, 12);


export const presetSongs: PresetSong[] = [
    // Standard Exercises
    { id: 'c-major-scale', name: 'ドレミファソラシド (Long)', description: 'C Major Scale x6', difficulty: 'easy', bpm: 80, notes: cMajorScale },
    { id: 'c-major-arpeggio', name: 'アルペジオ (Long)', description: 'C Major Arpeggio x10', difficulty: 'easy', bpm: 80, notes: cMajorArpeggio },
    { id: 'intervals', name: '音程練習 (Long)', description: 'Intervals x5', difficulty: 'medium', bpm: 70, notes: intervals },
    { id: 'twinkle-twinkle', name: 'きらきら星 (3 Loop)', description: 'Twinkle Twinkle x3', difficulty: 'easy', bpm: 90, notes: twinkleTwinkle },
    { id: 'chromatic', name: '半音階 (Long)', description: 'Chromatic Scale x4', difficulty: 'hard', bpm: 60, notes: chromaticScale },
    { id: 'pentatonic', name: 'ペンタトニック (Long)', description: 'Pentatonic Scale x6', difficulty: 'medium', bpm: 80, notes: pentatonicScale },

    // Ghibli Medley 01
    {
        id: 'ghibli-01-flute1', name: 'ジブリメドレー01 (Flute 1)', description: 'Part 1 / Main Melody', difficulty: 'medium', bpm: 100,
        midiUrl: '/midi/ジブリメドレー-Flute.mid',
        backingUrl: '/midi/ジブリメドレー 伴奏のみ.mid'
    },
    {
        id: 'ghibli-01-flute2', name: 'ジブリメドレー01 (Flute 2)', description: 'Part 2 / Harmony', difficulty: 'medium', bpm: 100,
        midiUrl: '/midi/ジブリメドレー-Flute_2.mid',
        backingUrl: '/midi/ジブリメドレー 伴奏のみ.mid'
    },
    {
        id: 'ghibli-01-flute3', name: 'ジブリメドレー01 (Flute 3)', description: 'Part 3 / Low Harmony', difficulty: 'medium', bpm: 100,
        midiUrl: '/midi/ジブリメドレー-Flute_3.mid',
        backingUrl: '/midi/ジブリメドレー 伴奏のみ.mid'
    },

    // Ghibli Medley 02
    {
        id: 'ghibli-02-flute1', name: 'ジブリメドレー02 (Flute 1)', description: 'Part 1 / Main Melody', difficulty: 'hard', bpm: 100, // BPM might need adjustment via MIDI
        midiUrl: '/midi/ジブリメドレー02-Flute_1.mid',
        backingUrl: '/midi/ジブリメドレー02 -伴奏のみ.mid'
    },
    {
        id: 'ghibli-02-flute2', name: 'ジブリメドレー02 (Flute 2)', description: 'Part 2 / Harmony', difficulty: 'hard', bpm: 100,
        midiUrl: '/midi/ジブリメドレー02-Flute_2.mid',
        backingUrl: '/midi/ジブリメドレー02 -伴奏のみ.mid'
    },
    {
        id: 'ghibli-02-flute3', name: 'ジブリメドレー02 (Flute 3)', description: 'Part 3 / Low Harmony', difficulty: 'hard', bpm: 100,
        midiUrl: '/midi/ジブリメドレー02-Flute_3.mid',
        backingUrl: '/midi/ジブリメドレー02 -伴奏のみ.mid'
    },
];
