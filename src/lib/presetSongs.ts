// Built-in preset songs for practice

import type { GhostNote, Marker } from './types';

export interface SongSettings {
    guideOctaveOffset?: number;
    transposeOffset?: number;
    toleranceCents?: number;
}

export interface PresetSong {
    id: string;
    name: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    bpm: number;
    notes?: GhostNote[]; // For hardcoded patterns
    midiUrl?: string;    // For external MIDI files
    backingUrl?: string; // Optional backing track (Audio or MIDI)
    transpose?: number;  // Semitone offset
    // A案: MIDI binary stored in IndexedDB as song_midi_${id}
    hasMidiData?: boolean;
    // B案: Per-song settings snapshot
    settings?: SongSettings;
    // C案: Practice history metadata
    createdAt?: number;
    lastPlayed?: number;
    playCount?: number;
    markers?: Marker[];
}

export const presetSongs: PresetSong[] = [];
