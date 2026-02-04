
export interface ScoreFrame {
    time: number;
    userPitch: number;
    guidePitch: number;
    diffCents: number;
    hasVibrato: boolean;
    isStable: boolean;
}

export interface ScoreResult {
    totalScore: number;
    radar: {
        pitch: number;      // 音程正確率
        stability: number;  // 安定性
        expressiveness: number; // 抑揚・表現力（今回はビブラートボーナス等）
        rhythm: number;     // リズム（タイミング）
        technique: number;  // テクニック（ビブラート回数等から算出）
    };
    tendency: number; // 平均ズレ (cent)。正なら#傾向、負ならb傾向
    vibratoCount: number;
    vibratoSec: number;
    notesHit: number;
    notesTotal: number;
    comment: string;
    advice: import('./PerformanceAdvisor').ExpertAdvice[];
    phraseScores: import('./types').PhraseResult[];
    weakNotes: { noteIndex: number; diff: number; count: number }[];
}

import { PerformanceAdvisor } from './PerformanceAdvisor';

// Helper for note names

export class ScoreAnalyzer {
    private frames: ScoreFrame[] = [];
    private vibratoBuffer: { t: number, p: number }[] = [];
    private lastVibratoTime: number = 0;
    private vibratoState: boolean = false;
    private vibratoCount: number = 0;
    private advisor = new PerformanceAdvisor();

    // Config
    private readonly VIBRATO_WINDOW = 0.5; // 0.5s window for detection
    private readonly VIBRATO_DEPTH_MIN = 10; // cents (peak-to-peak)

    constructor() { }

    reset() {
        this.frames = [];
        this.vibratoBuffer = [];
        this.vibratoState = false;
        this.vibratoCount = 0;
    }

    feed(time: number, userPitch: number, guidePitch: number): { isVibrato: boolean } {
        if (userPitch <= 0) {
            this.vibratoBuffer = [];
            this.vibratoState = false;
            return { isVibrato: false };
        }

        // Calculate diff
        let diff = 0;
        if (guidePitch > 0) {
            diff = 1200 * Math.log2(userPitch / guidePitch);
        }

        // Detect Vibrato
        this.vibratoBuffer.push({ t: time, p: userPitch });
        // Keep window
        const now = time;
        this.vibratoBuffer = this.vibratoBuffer.filter(b => now - b.t <= this.VIBRATO_WINDOW);

        let isVibrato = false;
        if (this.vibratoBuffer.length > 5) {
            // Simplified Vibrato Detection: count zero crossings of pitch derivative around mean
            // 1. Calculate linear trend (detrend)
            // 2. Check frequency of oscillation

            // Convert to semi-tones or cents relative to first point for easier math
            const b0 = this.vibratoBuffer[0];
            const values = this.vibratoBuffer.map(b => 1200 * Math.log2(b.p / b0.p));

            // Simple check: Magnitude of oscillation
            const min = Math.min(...values);
            const max = Math.max(...values);
            const depth = max - min;

            if (depth > this.VIBRATO_DEPTH_MIN && depth < 200) { // < 2 semitones
                // Check periodicity (simple zero crossing of mean)
                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                let crossings = 0;
                for (let i = 1; i < values.length; i++) {
                    if ((values[i] - mean) * (values[i - 1] - mean) < 0) crossings++;
                }

                // Frequency ~= crossings / 2 / window parameters
                // If window is 0.5s, 3Hz = 1.5 cycles = 3 crossings
                // 8Hz = 4 cycles = 8 crossings
                if (crossings >= 3 && crossings <= 12) {
                    isVibrato = true;
                }
            }
        }

        // Hysteresis for vibrato state
        if (isVibrato) {
            if (!this.vibratoState) {
                this.vibratoCount++;
            }
            this.vibratoState = true;
            this.lastVibratoTime = now;
        } else {
            // Sustain state for a bit? No, strict.
            if (now - this.lastVibratoTime > 0.2) {
                this.vibratoState = false;
            }
        }

        if (guidePitch > 0) {
            this.frames.push({
                time,
                userPitch,
                guidePitch,
                diffCents: diff,
                hasVibrato: this.vibratoState,
                isStable: Math.abs(diff) < 40 // simple threshold
            });
        }

        return { isVibrato: this.vibratoState };
    }

