import type { GhostNote, ScaleType, ArpeggioType, PracticeConfig } from './types';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class PracticePatternGenerator {

    static getMidiFromNoteName(note: string, octave: number = 4): number {
        const idx = NOTES.indexOf(note);
        if (idx === -1) return 60;
        return 12 * (octave + 1) + idx;
    }

    static getNoteName(midi: number): string {
        const pc = Math.round(midi) % 12;
        return NOTES[pc];
    }

    // Interval patterns (semitones)
    static SCALES: Record<ScaleType, number[]> = {
        'Major': [0, 2, 4, 5, 7, 9, 11, 12],
        'NaturalMinor': [0, 2, 3, 5, 7, 8, 10, 12],
        'HarmonicMinor': [0, 2, 3, 5, 7, 8, 11, 12],
        'MelodicMinor': [0, 2, 3, 5, 7, 9, 11, 12], // Ascending typically
        'MajorPentatonic': [0, 2, 4, 7, 9, 12],
        'MinorPentatonic': [0, 3, 5, 7, 10, 12],
        'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    };

    static ARPEGGIOS: Record<ArpeggioType, number[]> = {
        'Major': [0, 4, 7, 12],
        'Minor': [0, 3, 7, 12],
        'Major7': [0, 4, 7, 11, 12],
        'Minor7': [0, 3, 7, 10, 12],
        'Dominant7': [0, 4, 7, 10, 12]
    };

    /**
     * Generates a Scale Pattern
     */
    static generateScale(
        rootMidi: number,
        type: ScaleType,
        bpm: number = 120,
        startTime: number = 0,
        patternType: 'Ascending' | 'Descending' | 'AscDesc' = 'AscDesc'
    ): { notes: GhostNote[], duration: number } {

        const intervals = this.SCALES[type];
        const beatDur = 60 / bpm;
        const noteDur = beatDur / 2; // Eighth notes for scales

        const seq: number[] = [];

        if (patternType === 'Ascending' || patternType === 'AscDesc') {
            seq.push(...intervals.map(i => rootMidi + i));
        }

        if (patternType === 'Descending') {
            seq.push(...[...intervals].reverse().map(i => rootMidi + i));
        } else if (patternType === 'AscDesc') {
            const desc = [...intervals].reverse().slice(1).map(i => rootMidi + i);
            seq.push(...desc);
        }

        const notes: GhostNote[] = seq.map((midi, idx) => ({
            midi,
            time: startTime + idx * noteDur,
            duration: noteDur * 0.9,
            role: 'practice',
            label: this.getNoteName(midi)
        }));

        const totalDur = notes.length * noteDur;

        return { notes, duration: totalDur };
    }

    static generateArpeggio(
        rootMidi: number,
        type: ArpeggioType,
        bpm: number = 120,
        startTime: number = 0,
        patternType: 'Ascending' | 'Descending' | 'AscDesc' = 'AscDesc'
    ): { notes: GhostNote[], duration: number } {

        const intervals = this.ARPEGGIOS[type];
        const beatDur = 60 / bpm;
        const noteDur = beatDur / 2; // Eighth notes for arpeggios

        const seq: number[] = [];

        if (patternType === 'Ascending' || patternType === 'AscDesc') {
            seq.push(...intervals.map(i => rootMidi + i));
        }

        if (patternType === 'Descending') {
            seq.push(...[...intervals].reverse().map(i => rootMidi + i));
        } else if (patternType === 'AscDesc') {
            const desc = [...intervals].reverse().slice(1).map(i => rootMidi + i);
            seq.push(...desc);
        }

        const notes: GhostNote[] = seq.map((midi, idx) => ({
            midi,
            time: startTime + idx * noteDur,
            duration: noteDur * 0.95,
            role: 'practice',
            label: this.getNoteName(midi)
        }));

        const totalDur = notes.length * noteDur;

        return { notes, duration: totalDur };
    }

    /**
     * Generates Special Exercise Patterns
     */
    static generateExercise(
        rootMidi: number,
        type: import('./types').ExerciseType,
        bpm: number = 120,
        startTime: number = 0
    ): { notes: GhostNote[], duration: number } {
        const beatDur = 60 / bpm;
        const seq: { midi: number, dur: number }[] = [];

        if (type === 'LongTone') {
            // Sustained note for 4 beats (1 measure)
            seq.push({ midi: rootMidi, dur: beatDur * 4 });
        } else if (type === 'FiveNote') {
            // 1-2-3-4-5-4-3-2-1 (Major) - 9 notes
            // Use Eighth notes to fit? 9 * 0.5 = 4.5 beats.
            // Let's use Eighth notes.
            const noteDur = beatDur / 2;
            const offsets = [0, 2, 4, 5, 7, 5, 4, 2, 0];
            offsets.forEach(o => seq.push({ midi: rootMidi + o, dur: noteDur }));
        } else if (type === 'Triad') {
            // 1-3-5-3-1 (5 notes)
            // Quarter notes? 5 beats -> 1.25 measures.
            // Eighths? 2.5 beats.
            // Let's stick to Quarter for Triad to give time to tune? Or Eighths for agility?
            // "Exercise" implies training. Let's use Quarters for now, but ensure alignment.
            const noteDur = beatDur;
            const offsets = [0, 4, 7, 4, 0];
            offsets.forEach(o => seq.push({ midi: rootMidi + o, dur: noteDur }));
        } else if (type === 'Thirds') {
            // C-E, D-F, E-G -> 6 notes.
            // Quarters -> 6 beats (1.5 measures).
            const noteDur = beatDur;
            const scale = [0, 2, 4, 5, 7, 9, 11, 12];
            const indices = [[0, 2], [1, 3], [2, 4]];
            indices.forEach(pair => {
                seq.push({ midi: rootMidi + scale[pair[0]], dur: noteDur });
                seq.push({ midi: rootMidi + scale[pair[1]], dur: noteDur });
            });
            // Resolve to Root (2 beats)
            seq.push({ midi: rootMidi, dur: noteDur * 2 }); // Total 8 beats (2 measures) - GOOD
        } else if (type === 'Octave') {
            // 1(2beats) - 8(2beats) - 1(4beats) -> Total 8 beats (2 measures) - GOOD
            seq.push({ midi: rootMidi, dur: beatDur * 2 });
            seq.push({ midi: rootMidi + 12, dur: beatDur * 2 });
            seq.push({ midi: rootMidi, dur: beatDur * 4 });
        }

        const notes: GhostNote[] = [];
        let timeParams = startTime;

        seq.forEach((item) => {
            notes.push({
                midi: item.midi,
                time: timeParams,
                duration: item.dur * 0.95,
                role: 'practice',
                label: this.getNoteName(item.midi)
            });
            timeParams += item.dur;
        });

        return { notes, duration: timeParams - startTime };
    }

    /**
     * Generates a random sequence of scales/arpeggios for continuous practice
     */
    static generateRandomBatch(
        startTime: number,
        durationSec: number = 60,
        bpm: number = 120,
        options: PracticeConfig = { mode: 'Mix' }
    ): { notes: GhostNote[], nextStartTime: number } {

        const notes: GhostNote[] = [];
        let cursor = startTime;
        let timeLeft = durationSec;

        const MIN_MIDI = 72;  // C5
        const MAX_MIDI = options.maxPitch ?? 103; // Default G7 if undefined

        // Safe loop to prevent infinite retry
        const generateSafePattern = (baseCursor: number, maxRetries = 20): { notes: GhostNote[], duration: number } | null => {
            for (let i = 0; i < maxRetries; i++) {
                // Determine type
                let isScale = false;
                let isExercise = false;

                if (options.mode === 'Scale') isScale = true;
                else if (options.mode === 'Arpeggio') isScale = false;
                else if (options.mode === 'Exercise') isExercise = true;
                else {
                    const r = Math.random();
                    if (r < 0.4) isScale = true;
                    else if (r < 0.7) isExercise = true;
                    else isScale = false;
                }

                // Random Root Calculation
                // Ensure root is low enough to fit pattern within MAX_MIDI
                // Assuming typical pattern range is ~1.5 octaves (approx 19 semitones worst case)
                const safeHeadroom = 15;
                const rootMax = Math.max(MIN_MIDI, MAX_MIDI - safeHeadroom);
                const rootRange = rootMax - MIN_MIDI;

                const root = MIN_MIDI + Math.floor(Math.random() * (rootRange + 1));

                let result: { notes: GhostNote[], duration: number };

                if (isExercise) {
                    const types: import('./types').ExerciseType[] = options.allowedExercises?.length
                        ? options.allowedExercises
                        : ['LongTone', 'FiveNote', 'Triad'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    result = this.generateExercise(root, t, bpm, baseCursor);
                } else if (isScale) {
                    const types: ScaleType[] = options.allowedScales?.length
                        ? options.allowedScales
                        : ['Major', 'NaturalMinor', 'MajorPentatonic'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    result = this.generateScale(root, t, bpm, baseCursor, 'AscDesc');
                } else {
                    const types: ArpeggioType[] = options.allowedArpeggios?.length
                        ? options.allowedArpeggios
                        : ['Major', 'Minor'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    result = this.generateArpeggio(root, t, bpm, baseCursor, 'AscDesc');
                }

                // CHECK RANGE
                const maxNote = Math.max(...result.notes.map(n => n.midi));
                if (maxNote <= MAX_MIDI) {
                    return result;
                }
                // If failed, loop retry with (likely) specific root
            }

            // Fallback: If random attempts fail, generate a very safe low pattern
            // C4 (60) root is usually safe for almost anything up to C6/G6
            console.warn(`[Generator] Failed to generate pattern within limit ${MAX_MIDI} after ${maxRetries} tries. Using fallback.`);
            const fallbackRoot = 60; // C4

            // Re-generate with safe root
            // ... (Dup code reduced by just calling with forced root? No, we need type)
            // Ideally refactor, but for now just force safe generation:
            const result = this.generateScale(fallbackRoot, 'Major', bpm, baseCursor, 'AscDesc');

            return result;
        };

        while (timeLeft > 0) {
            const beatDur = 60 / bpm;
            const measureDur = beatDur * 4;

            // Align cursor to start of a measure if not already (for safety)
            // But we handle phrase alignment below.

            const result = generateSafePattern(cursor);
            // Result is now guaranteed by fallback
            if (!result) {
                cursor += measureDur; // Should not happen
                timeLeft -= measureDur;
                continue;
            }

            // 1. Add Call Notes
            const callNotes = result.notes.map(n => ({ ...n, role: 'call' } as GhostNote));
            notes.push(...callNotes);

            // 2. Calculate Phrase Alignment
            // We want the Call to occupy discrete measures, then Response to occupy discrete measures.
            // Example: Call is 5 beats. Defines a "Call Phrase" of 2 measures (8 beats).
            const callDur = result.duration;
            const callMeasures = Math.ceil(callDur / measureDur);
            const phraseDur = callMeasures * measureDur; // Duration of the Call Block

            // Response starts after the Call Block
            // Actually, we usually want Call (Measure 1) -> Response (Measure 2).
            // Even if Call is 3 beats, Response starts at Measure 2 Beat 1.
            const responseStartTime = cursor + phraseDur;

            const responseNotes = result.notes.map(n => ({
                ...n,
                time: n.time - cursor + responseStartTime,
                role: 'resp'
            } as GhostNote));
            notes.push(...responseNotes);

            // Total Block Time = PhraseDur (Call) + PhraseDur (Response)
            // e.g. 1 Measure Call + 1 Measure Response = 2 Measures.
            const totalBlockDur = phraseDur * 2;

            cursor += totalBlockDur;
            timeLeft = startTime + durationSec - cursor;
        }

        return { notes, nextStartTime: cursor };
    }
}
