import { PitchDetector } from 'pitchy';

export interface PitchResult {
    freq: number;
    conf: number;
}

// オクターブ飛び対策入り実装。
// 元の実装は PitchAnalyzer.legacy.ts として保存してあります。
// 戻したい場合は legacy.ts の中身をこのファイルに丸ごとコピーしてください。

const HOLD_CONF = 0.55;

// オクターブジャンプ確定に必要な連続フレーム数
const OCTAVE_CONFIRM_FRAMES = 3;

export class PitchAnalyzer {
    private detector: PitchDetector<Float32Array> | null = null;
    private inputLength: number = 0;
    private lastStableFreq: number = 0;
    private holdFramesLeft: number = 0;
    private consecutiveSilence = 0;
    private maxHoldFrames = 6;

    // オクターブジャンプ確認バッファ（3フレーム確認方式）
    private pendingOctaveJumpFreq: number = 0;
    private pendingOctaveJumpCount: number = 0;

    // 直近の確定周波数の履歴（中央値計算に利用、最大 7）
    private rawHistory: number[] = [];
    private readonly RAW_HISTORY_SIZE = 7;

    setAnalysisRate(hz: number) {
        this.maxHoldFrames = Math.max(3, Math.round(hz * 0.2));
    }

    reset() {
        this.lastStableFreq = 0;
        this.holdFramesLeft = 0;
        this.consecutiveSilence = 0;
        this.pendingOctaveJumpFreq = 0;
        this.pendingOctaveJumpCount = 0;
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
                this.lastStableFreq = 0;
                this.holdFramesLeft = 0;
                this.pendingOctaveJumpFreq = 0;
                this.pendingOctaveJumpCount = 0;
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
        let guideOctaveCorrected = false;

        // 3a. ガイド音による候補選択（最優先オラクル）
        //     guideFreq がある場合、{f, 2f, f/2} の中からガイドに最も近い候補を選ぶ。
        //     これにより「pitchy がサブオクターブを返す」エラーをガイド音が確実に修正できる。
        if (options.guideFreq && options.guideFreq > 0) {
            const guide = options.guideFreq;
            const cands = [rawFreq, rawFreq * 2, rawFreq / 2].filter(f => f >= 60 && f <= 4200);
            let bestF = cands[0];
            let bestDist = Math.abs(12 * Math.log2(bestF / guide));
            for (let i = 1; i < cands.length; i++) {
                const d = Math.abs(12 * Math.log2(cands[i] / guide));
                if (d < bestDist) { bestDist = d; bestF = cands[i]; }
            }
            // ガイドから 8 半音以内の候補があれば採用
            if (bestDist < 8) {
                if (bestF !== rawFreq) {
                    finalFreq = bestF;
                    finalConf = Math.min(1.0, finalConf * 1.1);
                    guideOctaveCorrected = true; // オクターブ修正発生
                }
                // オクターブ修正なしでもガイド確認済みとしてマーク
                guideOctaveCorrected = guideOctaveCorrected || true;
            }
        }

        // 3b. ガイドなし時の履歴中央値ベースのオクターブスナップ
        //     【重要】±10～14半音（オクターブ圏）は意図的ジャンプと誤検出が区別できないため
        //             この範囲は補正せず Step 4 のフレーム確認に委ねる。
        //             スナップ対象は「小さなズレ（4半音未満）を除く大きな非オクターブズレ」のみ。
        if (!guideOctaveCorrected && this.rawHistory.length >= 5) {
            const median = this.getMedian(this.rawHistory);
            if (median > 0) {
                const rawDistSemi = 12 * Math.log2(rawFreq / median);
                const absRawDist = Math.abs(rawDistSemi);
                // オクターブ圏（9〜15半音）は手を出さない → Step 4 へ
                const isOctaveZone = absRawDist > 9 && absRawDist < 15;
                if (!isOctaveZone && !this.pendingOctaveJumpFreq) {
                    const cands: { f: number; factor: number }[] = [
                        { f: rawFreq, factor: 1 },
                        { f: rawFreq * 2, factor: 2 },
                        { f: rawFreq / 2, factor: 0.5 },
                    ];
                    let best = cands[0];
                    let bestDist = absRawDist;
                    for (let i = 1; i < cands.length; i++) {
                        const c = cands[i];
                        if (c.f < 60 || c.f > 4200) continue;
                        const d = Math.abs(12 * Math.log2(c.f / median));
                        if (d < bestDist) { bestDist = d; best = c; }
                    }
                    // 補正後が median から 2 半音以内かつ rawFreq が 8 半音以上離れている時のみ適用
                    if (best.factor !== 1 && bestDist < 2 && absRawDist > 8) {
                        finalFreq = best.f;
                    }
                }
            }
        }

        // 4. 時間的安定性チェック — オクターブジャンプの確認
        if (this.lastStableFreq > 0) {
            const semitones = 12 * Math.log2(finalFreq / this.lastStableFreq);

            if (Math.abs(semitones) < 1.5) {
                // 微小変動 → EMAで平滑化
                finalFreq = this.lastStableFreq * 0.5 + finalFreq * 0.5;
                this.pendingOctaveJumpFreq = 0;
                this.pendingOctaveJumpCount = 0;

            } else if (Math.abs(Math.abs(semitones) - 12) < 2.0) {
                // オクターブ圏の変化を検出

                if (guideOctaveCorrected) {
                    // ガイドが正しいオクターブを保証している → 即採用し履歴をリセット
                    // （旧オクターブ履歴が次フレームで再スナップするのを防ぐ）
                    this.pendingOctaveJumpFreq = 0;
                    this.pendingOctaveJumpCount = 0;
                    this.rawHistory = [];

                } else {
                    // ガイドなし → 3 フレーム連続確認が必要
                    if (this.pendingOctaveJumpFreq > 0) {
                        const pendSemi = 12 * Math.log2(finalFreq / this.pendingOctaveJumpFreq);
                        if (Math.abs(pendSemi) < 2.0) {
                            this.pendingOctaveJumpCount++;
                            if (this.pendingOctaveJumpCount >= OCTAVE_CONFIRM_FRAMES) {
                                // 確定：履歴をリセットして新オクターブで再構築
                                this.pendingOctaveJumpFreq = 0;
                                this.pendingOctaveJumpCount = 0;
                                this.rawHistory = [];
                            } else {
                                // まだ確認中 → 旧値を維持
                                finalFreq = this.lastStableFreq;
                            }
                        } else {
                            // 揺れている → 単発エラーとして拒否
                            finalFreq = this.lastStableFreq;
                            this.pendingOctaveJumpFreq = 0;
                            this.pendingOctaveJumpCount = 0;
                        }
                    } else {
                        // 初回検出 → pending 開始
                        this.pendingOctaveJumpFreq = finalFreq;
                        this.pendingOctaveJumpCount = 1;
                        finalFreq = this.lastStableFreq;
                    }
                }

            } else {
                // オクターブ以外の大きな跳躍（5度, 6度 等）→ 本物として即採用
                this.pendingOctaveJumpFreq = 0;
                this.pendingOctaveJumpCount = 0;
            }
        } else {
            this.pendingOctaveJumpFreq = 0;
            this.pendingOctaveJumpCount = 0;
        }

        // 確定値を履歴に追加
        this.rawHistory.push(finalFreq);
        if (this.rawHistory.length > this.RAW_HISTORY_SIZE) this.rawHistory.shift();

        this.holdFramesLeft = this.maxHoldFrames;
        this.lastStableFreq = finalFreq;
        return { freq: finalFreq, conf: finalConf };
    }
}
