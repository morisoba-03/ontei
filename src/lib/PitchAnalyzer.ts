import { PitchDetector } from 'pitchy';

export interface PitchResult {
    freq: number;
    conf: number;
}

// オクターブ飛び対策入り実装。
// 元の実装は PitchAnalyzer.legacy.ts として保存してあります。
// 戻したい場合は legacy.ts の中身をこのファイルに丸ごとコピーしてください。

const HOLD_CONF = 0.55;

export class PitchAnalyzer {
    private detector: PitchDetector<Float32Array> | null = null;
    private inputLength: number = 0;
    private lastStableFreq: number = 0;
    private holdFramesLeft: number = 0;
    private consecutiveSilence = 0;
    private maxHoldFrames = 6;

    // 2フレーム確認バッファ：オクターブ飛びと判定された候補値を保持し、
    // 次フレームでも同じ位置に居続けた場合のみ採用する
    private pendingOctaveJumpFreq: number = 0;

    // 直近 raw 周波数の履歴（中央値計算に利用、最大 5）
    private rawHistory: number[] = [];
    private readonly RAW_HISTORY_SIZE = 5;

    setAnalysisRate(hz: number) {
        this.maxHoldFrames = Math.max(3, Math.round(hz * 0.2));
    }

    reset() {
        this.lastStableFreq = 0;
        this.holdFramesLeft = 0;
        this.consecutiveSilence = 0;
        this.pendingOctaveJumpFreq = 0;
        this.rawHistory = [];
    }

    private getMedian(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
                // 長い無音 — 状態を全クリア
                this.lastStableFreq = 0;
                this.holdFramesLeft = 0;
                this.pendingOctaveJumpFreq = 0;
                this.rawHistory = [];
            } else if (this.holdFramesLeft > 0 && this.lastStableFreq > 0) {
                this.holdFramesLeft--;
                return { freq: this.lastStableFreq, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }
        this.consecutiveSilence = 0;

        // 2. McLeod Pitch Method via Pitchy
        const [rawFreq, clarity] = this.detector.findPitch(buf, sampleRate);

        if (clarity < 0.45 || rawFreq < 60 || rawFreq > 4200) {
            if (this.holdFramesLeft > 0 && this.lastStableFreq > 0) {
                this.holdFramesLeft--;
                return { freq: this.lastStableFreq, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }

        let finalFreq = rawFreq;
        let finalConf = clarity;

        // 3a. 履歴中央値ベースのオクターブスナップ
        //     rawFreq, rawFreq*2, rawFreq/2 の3候補のうち、
        //     直近履歴の中央値に最も近いものを採用（履歴3件以上ある時のみ）
        if (this.rawHistory.length >= 3) {
            const median = this.getMedian(this.rawHistory);
            if (median > 0) {
                const candidates: { f: number; factor: number }[] = [
                    { f: rawFreq, factor: 1 },
                    { f: rawFreq * 2, factor: 2 },
                    { f: rawFreq / 2, factor: 0.5 },
                ];
                let best = candidates[0];
                let bestDistSemi = Math.abs(12 * Math.log2(candidates[0].f / median));
                for (let i = 1; i < candidates.length; i++) {
                    const c = candidates[i];
                    if (c.f < 60 || c.f > 4200) continue;
                    const d = Math.abs(12 * Math.log2(c.f / median));
                    if (d < bestDistSemi) {
                        bestDistSemi = d;
                        best = c;
                    }
                }
                // 代替候補が選ばれ、かつ履歴との差が6半音以内（=同じ音域内）の時のみ補正
                if (best.factor !== 1 && bestDistSemi < 6) {
                    finalFreq = best.f;
                }
            }
        }

        // 3b. Guide Bias (既存ロジック — ガイド音とのオクターブ違いを補正)
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

        // 4. Temporal stability — 2フレーム確認方式によるオクターブ跳躍の検証
        if (this.lastStableFreq > 0) {
            const semitones = 12 * Math.log2(finalFreq / this.lastStableFreq);
            if (Math.abs(semitones) < 1.0) {
                // 微小変動 → EMAで平滑化、pending クリア
                finalFreq = this.lastStableFreq * 0.5 + finalFreq * 0.5;
                this.pendingOctaveJumpFreq = 0;
            } else if (Math.abs(Math.abs(semitones) - 12) < 1.5) {
                // 1オクターブ前後の跳躍 — 単一フレームでは信用しない
                if (this.pendingOctaveJumpFreq > 0) {
                    // 前フレームでも同じ跳躍があった → 今フレームも同じ位置なら確定
                    const pendSemi = 12 * Math.log2(finalFreq / this.pendingOctaveJumpFreq);
                    if (Math.abs(pendSemi) < 1.5) {
                        // 2連続で同じ位置に居る → 本物のオクターブジャンプとして採用
                        this.pendingOctaveJumpFreq = 0;
                    } else {
                        // 揺れている → 単発エラーとして拒否、直近値を維持
                        finalFreq = this.lastStableFreq;
                    }
                } else {
                    // 高い信頼度なら即採用、それ以外は次フレーム確認待ち
                    if (finalConf >= 0.95) {
                        // 非常に確信度が高い → 採用
                        this.pendingOctaveJumpFreq = 0;
                    } else {
                        this.pendingOctaveJumpFreq = finalFreq;
                        finalFreq = this.lastStableFreq;
                    }
                }
            } else {
                // オクターブ以外の大きな跳躍 (5度, 6度, 7度等) は本物として受け入れる
                this.pendingOctaveJumpFreq = 0;
            }
        } else {
            this.pendingOctaveJumpFreq = 0;
        }

        // 履歴を更新（rawではなく、補正済みのfinalFreqを記録 — 一貫性のため）
        this.rawHistory.push(finalFreq);
        if (this.rawHistory.length > this.RAW_HISTORY_SIZE) this.rawHistory.shift();

        // Good detection — reset hold counter
        this.holdFramesLeft = this.maxHoldFrames;
        this.lastStableFreq = finalFreq;
        return { freq: finalFreq, conf: finalConf };
    }
}
