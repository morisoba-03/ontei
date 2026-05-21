import { PitchDetector } from 'pitchy';

export interface PitchResult {
    freq: number;
    conf: number;
}

// Max frames to bridge a dropout — kept at ~200 ms regardless of analysis rate.
// setAnalysisRate() recalculates this when the rate is known.
const HOLD_CONF = 0.55;

export class PitchAnalyzer {
    private detector: PitchDetector<Float32Array> | null = null;
    private inputLength: number = 0;
    private lastStableFreq: number = 0;
    private holdFramesLeft: number = 0;
    private consecutiveSilence = 0;
    private maxHoldFrames = 6; // default: ~200ms at 30 Hz

    // Called by the worker when the analysis rate is known
    setAnalysisRate(hz: number) {
        this.maxHoldFrames = Math.max(3, Math.round(hz * 0.2)); // 200ms at any rate
    }

    reset() {
        this.lastStableFreq = 0;
        this.holdFramesLeft = 0;
        this.consecutiveSilence = 0;
    }

    analyze(buf: Float32Array, sampleRate: number, options: { viterbi?: boolean, guideFreq?: number, minRms?: number } = { viterbi: true }): PitchResult {
        if (!this.detector || this.inputLength !== buf.length) {
            this.inputLength = buf.length;
            this.detector = PitchDetector.forFloat32Array(this.inputLength);
            this.detector.minVolumeDecibels = -60;
        }

        // 1. RMS Gate (silence detection)
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);

        const minRms = options.minRms ?? 0.01;
        if (rms < minRms) {
            this.consecutiveSilence++;
            if (this.consecutiveSilence > 5) {
                // Genuine sustained silence — clear everything
                this.lastStableFreq = 0;
                this.holdFramesLeft = 0;
            } else if (this.holdFramesLeft > 0 && this.lastStableFreq > 0) {
                // Brief dropout — bridge with last known pitch
                this.holdFramesLeft--;
                return { freq: this.lastStableFreq, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }
        this.consecutiveSilence = 0;

        // 2. McLeod Pitch Method via Pitchy
        const [freq, clarity] = this.detector.findPitch(buf, sampleRate);

        // Threshold: 0.45 is slightly more lenient than the previous 0.50.
        // PC clarity is normally 0.85+ so this has zero effect on PC.
        // Mobile benefits from catching more valid frames.
        if (clarity < 0.45 || freq < 60 || freq > 4200) {
            if (this.holdFramesLeft > 0 && this.lastStableFreq > 0) {
                this.holdFramesLeft--;
                return { freq: this.lastStableFreq, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }

        // 3. Guide Bias — octave error correction
        let finalFreq = freq;
        let finalConf = clarity;

        if (options.guideFreq && options.guideFreq > 0) {
            const guide = options.guideFreq;
            const diffSemi = 12 * Math.log2(finalFreq / guide);
            const octaveErr = Math.abs(Math.abs(diffSemi) - 12);
            if (octaveErr < 2.0 && finalConf < 0.98) {
                if (diffSemi > 0) finalFreq /= 2;
                else finalFreq *= 2;
                finalConf = Math.min(1.0, finalConf * 1.2);
            }
        }

        // 4. Temporal stability — smooth small jitter, reject suspicious octave jumps
        if (this.lastStableFreq > 0) {
            const semitones = 12 * Math.log2(finalFreq / this.lastStableFreq);
            if (Math.abs(semitones) < 1.0) {
                finalFreq = this.lastStableFreq * 0.5 + finalFreq * 0.5;
            } else if (Math.abs(Math.abs(semitones) - 12) < 1.0 && finalConf < 0.9) {
                finalFreq = this.lastStableFreq;
            }
        }

        // Good detection — reset hold counter
        this.holdFramesLeft = this.maxHoldFrames;
        this.lastStableFreq = finalFreq;
        return { freq: finalFreq, conf: finalConf };
    }
}