    summarize(phrases: import('./types').Phrase[] = []): ScoreResult {
        // Calculate phrase scores if not already done in real-time
        this.calculatePhraseScores(phrases);

        const totalFrames = this.frames.length;
        if (totalFrames === 0) {
            return {
                totalScore: 0,
                radar: { pitch: 0, stability: 0, expressiveness: 0, rhythm: 0, technique: 0 },
                tendency: 0,
                vibratoCount: 0,
                vibratoSec: 0,
                notesHit: 0,
                notesTotal: 0,
                comment: "音声が検出されませんでした。",
                advice: [],
                phraseScores: [],
                weakNotes: []
            };
        }

        const validFrames = this.frames.filter(f => f.userPitch > 0 && f.guidePitch > 0);
        const guideActiveFrames = this.frames.filter(f => f.guidePitch > 0).length;

        const pitchScore = this.calculatePitchScore(validFrames);
        const stabilityScore = this.calculateStabilityScore(validFrames);
        const techniqueScore = Math.min(100, this.vibratoCount * 10);

        // Rhythm: Percentage of frames where user sang while guide was active
        const rhythmScore = guideActiveFrames > 0
            ? (validFrames.length / guideActiveFrames) * 100
            : 0;

        const avgDiff = validFrames.reduce((acc, f) => acc + f.diffCents, 0) / (validFrames.length || 1);

        const totalScore = Math.round(
            pitchScore * 0.4 +
            stabilityScore * 0.2 +
            rhythmScore * 0.2 +
            techniqueScore * 0.2
        );

        // Generate Advice
        const advice = this.advisor.analyze(this.frames, this.vibratoCount);

        // Analyze Weak Notes
        const weakNotes = this.analyzeWeakNotes(validFrames);

        return {
            totalScore: Math.min(100, Math.max(0, totalScore)),
            radar: {
                pitch: Math.round(pitchScore),
                stability: Math.round(stabilityScore),
                expressiveness: Math.round(techniqueScore),
                rhythm: Math.round(rhythmScore),
                technique: Math.round(techniqueScore)
            },
            tendency: avgDiff,
            vibratoCount: this.vibratoCount,
            vibratoSec: 0,
            notesHit: 0,
            notesTotal: 0,
            comment: this.getComment(totalScore),
            advice,
            phraseScores: this.phraseScores,
            weakNotes
        };
    }

    private analyzeWeakNotes(frames: ScoreFrame[]): { noteIndex: number; diff: number; count: number }[] {
        const stats: { [key: number]: { sum: number; count: number } } = {};

        frames.forEach(f => {
            if (f.guidePitch <= 0) return;
            // Convert Hz to Note Name
            const midi = Math.round(69 + 12 * Math.log2(f.guidePitch / 440));
            const noteIndex = (midi % 12 + 12) % 12; // 0-11, ensure positive

            if (!stats[noteIndex]) stats[noteIndex] = { sum: 0, count: 0 };
            stats[noteIndex].sum += f.diffCents;
            stats[noteIndex].count++;
        });

        // Convert to array and filter significant deviations
        return Object.entries(stats)
            .map(([idxStr, data]) => ({
                noteIndex: parseInt(idxStr),
                diff: data.sum / data.count,
                count: data.count
            }))
            .filter(item => Math.abs(item.diff) > 15) // Only care if avg deviation is > 15 cents
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)) // Sort by magnitude of error
            .slice(0, 3); // Top 3
    }

    private phraseScores: import('./types').PhraseResult[] = [];

    private calculatePhraseScores(phrases: import('./types').Phrase[]) {
        this.phraseScores = [];
        if (!phrases || phrases.length === 0) return;

        phrases.forEach(phrase => {
            const phraseFrames = this.frames.filter(f => f.time >= phrase.startTime && f.time <= phrase.endTime);
            const valid = phraseFrames.filter(f => f.userPitch > 0 && f.guidePitch > 0);

            if (phraseFrames.length === 0) return;

            let score = 0;
            if (valid.length > 0) {
                const pitchScore = this.calculatePitchScore(valid);
                score = pitchScore;
            }

            let evalText: 'Perfect' | 'Good' | 'Bad' = 'Bad';
            if (score >= 90) evalText = 'Perfect';
            else if (score >= 70) evalText = 'Good';

            this.phraseScores.push({
                phraseId: phrase.id,
                startTime: phrase.startTime,
                score: Math.round(score),
                evaluation: evalText
            });
        });
    }

    private calculatePitchScore(frames: ScoreFrame[]): number {
        if (frames.length === 0) return 0;
        const total = frames.length;
        // Count frames within 50 cents (semitone half)
        const hit = frames.filter(f => Math.abs(f.diffCents) < 50).length;
        return (hit / total) * 100;
    }

    private calculateStabilityScore(frames: ScoreFrame[]): number {
        if (frames.length === 0) return 0;
        const stable = frames.filter(f => f.isStable && !f.hasVibrato).length;
        const nonVibratoFrames = frames.filter(f => !f.hasVibrato).length;
        return nonVibratoFrames > 0 ? (stable / nonVibratoFrames) * 100 : 100;
    }

    private getComment(totalScore: number): string {
        if (totalScore >= 90) return "素晴らしい！プロ級の歌声です。";
        else if (totalScore >= 80) return "とても上手です！安定感があります。";
        else if (totalScore >= 70) return "良い調子です。音程のズレを減らそう。";
        return "もう一息！ガイドをよく聞いてみよう。";
    }
}
