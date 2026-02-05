import type { AudioEngineState, Note, Track, GhostNote, PracticeConfig } from './types';
import { ScoreAnalyzer } from './ScoreAnalyzer';
import { Midi } from '@tonejs/midi';
import { storage } from './storage';

// Extend Window interface for webkitAudioContext
declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext;
    }
}


import { PitchAnalyzer } from './PitchAnalyzer';
import { Visualizer } from './Visualizer';
import { extractMelodyNotesFromBuffer } from './MelodyExtractor';
import { PracticePatternGenerator } from './PracticePatternGenerator';

export class AudioEngine {
    state: AudioEngineState;
    visualizer: Visualizer | null = null;
    pitchAnalyzer: PitchAnalyzer;
    scoreAnalyzer: import('./ScoreAnalyzer').ScoreAnalyzer;

    // Sampler
    pianoBuffers: Record<string, AudioBuffer> = {};
    pianoLoadPromise: Promise<void> | null = null;

    // Audio Context & Nodes
    audioCtx: AudioContext | null = null;
    micStream: MediaStream | null = null;
    micSource: MediaStreamAudioSourceNode | null = null;
    micAnalyser: AnalyserNode | null = null;
    micData: Float32Array | null = null;

    // Gain Nodes
    masterGain: GainNode | null = null;
    melodyGain: GainNode | null = null;
    accompGain: GainNode | null = null;

    // Playback State
    analysisTimer: number | null = null;
    playbackStartTime: number = 0;
    playbackStartPerf: number = 0;
    reqFrameId: number | null = null;

    // Config
    analysisRate: number = 20;

    // Reactivity
    listeners: (() => void)[] = [];

    // History
    history: Track[][] = [];
    redoStack: Track[][] = [];

    // MIDI Import
    private loadedMidi: Midi | null = null;
    private processedPhrases: Set<string> = new Set();

    // Backing Track
    backingBuffer: AudioBuffer | null = null;
    backingSource: AudioBufferSourceNode | null = null;
    nextGuideNoteIndex: number = 0;

    // Practice Backup
    private originalGhostNotes: GhostNote[] | null = null;
    private backingMidiNotes: GhostNote[] = []; // Stores backing track notes
    private nextBackingNoteIndex: number = 0;

    // Practice
    nextPracticeTime: number = 0;
    nextMetronomeTime: number = 0;
    practiceQueue: GhostNote[] = [];
    nextNoteIndexToSchedule: number = 0;

    subscribe(cb: () => void) {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }

    notify() {
        this.listeners.forEach(cb => cb());
    }

    pushHistory() {
        // Deep clone tracks
        const snapshot = JSON.parse(JSON.stringify(this.state.currentTracks));
        this.history.push(snapshot);
        if (this.history.length > 50) this.history.shift();
        this.redoStack = []; // Clear redo on new action
    }

    undo() {
        if (this.history.length === 0) return;
        const current = JSON.parse(JSON.stringify(this.state.currentTracks));
        this.redoStack.push(current);

        const prev = this.history.pop();
        if (prev) {
            this.state.currentTracks = prev;
            // Restore melody track index if needed? Assuming track structure doesn't change wildly.
            this.draw();
            this.notify();
        }
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const current = JSON.parse(JSON.stringify(this.state.currentTracks));
        this.history.push(current);

        const next = this.redoStack.pop();
        if (next) {
            this.state.currentTracks = next;
            this.draw();
            this.notify();
        }
    }

    constructor() {
        this.pitchAnalyzer = new PitchAnalyzer();
        this.scoreAnalyzer = new ScoreAnalyzer();
        this.state = {
            isPlaying: false,
            isPracticing: false,
            isCalibrating: false,
            isPitchOnlyMode: false,
            playbackPosition: 0,
            timelineOffsetSec: -0.05,
            verticalZoom: 3.0,
            verticalOffset: 60,
            tempoFactor: 1.0,
            pxPerSec: 100,
            guideLineWidth: 4,
            showNoteNames: true,
            toleranceCents: 40,
            currentTracks: [],
            melodyTrackIndex: -1,
            pitchHistory: [],
            midiGhostNotes: [],
            phrases: [],
            practiceExpectedNotes: null,
            micRenderMode: 'graph',
            practiceMode: 'free',
            editTool: 'view',
            gateThreshold: -50,
            guideVolume: 0.8,
            accompVolume: 0.8,
            selectedNote: null,
            bpm: 120,
            isMonophonic: true,
            guideOctaveOffset: 1,
            scoreResult: null,
            loadingProgress: null,
            isGuideSoundEnabled: true,
            isBackingSoundEnabled: true,
            tempoMap: [],
            // Loop Practice
            loopEnabled: false,
            loopStart: 0,
            loopEnd: 0,
            // Key Change
            transposeOffset: 0,
            isParticlesEnabled: true,
            noteNotation: 'alphabet',
            metronomeMode: 'off'
        };
        this.loadSettings();
        // Start loading piano samples immediately
        this.loadPianoSamples();
    }

    async loadPianoSamples() {
        if (!window.AudioContext && !window.webkitAudioContext) return;

        // Wait for user interaction to init context? No, just load buffers.
        // We need a temporary context if main one isn't ready, or just wait.
        // Actually, we can decode without a running context.
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const tempCtx = new Ctx();

        const samples = {
            'C3': 'samples/piano/C3.mp3', // MIDI 48
            'C4': 'samples/piano/C4.mp3', // MIDI 60
            'C5': 'samples/piano/C5.mp3', // MIDI 72
        };

        const promises = Object.entries(samples).map(async ([note, url]) => {
            try {
                const res = await fetch(url);
                const arrayBuffer = await res.arrayBuffer();
                const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                this.pianoBuffers[note] = audioBuffer;
            } catch (e) {
                console.error(`Failed to load sample ${note}`, e);
            }
        });

        await Promise.all(promises);
        console.log('[AudioEngine] Piano samples loaded');
        tempCtx.close();
    }

