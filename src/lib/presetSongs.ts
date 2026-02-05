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
    transpose?: number;  // Semitone offset (e.g., -12 for one octave down)
}

export const presetSongs: PresetSong[] = [
    // Ghibli Medley 01
    {
        id: 'ghibli-01-flute1', name: 'ジブリメドレー01 (Flute 1)', description: 'Part 1 / Main Melody', difficulty: 'medium', bpm: 100,
        midiUrl: 'midi/ghibli1-flute1.mid',
        backingUrl: 'midi/ghibli1-backing.mid',
        transpose: -12
    },
    {
        id: 'ghibli-01-flute2', name: 'ジブリメドレー01 (Flute 2)', description: 'Part 2 / Harmony', difficulty: 'medium', bpm: 100,
        midiUrl: 'midi/ghibli1-flute2.mid',
        backingUrl: 'midi/ghibli1-backing.mid',
        transpose: -12
    },
    {
        id: 'ghibli-01-flute3', name: 'ジブリメドレー01 (Flute 3)', description: 'Part 3 / Low Harmony', difficulty: 'medium', bpm: 100,
        midiUrl: 'midi/ghibli1-flute3.mid',
        backingUrl: 'midi/ghibli1-backing.mid',
        transpose: -12
    },

    // Ghibli Medley 02
    {
        id: 'ghibli-02-flute1', name: 'ジブリメドレー02 (Flute 1)', description: 'Part 1 / Main Melody', difficulty: 'hard', bpm: 100, // BPM might need adjustment via MIDI
        midiUrl: 'midi/ghibli2-flute1.mid',
        backingUrl: 'midi/ghibli2-backing.mid',
        transpose: -12
    },
    {
        id: 'ghibli-02-flute2', name: 'ジブリメドレー02 (Flute 2)', description: 'Part 2 / Harmony', difficulty: 'hard', bpm: 100,
        midiUrl: 'midi/ghibli2-flute2.mid',
        backingUrl: 'midi/ghibli2-backing.mid',
        transpose: -12
    },
    {
        id: 'ghibli-02-flute3', name: 'ジブリメドレー02 (Flute 3)', description: 'Part 3 / Low Harmony', difficulty: 'hard', bpm: 100,
        midiUrl: 'midi/ghibli2-flute3.mid',
        backingUrl: 'midi/ghibli2-backing.mid',
        transpose: -12
    },
];
