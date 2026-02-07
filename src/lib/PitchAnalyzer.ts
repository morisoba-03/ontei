import { PitchDetector } from 'pitchy';

export interface PitchResult {
    freq: number;
    conf: number;
}

export class PitchAnalyzer {
    private detector: PitchDetector<Float32Array> | null = null;
    private inputLength: number = 0;
    private lastStableFreq: number = 0;
    private consecutiveSilence = 0;

    // Temporal Smoothing State (Simple Viterbi/Hysteresis)


    constructor() { }

    reset() {
        this.lastStableFreq = 0;
        this.consecutiveSilence = 0;
    }

    analyze(buf: Float32Array, sampleRate: number, options: { viterbi?: boolean, guideFreq?: number, minRms?: number } = { viterbi: true }): PitchResult {
        // Initialize detector if buffer size changes
        if (!this.detector || this.inputLength !== buf.length) {
            this.inputLength = buf.length;
            this.detector = PitchDetector.forFloat32Array(this.inputLength);
            // Default settings for clarity threshold, etc.
            this.detector.minVolumeDecibels = -60; // Lower internal threshold, we handle silence manually
        }

        // 1. RMS Gate (Silence Detection)
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);

        const minRms = options.minRms ?? 0.01; // Default to 0.01 if not set
        if (rms < minRms) {
            this.consecutiveSilence++;
            if (this.consecutiveSilence > 5) {
                this.lastStableFreq = 0;
            }
            return { freq: 0, conf: 0 };
        }
        this.consecutiveSilence = 0;

        // 2. Pitchy (McLeod Pitch Method) Analysis
        const [freq, clarity] = this.detector.findPitch(buf, sampleRate);

        if (clarity < 0.5 || freq < 60 || freq > 4200) {
            // Low confidence or out of range
            return { freq: 0, conf: 0 };
        }

        // 3. Post-Processing & Guide Bias
        let finalFreq = freq;
        let finalConf = clarity;

        // Apply "Guide Bias" (God Mode)
        // If we have a guide freq, and the detected pitch is ~1 octave away, 
        // but robustly detected, we might want to nudge it if it's ambiguous?
        // Actually, let's assume Pitchy is mostly right, but if we are 1 octave off from guide,
        // and clarity is marginal, maybe force guide?
        // Better: Use Guide to resolve Octave Errors if they happen.
        if (options.guideFreq && options.guideFreq > 0) {
            const guide = options.guideFreq;
            const diffSemi = 12 * Math.log2(finalFreq / guide);
            const absDiff = Math.abs(diffSemi);
            const octaveErr = Math.abs(absDiff - 12);

            // If we are exactly one octave away (within 1 semitone)
            // AND clarity isn't super high (e.g. < 0.95), allow correction
            if (octaveErr < 2.0 && finalConf < 0.98) {
                // Correct to guide octave
                if (diffSemi > 0) finalFreq /= 2; // We are high, guide is low
                else finalFreq *= 2; // We are low, guide is high

                // Boost confidence because we matched guide
                finalConf = Math.min(1.0, finalConf * 1.2);
            }
        }

        // 4. Temporal Stability (Simple Smoothing)
        // If jump is small, smooth. If jump is large, check if sustained.
        if (this.lastStableFreq > 0) {
            const semitones = 12 * Math.log2(finalFreq / this.lastStableFreq);
            // If very close, smooth heavily
            if (Math.abs(semitones) < 1.0) {
                const alpha = 0.5;
                finalFreq = this.lastStableFreq * (1 - alpha) + finalFreq * alpha;
            }
            // If octave jump (approx 12), reject unless clarity is very high?
            // User complained about octave errors. 
            // If we jump exactly 12 semitones, it's suspicious.
            else if ((Math.abs(Math.abs(semitones) - 12) < 1.0) && finalConf < 0.9) {
                // Reject jump, stick to old (or maybe return 0?)
                // Better to stick to last frequency decaying confidence?
                // Or just output last stable?
                // Let's stick to last stableFreq for a few frames?
                // For now, simple logic: if clarity is mediocre, stay.
                finalFreq = this.lastStableFreq;
            }
        }

        this.lastStableFreq = finalFreq;
        return { freq: finalFreq, conf: finalConf };
    }
}