    setCanvas(canvas: HTMLCanvasElement) {
        this.visualizer = new Visualizer(canvas);
        this.draw();
    }

    setTool(tool: 'view' | 'select' | 'pencil' | 'eraser') {
        this.state.editTool = tool;
        if (tool !== 'view' && (!this.state.currentTracks.length || this.state.melodyTrackIndex === -1)) {
            this.state.currentTracks = [{ name: 'Guide Track', notes: [] }];
            this.state.melodyTrackIndex = 0;
        }
        this.draw();
        this.notify();
    }

    async ensureAudio() {
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) throw new Error('AudioContext not supported');
            this.audioCtx = new Ctx({ latencyHint: 'interactive' });
        }
        if (!this.masterGain && this.audioCtx) {
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.connect(this.audioCtx.destination);
            // Setup other nodes...
            this.melodyGain = this.audioCtx.createGain();
            this.melodyGain.connect(this.masterGain);
        }
        if (this.audioCtx?.state === 'suspended') {
            await this.audioCtx.resume();
        }
    }

    async initMic(deviceId?: string): Promise<boolean> {
        await this.ensureAudio();
        if (!this.audioCtx) return false;

        try {
            if (this.micStream) {
                this.micStream.getTracks().forEach(t => t.stop());
            }

            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    deviceId: deviceId ? { exact: deviceId } : undefined
                }
            };

            this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
            this.micAnalyser = this.audioCtx.createAnalyser();
            this.micAnalyser.fftSize = 2048;
            this.micData = new Float32Array(this.micAnalyser.fftSize);

            // Connect: Source -> Analyser (no output to destination to avoid feedback)
            this.micSource.connect(this.micAnalyser);

            this.startAnalysis();
            return true;
        } catch (e) {
            console.error('initMic failed', e);
            return false;
        }
    }

    startAnalysis() {
        if (this.analysisTimer) clearInterval(this.analysisTimer);
        this.analysisTimer = window.setInterval(() => this.analyze(), 1000 / this.analysisRate);
    }

    analyze() {
        if (!this.micAnalyser || !this.micData || !this.audioCtx) return;
        this.micAnalyser.getFloatTimeDomainData(this.micData as unknown as Float32Array<ArrayBuffer>);

        // Determine Guide Frequency (God Mode Bias)
        let guideFreq = 0;
        // Find ghost note at current time (eff)
        const eff = this.state.playbackPosition + this.state.timelineOffsetSec;
        if (Array.isArray(this.state.midiGhostNotes)) {
            const note = this.state.midiGhostNotes.find(n => eff >= n.time && eff <= n.time + n.duration);
            if (note) {
                // MIDI to Freq (Apply Octave Offset)
                const offset = this.state.guideOctaveOffset * 12;
                guideFreq = 440 * Math.pow(2, (note.midi + offset - 69) / 12);
            }
        }

        const result = this.pitchAnalyzer.analyze(this.micData, this.audioCtx.sampleRate, {
            viterbi: true,
            guideFreq: guideFreq
        });
        const { freq, conf } = result;

        // Update Real-time State (for Cursor)
        this.state.currentMicPitch = freq;
        this.state.currentMicConf = conf;

        // Feed Score Analyzer
        if (this.state.isPlaying) {
            const time = this.state.playbackPosition;
            this.scoreAnalyzer.feed(time, freq, guideFreq);
            // TODO: Visualize vibrato?
        }

        // Update History (Only when playing)
        if (freq > 0 && this.state.isPlaying) {
            const now = this.state.playbackPosition; // Simplification
            const vOff = 0.05; // Fixed for now

            // Overwrite mode: If recording, remove existing pitch data at current time
            if (this.isRecording) {
                const overwriteWindow = 0.1; // 100ms window
                this.state.pitchHistory = this.state.pitchHistory.filter(
                    p => p.time < (now - overwriteWindow) || p.time > (now + overwriteWindow)
                );
            }

            this.state.pitchHistory.push({
                time: now - vOff,
                visOff: vOff,
                freq: freq,
                conf: conf
            });
            if (this.state.pitchHistory.length > 2000) this.state.pitchHistory.shift();
        }

        // Trigger draw if not playing (animation frame handles draw when playing)
        if (!this.state.isPlaying) {
            this.draw();
        }
    }

    // Practice State Methods
    async startPractice(config: PracticeConfig = { mode: 'Mix' }) {
        await this.ensureAudio(); // Ensure context is running

        // 1. Robust Backup Strategy
        // If we are NOT already practicing, the current notes are "The Original Guide".
        // We must back them up before doing anything else.
        if (!this.state.isPracticing) {
            if (this.state.midiGhostNotes.length > 0) {
                console.log("[Practice] Initial Backup: Saved", this.state.midiGhostNotes.length, "guide notes.");
                this.originalGhostNotes = [...this.state.midiGhostNotes];
            } else {
                // Even if empty, ensure we don't carry over stale backup
                this.originalGhostNotes = null;
            }
        } else {
            // If checking switching modes (e.g. Scale -> Midi), we rely on stopPractice() to have restored notes,
            // OR we rely on originalGhostNotes persisting.
            // If we are already practicing, originalGhostNotes should ALREADY be set. Don't overwrite it.
            if (!this.originalGhostNotes && this.state.midiGhostNotes.length > 0 && this.state.practiceConfig?.mode === 'Midi') {
                // Edge case: Maybe we started in Midi mode (so no backup needed/made), and now switching to Random?
                // If so, current notes are the "Original" (MIDI) notes.
                console.log("[Practice] Switching from MIDI practice, backing up notes.");
                this.originalGhostNotes = [...this.state.midiGhostNotes];
            }
        }

        this.stopPractice(); // This will clear notes if we were practicing, or do nothing if not.

        // If we were in Midi mode, stopPractice didn't clear.
        // If we were in Random mode, stopPractice restored original.
        // Now we are clean.

        this.state.isPracticing = true;
        this.state.isPitchOnlyMode = true; // Focus on pitch
        this.state.practiceConfig = config;

        if (!this.audioCtx) {
            console.error("Failed to initialize AudioContext");
            return;
        }

        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }

        // Reset timing
        this.state.playbackPosition = 0;
        this.playbackStartTime = this.audioCtx.currentTime;
        console.log(`[Practice] Started (${config.mode}).`);

        this.state.isPlaying = true; // Enable Auto-play for practice
        this.state.scoreResult = null; // Reset score

        this.nextPracticeTime = 0;
        this.nextMetronomeTime = this.audioCtx.currentTime; // Init metronome
        this.nextNoteIndexToSchedule = 0;

        if (config.mode === 'Midi') {
            // Note: stopPractice() might have restored notes from backup if we switched from Random.
            // If we are starting fresh Midi practice, we might have loaded notes.

            // If midiGhostNotes is empty, check if we have a melody track to fallback
            if (this.state.midiGhostNotes.length === 0 && this.state.melodyTrackIndex !== -1 && this.state.currentTracks[this.state.melodyTrackIndex]) {
                this.state.midiGhostNotes = this.state.currentTracks[this.state.melodyTrackIndex].notes.map(note => ({
                    ...note,
                    role: 'call'
                }));
            }

            if (this.state.midiGhostNotes.length > 0) {
                const lastNote = this.state.midiGhostNotes[this.state.midiGhostNotes.length - 1];
                this.nextPracticeTime = lastNote.time + lastNote.duration;
            } else {
                console.warn("[Practice] MIDI mode selected but no melody track is set.");
                this.stopPractice();
                return;
            }
        } else {
            // For generative modes, we must start with fresh slate (except backup is safe)
            this.state.midiGhostNotes = [];

            // Initial Fill for non-Midi modes
            this.updatePracticeQueue();
        }


        // Start Loop
        if (!this.reqFrameId) {
            this.loop();
        }

        this.notify();
    }

    stopPractice() {
        this.stopPlayback(); // Stop audio/animation loop

        // Only clear/restore if we were actually practicing
        if (this.state.isPracticing) {
            this.state.isPracticing = false;
            this.state.isPitchOnlyMode = false; // Restore visibility of main tracks

            // Clear generated notes if we were in a generative mode (not pure MIDI import)
            if (this.state.practiceConfig?.mode !== 'Midi') {
                if (this.originalGhostNotes) {
                    console.log("[Practice] Restoring", this.originalGhostNotes.length, "original guide notes.");
                    this.state.midiGhostNotes = [...this.originalGhostNotes];
                    this.originalGhostNotes = null;
                } else {
                    console.log("[Practice] No backup notes to restore. Clearing.");
                    this.state.midiGhostNotes = [];
                }
                this.state.scoreResult = null;
            }
        }

        this.backingMidiNotes = []; // Clear backing midi
        this.nextBackingNoteIndex = 0;


        this.practiceQueue = [];
        this.nextNoteIndexToSchedule = 0;
        this.notify();
    }

    updatePracticeQueue() {
        if (!this.state.isPracticing) return;

        // If in MIDI mode, we don't generate random patterns
        if (this.state.practiceConfig?.mode === 'Midi') {
            return;
        }

        const lookahead = 10.0; // keep 10s buffered
        const currentPos = this.state.playbackPosition;

        // Check if we need to generate more
        if (this.nextPracticeTime < currentPos + lookahead) {
            try {
                // Determine start time (don't schedule in past)
                const generationStart = Math.max(currentPos, this.nextPracticeTime);

                const batch = PracticePatternGenerator.generateRandomBatch(
                    generationStart,
                    15, // Generate 15s chunks
                    this.state.bpm || 120, // Use current BPM
                    this.state.practiceConfig // Use stored config
                );

                if (batch.notes.length > 0) {
                    this.state.midiGhostNotes.push(...batch.notes);
                    this.nextPracticeTime = batch.nextStartTime;
                    this.generatePhrases();
                    this.notify();
                } else {
                    // Fallback: If no notes generated (e.g. empty config?), advance time to retry later
                    console.warn("[Practice] No notes generated. Skipping forward.");
                    this.nextPracticeTime += 5.0;
                }
            } catch (e) {
                console.error("[Practice] Error generating patterns:", e);
                this.nextPracticeTime += 5.0; // Advance to avoid stall
            }
        }
    }

    async startPlayback() {
        if (this.state.isPlaying) return; // Prevent multiple loops

        if (!this.audioCtx) return;
        this.ensureAudio();

        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        this.state.isPlaying = true;
        this.state.scoreResult = null; // Clear previous score
        this.scoreAnalyzer.reset();

        this.playbackStartTime = this.audioCtx.currentTime - this.state.playbackPosition;
        this.playbackStartPerf = performance.now();

        // Reset Guide Scheduler
        this.onSeek(this.state.playbackPosition);

        this.loop();
        this.notify();
    }

    stopPlayback() {
        this.state.isPlaying = false;
        if (this.reqFrameId) cancelAnimationFrame(this.reqFrameId);
        this.reqFrameId = null;

        if (this.backingSource) {
            try { this.backingSource.stop(); } catch { /* ignore */ }
            this.backingSource = null;
        }

        if (this.scoreAnalyzer) {
            const result = this.scoreAnalyzer.summarize(this.state.phrases);
            this.updateState({
                scoreResult: result
            });
        }
        this.checkPhraseCompletion();
        this.draw();
        this.notify();
    }

    private checkPhraseCompletion() {
        if (!this.state.isPlaying || !this.scoreAnalyzer || this.state.phrases.length === 0) return;

        const currentPos = this.state.playbackPosition;
        // Check processing delay buffer (0.1s after end)
        const delay = 0.1;

        for (const phrase of this.state.phrases) {
            if (this.processedPhrases.has(phrase.id)) continue;

            if (currentPos > phrase.endTime + delay) {
                // Phrase finished
                this.processedPhrases.add(phrase.id);

                // Calculate score for just this phrase
                // Note: summarize overwrites phraseScores but that's fine as we recalc at the end
                const result = this.scoreAnalyzer.summarize([phrase]);
                if (result.phraseScores.length > 0) {
                    const phraseResult = result.phraseScores[0];
                    console.log(`Phrase finished: ${phraseResult.evaluation} (${phraseResult.score})`);
                    this.updateState({ lastPhraseResult: phraseResult });
                }
            }
        }
    }

    syncBackingTrack() {
        // Stop existing
        if (this.backingSource) {
            try { this.backingSource.stop(); } catch { /* ignore */ }
            this.backingSource = null;
        }

        if (!this.state.isPlaying || !this.audioCtx || !this.backingBuffer || !this.state.isBackingSoundEnabled) return;

        const offset = this.state.playbackPosition;
        if (offset < this.backingBuffer.duration) {
            this.backingSource = this.audioCtx.createBufferSource();
            this.backingSource.buffer = this.backingBuffer;
            this.backingSource.connect(this.masterGain!);
            this.backingSource.start(0, offset);
        }
    }

    onSeek(newTime: number) {
        // console.log(`[AudioEngine] onSeek(${newTime})`);

        // Update anchor
        if (this.audioCtx) {
            this.playbackStartTime = this.audioCtx.currentTime - newTime;
            this.nextMetronomeTime = 0; // Force metronome realignment
        }

        // Sync Backing (Audio)
        if (this.state.isPlaying && !this._isSeeking) {
            this.syncBackingTrack();
        }

        // Sync Guide Index
        if (this.state.melodyTrackIndex !== -1 && this.state.currentTracks[this.state.melodyTrackIndex]) {
            const notes = this.state.currentTracks[this.state.melodyTrackIndex].notes;
            let idx = 0;
            while (idx < notes.length && notes[idx].time + notes[idx].duration < newTime) {
                idx++;
            }
            this.nextGuideNoteIndex = idx;
        }

        // Sync Backing MIDI Index
        let bIdx = 0;
        while (bIdx < this.backingMidiNotes.length && this.backingMidiNotes[bIdx].time < newTime) {
            bIdx++;
        }
        this.nextBackingNoteIndex = bIdx;

        // Sync Practice/Ghost Note Index
        let pIdx = 0;
        const pNotes = this.state.midiGhostNotes;
        if (pNotes && pNotes.length > 0) {
            while (pIdx < pNotes.length && pNotes[pIdx].time + pNotes[pIdx].duration < newTime) {
                pIdx++;
            }
        }
        this.nextNoteIndexToSchedule = pIdx;

        // Trim Pitch History (Fix for green line crumbling on rewind)
        // User Request: Preserve pitch history on rewind
        // if (this.state.pitchHistory.length > 0) {
        //     this.state.pitchHistory = this.state.pitchHistory.filter(p => p.time <= newTime);
        // }
    }

    private _isSeeking = false;

    startSeek() {
        if (this._isSeeking) return;
        this._isSeeking = true;
        // Mute during scrub to prevent old audio continuation / glitching
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(0, this.audioCtx?.currentTime || 0);
        }
    }

    endSeek() {
        if (!this._isSeeking) return;
        this._isSeeking = false;

        // Restore volume
        if (this.masterGain) {
            this.masterGain.gain.setValueAtTime(1, this.audioCtx?.currentTime || 0);
        }

        // Force Sync at final position
        if (this.state.isPlaying) {
            this.syncBackingTrack();
        }
    }

    // Persistence
    private loadSettings() {
        try {
            const saved = localStorage.getItem('ontei-settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Validate/Sanitize keys if needed, for now direct merge
                // Only merge known persistent keys to avoid state corruption
                const persistentKeys: (keyof AudioEngineState)[] = [
                    'verticalZoom', 'pxPerSec', 'noteNotation',
                    'tempoFactor', 'guideOctaveOffset', 'transposeOffset',
                    'guideVolume', 'accompVolume', 'gateThreshold', 'toleranceCents',
                    'isParticlesEnabled',
                ];

                const updates: Partial<AudioEngineState> = {};
                persistentKeys.forEach(key => {
                    if (parsed[key] !== undefined) {
                        (updates as Record<string, unknown>)[key] = parsed[key];
                    }
                });

                this.state = { ...this.state, ...updates };
                console.log("[AudioEngine] Settings loaded", updates);
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    private saveSettings() {
        try {
            const persistentKeys: (keyof AudioEngineState)[] = [
                'verticalZoom', 'pxPerSec', 'noteNotation',
                'tempoFactor', 'guideOctaveOffset', 'transposeOffset',
                'guideVolume', 'accompVolume', 'gateThreshold', 'toleranceCents',
                'isParticlesEnabled',
            ];

            const toSave = persistentKeys.reduce((acc, key) => {
                (acc as Record<string, unknown>)[key] = this.state[key];
                return acc;
            }, {} as Record<string, unknown>);

            localStorage.setItem('ontei-settings', JSON.stringify(toSave));
        } catch (e) {
            console.error("Failed to save settings", e);
        }
    }

    updateState(updates: Partial<AudioEngineState>) {

        this.state = { ...this.state, ...updates };

        // Seek detection
        // Seek detection
        if (updates.playbackPosition !== undefined) {
            // Always sync updates from UI (Manual Seek)
            // console.log(`[AudioEngine] Seek: ${oldPos} -> ${updates.playbackPosition}`);
            this.onSeek(updates.playbackPosition);
        }

        // Toggle detection
        if (updates.isBackingSoundEnabled !== undefined) {
            this.syncBackingTrack();
        }

        // Auto-save on relevant changes
        // Simple check: if any persistent key is in updates, trigger save
        const persistentKeys: (keyof AudioEngineState)[] = [
            'verticalZoom', 'pxPerSec', 'noteNotation',
            'tempoFactor', 'guideOctaveOffset', 'transposeOffset',
            'guideVolume', 'accompVolume', 'gateThreshold', 'toleranceCents',
            'isParticlesEnabled',
        ];

        if (Object.keys(updates).some(k => persistentKeys.includes(k as typeof persistentKeys[number]))) {
            this.saveSettings();
        }

        this.draw();
        this.notify();
    }



    loop() {
        if (!this.state.isPlaying) return;

        // Update Position
        if (this.audioCtx) {
            this.state.playbackPosition = this.audioCtx.currentTime - this.playbackStartTime;
        }

        // Loop Practice: Auto-rewind if past loop end
        if (this.state.loopEnabled && this.state.loopEnd > this.state.loopStart) {
            if (this.state.playbackPosition >= this.state.loopEnd) {
                this.state.playbackPosition = this.state.loopStart;
                this.playbackStartTime = this.audioCtx!.currentTime - this.state.loopStart;
                this.onSeek(this.state.loopStart);
                this.syncBackingTrack();
            }
        }

        // Auto-Stop at End of Track
        const endPadding = 1.0; // Seconds to wait after last event
        let maxDuration = 0;

        if (this.backingBuffer) {
            maxDuration = Math.max(maxDuration, this.backingBuffer.duration);
        }

        // Check Guide Track Duration
        if (this.state.melodyTrackIndex !== -1 && this.state.currentTracks[this.state.melodyTrackIndex]) {
            const notes = this.state.currentTracks[this.state.melodyTrackIndex].notes;
            if (notes.length > 0) {
                const lastNote = notes[notes.length - 1];
                maxDuration = Math.max(maxDuration, lastNote.time + lastNote.duration);
            }
        }

        // Check Practice/Ghost Notes Duration
        if (this.state.midiGhostNotes.length > 0) {
            const lastNote = this.state.midiGhostNotes[this.state.midiGhostNotes.length - 1];
            maxDuration = Math.max(maxDuration, lastNote.time + lastNote.duration);
        }

        if (maxDuration > 0 && this.state.playbackPosition > maxDuration + endPadding) {
            console.log("Auto-stopping at end of track");
            this.stopPlayback();
            return;
        }

        // Scheduler
        if (this.state.isPracticing) {
            this.schedulePracticeNotes();
            this.updatePracticeQueue(); // Check if we need more patterns
        }

        if (this.state.isGuideSoundEnabled && (this.state.melodyTrackIndex !== -1 || this.state.midiGhostNotes.length > 0)) {
            this.scheduleGuideNotes();
        }

        if (this.state.isPlaying && this.backingMidiNotes.length > 0) {
            this.scheduleBackingMidiNotes();
        }

        this.scheduleMetronome();

        this.draw();
        this.reqFrameId = requestAnimationFrame(() => this.loop());
    }

    private scheduleMetronome() {
        if (this.state.metronomeMode === 'off' || !this.audioCtx) return;

        // Ensure nextMetronomeTime is valid
        if (this.nextMetronomeTime < this.audioCtx.currentTime - 0.2) {
            this.nextMetronomeTime = this.audioCtx.currentTime + 0.1;
        }

        const beatDuration = 60 / (this.state.bpm || 120);
        const lookahead = 0.5;

        while (this.nextMetronomeTime < this.audioCtx.currentTime + lookahead) {
            // Determine if this beat is start of measure (Beat 0 of 0-3)
            // We use relative time from playback start for grid alignment
            const timeFromStart = this.nextMetronomeTime - this.playbackStartTime;
            // Add slight epsilon for float precision
            const beatIndex = Math.round(timeFromStart / beatDuration);
            const isMeasureStart = beatIndex % 4 === 0;

            let playSound = false;

            if (this.state.metronomeMode === 'on') {
                playSound = true;
            } else if (this.state.metronomeMode === 'rec_only' && (this.isRecording || this.state.isPracticing)) {
                playSound = true;
            }

            if (playSound) {
                this.playClick(this.nextMetronomeTime, isMeasureStart);
            }

            this.nextMetronomeTime += beatDuration;
        }
    }

    private playClick(time: number, isHigh: boolean) {
        if (!this.audioCtx || !this.masterGain) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.frequency.setValueAtTime(isHigh ? 1600 : 1200, time);
        osc.type = 'sine';

        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.3, time + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(time);
        osc.stop(time + 0.1);

        setTimeout(() => {
            osc.disconnect();
            gain.disconnect();
        }, 200);
    }

    scheduleGuideNotes() {
        if (!this.audioCtx) return;

        // Simple scheduling: Look ahead and schedule notes
        const lookahead = 0.1; // 100ms
        const currentTime = this.state.playbackPosition; // app time
        const notes = this.state.melodyTrackIndex !== -1 && this.state.currentTracks[this.state.melodyTrackIndex]
            ? this.state.currentTracks[this.state.melodyTrackIndex].notes
            : [];

        // We need a stable index for playback.
        // For now, simpler: iter from current index
        while (this.nextGuideNoteIndex < notes.length) {
            const note = notes[this.nextGuideNoteIndex];
            if (note.time > currentTime + lookahead) break;

            // Schedule
            // If it's already past, don't schedule unless it's very recent?
            // "when" in audioCtx time
            const when = this.playbackStartTime + note.time;

            if (when >= this.audioCtx.currentTime - 0.05) {
                const offset = this.state.guideOctaveOffset * 12 + this.state.transposeOffset;
                this.scheduleNote(note.midi + offset, when, note.duration);
            }

            this.nextGuideNoteIndex++;
        }
    }

    schedulePracticeNotes() {
        if (!this.audioCtx) return;

        const lookahead = 0.1; // 100ms lookahead
        const currentTime = this.state.playbackPosition;
        const notes = this.state.midiGhostNotes;

        while (this.nextNoteIndexToSchedule < notes.length) {
            const note = notes[this.nextNoteIndexToSchedule];

            // If note is too far in future, stop
            if (note.time > currentTime + lookahead) break;

            // Schedule if it's a 'call' note and hasn't been played
            // (We assume notes are sorted by time, which they should be from generator)
            if (note.role === 'call') {
                // Calculate Exact Audio Time
                // Note Time is relative to playbackStartTime (0 at start)
                // AudioContext Time = playbackStartTime + note.time
                const when = this.playbackStartTime + note.time;

                // Only schedule if it's in the near future (not way in past if we lagged)
                if (when >= this.audioCtx.currentTime - 0.05) {
                    const offset = this.state.guideOctaveOffset * 12;
                    this.scheduleNote(note.midi + offset, when, note.duration);
                }
            }

            this.nextNoteIndexToSchedule++;
        }
    }

    scheduleBackingMidiNotes() {
        if (!this.audioCtx) return;
        const lookahead = 0.1;
        const currentTime = this.state.playbackPosition;

        while (this.nextBackingNoteIndex < this.backingMidiNotes.length) {
            const note = this.backingMidiNotes[this.nextBackingNoteIndex];
            if (note.time > currentTime + lookahead) break;

            const when = this.playbackStartTime + note.time;
            if (when >= this.audioCtx.currentTime - 0.05) {
                // Simple backing sound (lower volume/different tone)
                // Use volumeScale 0.3 for backing
                this.scheduleNote(note.midi, when, Math.min(note.duration, 0.5), false, 0.3);
            }
            this.nextBackingNoteIndex++;
        }
    }

    scheduleNote(midi: number, when: number, duration: number, isResume = false, volumeScale = 1.0) {
        if (!this.audioCtx || !this.masterGain) return;

        // Use Sampler if available
        if (Object.keys(this.pianoBuffers).length > 0) {
            this.playSampledNote(midi, when, duration, isResume, volumeScale);
            return;
        }

        // Fallback to Synth
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Synth Sound
        osc.type = 'triangle'; // Clear tone
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        osc.frequency.value = freq;

        const vol = this.state.guideVolume * volumeScale;

        // Envelope
        if (isResume) {
            gain.gain.setValueAtTime(0, when);
            gain.gain.linearRampToValueAtTime(0.4 * vol, when + 0.05);
        } else {
            gain.gain.setValueAtTime(0, when);
            gain.gain.linearRampToValueAtTime(0.4 * vol, when + 0.01);
        }
        gain.gain.exponentialRampToValueAtTime(0.01, when + duration - 0.01);
        gain.gain.setValueAtTime(0, when + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(when);
        osc.stop(when + duration + 0.1);

        // Cleanup
        setTimeout(() => {
            osc.disconnect();
            gain.disconnect();
        }, (when - this.audioCtx.currentTime + duration + 0.2) * 1000);
    }

    playSampledNote(midi: number, when: number, duration: number, isResume: boolean, volumeScale: number) {
        if (!this.audioCtx || !this.masterGain) return;

        // Find closest sample
        // C3=48, C4=60, C5=72
        const map: { midi: number, buffer: string }[] = [
            { midi: 48, buffer: 'C3' },
            { midi: 60, buffer: 'C4' },
            { midi: 72, buffer: 'C5' }
        ];

        // Simple nearest neighbor search
        let closest = map[0];
        let minDiff = Math.abs(midi - closest.midi);

        for (const m of map) {
            const diff = Math.abs(midi - m.midi);
            if (diff < minDiff) {
                minDiff = diff;
                closest = m;
            }
        }

        const buffer = this.pianoBuffers[closest.buffer];
        if (!buffer) return;

        // Calc Playback Rate
        // If sample is C4 (60) and we want D4 (62), we shift up 2 semitones
        // rate = 2 ^ (semitones / 12)
        const semitones = midi - closest.midi;
        const rate = Math.pow(2, semitones / 12);

        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;

        const gain = this.audioCtx.createGain();
        const vol = this.state.guideVolume * 0.8 * volumeScale; // Normalize volume

        // ADSR Envelope
        const attackTime = isResume ? 0.05 : 0.02;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(vol, when + attackTime); // Fast attack

        // Release/Fadeout
        const releaseTime = 0.1;
        const stopTime = when + duration;

        gain.gain.setValueAtTime(vol, stopTime - releaseTime);
        gain.gain.linearRampToValueAtTime(0, stopTime);

        source.connect(gain);
        gain.connect(this.masterGain);

        source.start(when);
        source.stop(stopTime + 0.1);

        // Cleanup
        setTimeout(() => {
            source.disconnect();
            gain.disconnect();
        }, (stopTime - this.audioCtx.currentTime + 1) * 1000);
    }

    draw() {
        if (this.visualizer) {
            this.visualizer.draw(this.state);
        }
    }

    // Tools
    async loadAudioFile(file: File) {
        // Safety Check
        if (this.state.midiGhostNotes.length > 0) {
            // No confirmation prompt as per request
            this.state.midiGhostNotes = []; // Clear old data silently
            this.state.scoreResult = null;
        }

        this.updateState({ loadingProgress: 0 });
        await this.ensureAudio();
        if (!this.audioCtx) {
            this.updateState({ loadingProgress: null });
            return;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.updateState({ loadingProgress: 10 }); // Read

            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            this.updateState({ loadingProgress: 15 }); // Decoded

            this.backingBuffer = audioBuffer;

            // Auto-extract melody (Progress 15 -> 95)
            // Octave Error Fix: strictOctaveMode true (using raw MPM+SHS)
            const result = await extractMelodyNotesFromBuffer(
                audioBuffer,
                20,
                440,
                true, // strictOctaveMode true
                null,
                (p) => this.updateState({ loadingProgress: p })
            );

            // Set track
            this.state.currentTracks = [{
                name: file.name,
                notes: result.notes,
                pitchData: result.pitchData,
                type: 'audio'
            }];
            this.state.melodyTrackIndex = 0;
            this.state.playbackPosition = 0;

            // Clear existing practice data on new audio load (as requested by workflow)
            this.state.midiGhostNotes = [];
            this.state.scoreResult = null;

        } catch (e) {
            console.error("Load Audio Failed", e);
            alert("音声ファイルの読み込みに失敗しました");
        } finally {
            this.updateState({ loadingProgress: null });
            this.draw();
        }
    }



    // Editing Features
    addNote(note: Note) {
        if (this.state.melodyTrackIndex === -1) return;
        this.pushHistory(); // Save state
        const track = this.state.currentTracks[this.state.melodyTrackIndex];
        // Insert and sort
        track.notes.push(note);
        track.notes.sort((a, b) => a.time - b.time);
        this.draw();
        this.notify();
    }

    removeNote(note: Note) {
        if (this.state.melodyTrackIndex === -1) return;
        this.pushHistory(); // Save state
        const track = this.state.currentTracks[this.state.melodyTrackIndex];
        track.notes = track.notes.filter(n => n !== note);
        this.draw();
        this.notify();
    }

    async previewNote(midi: number) {
        if (!this.audioCtx) await this.ensureAudio();
        if (!this.audioCtx) return;

        // Use Piano Sampler if ready
        if (Object.keys(this.pianoBuffers).length > 0) {
            this.playSampledNote(midi, this.audioCtx.currentTime, 0.5, false, 1.0);
            return;
        }

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        // Piano-ish synthesis (Triangle wave with specific envelope)
        osc.type = 'triangle';
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);

        // Envelope
        const now = this.audioCtx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.5, now + 0.02); // Attack
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5); // Decay

        osc.connect(gain);
        gain.connect(this.masterGain!); // safe use

        osc.start(now);
        osc.stop(now + 0.6);

        // Schedule cleanup
        setTimeout(() => {
            osc.disconnect();
            gain.disconnect();
        }, 600);
    }

    async loadMidiFile(file: File) {
        const arrayBuffer = await file.arrayBuffer();

        // Save to IndexedDB for session restoration
        try {
            await storage.saveMidi(arrayBuffer);
            console.log('[AudioEngine] MIDI saved to storage');
        } catch (e) {
            console.warn('[AudioEngine] Failed to save MIDI to storage', e);
        }

        return this.loadMidiFromBuffer(arrayBuffer);
    }

    loadMidiFromBuffer(arrayBuffer: ArrayBuffer) {
        const midi = new Midi(arrayBuffer);
        this.loadedMidi = midi;

        const candidates = midi.tracks.map((t, i) => ({
            id: i,
            name: t.name,
            instrument: t.instrument.name,
            noteCount: t.notes.length,
            channel: t.channel
        }));

        const playableTracks = candidates.filter(t => t.noteCount > 0);

        this.updateState({ scoreResult: null }); // Reset result

        // Logic Refinement: Check for auto-import match BEFORE showing the selector
        if (candidates.length === 1) {
            this.importMidiTrack(candidates[0].id);
            return candidates;
        }

        if (playableTracks.length === 1) {
            this.importMidiTrack(playableTracks[0].id);
            return candidates;
        }

        // If generic/ambiguous, show selector
        this.updateState({
            midiTrackCandidates: candidates
        });

        return candidates;
    }

    async loadMidiFromUrl(url: string) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch MIDI: ${res.statusText} (${url})`);
            const buffer = await res.arrayBuffer();
            return this.loadMidiFromBuffer(buffer);
        } catch (e) {
            console.error("loadMidiFromUrl failed", e);
            alert(`MIDIファイルの読み込みに失敗しました: ${url}\n${e}`);
            throw e;
        }
    }

    async loadBackingMidiFromUrl(url: string) {
        try {
            console.log(`[AudioEngine] Loading backing MIDI from ${url}`);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch Backing MIDI: ${res.statusText}`);
            const buffer = await res.arrayBuffer();
            const midi = new Midi(buffer);

            // Extract all notes from all tracks
            const allNotes: GhostNote[] = [];
            midi.tracks.forEach(t => {
                t.notes.forEach(n => {
                    allNotes.push({
                        midi: n.midi,
                        time: n.time,
                        duration: n.duration,
                        role: 'call' // Dummy role
                    });
                });
            });
            // Sort
            allNotes.sort((a, b) => a.time - b.time);
            this.backingMidiNotes = allNotes;
            this.nextBackingNoteIndex = 0;
            console.log(`[AudioEngine] Loaded ${allNotes.length} backing notes.`);
        } catch (e) {
            console.error("loadBackingMidiFromUrl failed", e);
            alert(`伴奏MIDIの読み込みに失敗しました: ${url}\n${e}`);
        }
    }

    // Recording
    mediaRecorder: MediaRecorder | null = null;
    recordedChunks: Blob[] = [];
    isRecording: boolean = false;

    async startRecording() {
        if (!this.micStream) {
            await this.initMic();
        }
        if (!this.micStream) {
            console.error("No mic stream available for recording");
            return;
        }

        this.recordedChunks = [];
        // We only record the mic stream, not the system output (to avoid feedback/backing track duplication)
        this.mediaRecorder = new MediaRecorder(this.micStream);

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.start();
        this.isRecording = true;
        this.notify();
    }

    async stopRecording(): Promise<Blob | null> {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                this.recordedChunks = [];
                this.isRecording = false;
                this.notify();
                resolve(blob);
            };

            this.mediaRecorder.stop();
        });
    }

    generatePhrases() {
        const notes = this.state.midiGhostNotes.sort((a, b) => a.time - b.time);
        if (notes.length === 0) return;

        const phrases: import('./types').Phrase[] = [];
        let currentNotes: import('./types').GhostNote[] = [];
        let phraseStartTime = notes[0].time;

        const GAP_THRESHOLD = 1.5; // seconds

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            currentNotes.push(note);

            const nextNote = notes[i + 1];

            // Should split if:
            // 1. Last note
            // 2. Gap to next note is large enough
            const shouldSplit = !nextNote || (nextNote.time - (note.time + note.duration) > GAP_THRESHOLD);

            if (shouldSplit) {
                const phraseEndTime = note.time + note.duration;
                phrases.push({
                    id: crypto.randomUUID(),
                    startTime: phraseStartTime,
                    endTime: phraseEndTime,
                    notes: [...currentNotes],
                });

                currentNotes = [];
                if (nextNote) {
                    phraseStartTime = nextNote.time;
                }
            }
        }

        console.log(`Generated ${phrases.length} phrases`);
        this.updateState({ phrases });
    }

    importMidiTrack(trackIndex: number) {
        if (!this.loadedMidi) return;

        // Safety Check
        // Safety Check Removed
        if (this.state.midiGhostNotes.length > 0) {
            // Just clear silently
            this.state.midiGhostNotes = [];
            this.state.scoreResult = null;
        }

        const track = this.loadedMidi.tracks[trackIndex];
        if (!track) return;

        // Set BPM if available (using first tempo change or initial)
        const tempos = this.loadedMidi.header.tempos.map(t => ({
            time: t.time || 0,
            bpm: t.bpm
        }));

        if (tempos.length > 0) {
            this.state.bpm = Math.round(tempos[0].bpm);
        }
        this.state.tempoMap = tempos;

        const ghostNotes: GhostNote[] = track.notes.map(n => ({
            midi: n.midi,
            time: n.time,
            duration: n.duration,
            role: 'call'
        }));

        this.state.midiGhostNotes = ghostNotes;
        this.state.playbackPosition = 0; // Reset so instructions start from 0
        this.notify();
    }
    // Session Management
    exportSession(): string {
        const session = {
            version: 1,
            timestamp: new Date().toISOString(),
            bpm: this.state.bpm,
            tempoMap: this.state.tempoMap,
            practiceConfig: this.state.practiceConfig,
            ghostNotes: this.state.midiGhostNotes
        };
        return JSON.stringify(session, null, 2);
    }

    async importSession(file: File) {
        // Safety Check
        // If we are currently practicing, ensure we don't lose progress.
        if (this.state.midiGhostNotes.length > 0) {
            // Just clear silently
        }

        const text = await file.text();
        try {
            const session = JSON.parse(text);
            if (session.bpm) this.state.bpm = session.bpm;
            if (session.tempoMap) this.state.tempoMap = session.tempoMap;
            if (session.practiceConfig) this.state.practiceConfig = session.practiceConfig;
            if (session.ghostNotes) {
                this.state.midiGhostNotes = session.ghostNotes;
                // If we have guide notes, we likely want to be in practice mode
                this.state.isPracticing = true;
            }
            this.notify();
            return true;
        } catch (e) {
            console.error("Failed to import session", e);
            return false;
        }
    }

    triggerSessionDownload() {
        const json = this.exportSession();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `practice_session_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    async importBackingFile(file: File) {
        if (!this.audioCtx) await this.ensureAudio();
        if (!this.audioCtx) return;

        try {
            const buffer = await file.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(buffer);
            this.backingBuffer = audioBuffer;
            this.state.isBackingSoundEnabled = true;
            console.log(`[AudioEngine] Loaded Backing Track: ${file.name} (${audioBuffer.duration.toFixed(2)}s)`);
            this.notify();
        } catch (e) {
            console.error("Failed to load backing file:", e);
        }
    }

    // Session Restoration from IndexedDB
    async initFromStorage() {
        try {
            await storage.init();
            const midiData = await storage.loadMidi();
            if (midiData) {
                console.log('[AudioEngine] Restoring MIDI from storage...');
                const candidates = this.loadMidiFromBuffer(midiData);
                // Auto-import first playable track if available
                if (candidates && candidates.length > 0) {
                    const playable = candidates.filter((t: { noteCount: number }) => t.noteCount > 0);
                    if (playable.length === 1) {
                        this.importMidiTrack(playable[0].id);
                    }
                    // If multiple tracks, user will need to select (modal will show)
                }
            }
        } catch (e) {
            console.warn('[AudioEngine] Failed to restore from storage', e);
        }
    }

    // Reset Session
    resetSession(mode: 'all' | 'pitchOnly') {
        this.stopPlayback();
        this.stopPractice();

        if (mode === 'all') {
            // Clear everything
            this.state.currentTracks = [];
            this.state.melodyTrackIndex = -1;
            this.state.midiGhostNotes = [];
            this.state.pitchHistory = [];
            this.state.phrases = [];
            this.state.scoreResult = null;
            this.state.playbackPosition = 0;
            this.backingBuffer = null;
            this.loadedMidi = null;
            this.originalGhostNotes = null;

            // Clear storage
            storage.saveMidi(new ArrayBuffer(0)).catch(() => { });

            console.log('[AudioEngine] Session fully reset');
        } else {
            // Clear only pitch history (green lines)
            this.state.pitchHistory = [];
            this.state.scoreResult = null;
            console.log('[AudioEngine] Pitch history cleared');
        }

        this.draw();
        this.notify();
    }
}

export const audioEngine = new AudioEngine();
(window as unknown as { audioEngine: AudioEngine }).audioEngine = audioEngine;
