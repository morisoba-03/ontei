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

export const presetSongs: PresetSong[] = [];
