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
        'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        // スケール練習機能で追加した3種類
        'Dorian': [0, 2, 3, 5, 7, 9, 10, 12],
        'Mixolydian': [0, 2, 4, 5, 7, 9, 10, 12],
        'Blues': [0, 3, 5, 6, 7, 10, 12]
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
        patternType: 'Ascending' | 'Descending' | 'AscDesc' = 'AscDesc',
        options?: PracticeConfig
    ): { notes: GhostNote[], duration: number } {

        const intervals = this.SCALES[type];
        const beatDur = 60 / bpm;
        const noteDur = beatDur / 2; // Eighth notes for scales
        const artMult = options?.articulationType === 'legato' ? 0.99
            : options?.articulationType === 'staccato' ? 0.25
            : 0.90;

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
            duration: noteDur * artMult,
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
        patternType: 'Ascending' | 'Descending' | 'AscDesc' = 'AscDesc',
        options?: PracticeConfig
    ): { notes: GhostNote[], duration: number } {

        const intervals = this.ARPEGGIOS[type];
        const beatDur = 60 / bpm;
        const noteDur = beatDur / 2; // Eighth notes for arpeggios
        const artMult = options?.articulationType === 'legato' ? 0.99
            : options?.articulationType === 'staccato' ? 0.25
            : 0.90;

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
            duration: noteDur * artMult,
            role: 'practice',
            label: this.getNoteName(midi)
        }));

        const totalDur = notes.length * noteDur;

        return { notes, duration: totalDur };
    }

    /**
     * Generates a Glissando exercise (chromatic up 1 octave then down, 16th notes)
     */
    static generateGlissando(
        rootMidi: number,
        bpm: number = 120,
        startTime: number = 0
    ): GhostNote[] {
        const beatDur = 60 / bpm;
        const noteDur = beatDur / 4; // 16th notes
        const artMult = 0.7;

        const seq: number[] = [];
        // Up chromatically 1 octave
        for (let i = 0; i <= 12; i++) seq.push(rootMidi + i);
        // Down chromatically (excluding top note already added)
        for (let i = 11; i >= 0; i--) seq.push(rootMidi + i);

        return seq.map((midi, idx) => ({
            midi,
            time: startTime + idx * noteDur,
            duration: noteDur * artMult,
            role: 'practice',
            label: this.getNoteName(midi)
        }));
    }

    /**
     * Generates Special Exercise Patterns
     */
    static generateExercise(
        rootMidi: number,
        type: import('./types').ExerciseType,
        bpm: number = 120,
        startTime: number = 0,
        options?: PracticeConfig
    ): { notes: GhostNote[], duration: number } {
        const beatDur = 60 / bpm;
        const artMult = options?.articulationType === 'legato' ? 0.99
            : options?.articulationType === 'staccato' ? 0.25
            : 0.90;
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
        } else if (type === 'Glissando') {
            // Handled in generateRandomBatch via generateGlissando
            const noteDur = beatDur / 4; // 16th notes
            for (let i = 0; i <= 12; i++) seq.push({ midi: rootMidi + i, dur: noteDur });
            for (let i = 11; i >= 0; i--) seq.push({ midi: rootMidi + i, dur: noteDur });
        }

        const notes: GhostNote[] = [];
        let timeParams = startTime;

        seq.forEach((item) => {
            notes.push({
                midi: item.midi,
                time: timeParams,
                duration: item.dur * (type === 'Glissando' ? 0.7 : artMult),
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
        options: PracticeConfig = { mode: 'Mix' },
        _unused: undefined = undefined,
        startBlockIndex: number = 0
    ): { notes: GhostNote[], nextStartTime: number, blocksGenerated: number } {

        const notes: GhostNote[] = [];
        let cursor = startTime;
        let timeLeft = durationSec;
        let blockIndex = 0;

        const MIN_MIDI = 72;  // C5
        const MAX_MIDI = options.maxPitch ?? 103; // Default G7 if undefined

        // Safe loop to prevent infinite retry
        const generateSafePattern = (baseCursor: number, chromaticRoot?: number, maxRetries = 20): { notes: GhostNote[], duration: number } | null => {
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

                // Root Calculation
                let root: number;
                if (chromaticRoot !== undefined) {
                    root = chromaticRoot;
                } else {
                    // Ensure root is low enough to fit pattern within MAX_MIDI
                    // Assuming typical pattern range is ~1.5 octaves (approx 19 semitones worst case)
                    const safeHeadroom = 15;
                    const rootMax = Math.max(MIN_MIDI, MAX_MIDI - safeHeadroom);
                    const rootRange = rootMax - MIN_MIDI;
                    root = MIN_MIDI + Math.floor(Math.random() * (rootRange + 1));
                }

                let result: { notes: GhostNote[], duration: number };

                if (isExercise) {
                    const types: import('./types').ExerciseType[] = options.allowedExercises?.length
                        ? options.allowedExercises
                        : ['LongTone', 'FiveNote', 'Triad'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    if (t === 'Glissando') {
                        const glissNotes = this.generateGlissando(root, bpm, baseCursor);
                        const dur = glissNotes.length > 0
                            ? (glissNotes[glissNotes.length - 1].time + (60 / bpm / 4)) - baseCursor
                            : 0;
                        result = { notes: glissNotes, duration: dur };
                    } else {
                        result = this.generateExercise(root, t, bpm, baseCursor, options);
                    }
                } else if (isScale) {
                    const types: ScaleType[] = options.allowedScales?.length
                        ? options.allowedScales
                        : ['Major', 'NaturalMinor', 'MajorPentatonic'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    result = this.generateScale(root, t, bpm, baseCursor, 'AscDesc', options);
                } else {
                    const types: ArpeggioType[] = options.allowedArpeggios?.length
                        ? options.allowedArpeggios
                        : ['Major', 'Minor'];
                    const t = types[Math.floor(Math.random() * types.length)];
                    result = this.generateArpeggio(root, t, bpm, baseCursor, 'AscDesc', options);
                }

                // CHECK RANGE
                const maxNote = Math.max(...result.notes.map(n => n.midi));
                if (maxNote <= MAX_MIDI) {
                    return result;
                }
                // If failed and using chromatic root, break out to avoid infinite loop
                if (chromaticRoot !== undefined) break;
                // Otherwise retry with different random root
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

        const beatDur = 60 / bpm;

        while (timeLeft > 0) {
            // Compute chromatic root if chromatic mode is enabled
            let chromaticRoot: number | undefined;
            if (options.chromaticMode) {
                // Cycle through 12 semitones starting from C5 (MIDI 72)
                chromaticRoot = MIN_MIDI + ((startBlockIndex + blockIndex) % 12);
            }

            const result = generateSafePattern(cursor, chromaticRoot);
            if (!result) {
                cursor += beatDur * 4;
                timeLeft -= beatDur * 4;
                continue;
            }

            // 1. Add Call Notes
            const callNotes = result.notes.map(n => ({ ...n, role: 'call' } as GhostNote));
            notes.push(...callNotes);

            // 2. Beat-aligned phrase duration with minimum gap
            // breathEnabled: 2-beat gap (explicit breath pause); otherwise 1-beat gap
            const callDur = result.duration;
            const gapBeats = options.breathEnabled ? 2 : 1;
            const callPhraseDur = (Math.ceil(callDur / beatDur) + gapBeats) * beatDur;

            // Response starts immediately after the call phrase (no extra breathDur needed)
            const responseStartTime = cursor + callPhraseDur;

            const responseNotes = result.notes.map(n => ({
                ...n,
                time: n.time - cursor + responseStartTime,
                role: 'resp'
            } as GhostNote));
            notes.push(...responseNotes);

            // Symmetric block: response phrase has the same duration as call phrase
            const totalBlockDur = callPhraseDur * 2;

            cursor += totalBlockDur;
            timeLeft = startTime + durationSec - cursor;
            blockIndex++;
        }

        return { notes, nextStartTime: cursor, blocksGenerated: blockIndex };
    }
}
