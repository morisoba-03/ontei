import { PitchDetector } from 'pitchy';

export interface PitchResult {
    freq: number;
    conf: number;
}

// オクターブ飛び対策入り実装。
// 元の実装は PitchAnalyzer.legacy.ts として保存してあります。

const HOLD_CONF = 0.55;

// オクターブジャンプ確定に必要な連続フレーム数
const OCTAVE_CONFIRM_FRAMES = 3;
// 中規模ジャンプ確定に必要な連続フレーム数（誤検出を弾くため）
const LARGE_JUMP_CONFIRM_FRAMES = 2;
// ガイド消滅後も「直近の期待周波数」を保持する最大フレーム数（60fps で約 0.25 秒）
const RECENT_GUIDE_MAX_FRAMES = 15;

// v2「厳密モード」: これ以上の急ジャンプ（半音）のみ 1 フレーム確認の対象にする。
// pitchy 由来の瞬間的オクターブ反転（≈12 半音）を弾きつつ、本物の跳躍は 1 フレームで採用。
const V2_JUMP_HOLD_SEMI = 9;

export class PitchAnalyzer {
    private detector: PitchDetector<Float32Array> | null = null;
    private inputLength: number = 0;
    private lastStableFreq: number = 0;
    private holdFramesLeft: number = 0;
    private consecutiveSilence = 0;
    private maxHoldFrames = 6;

    // オクターブジャンプ確認バッファ（3フレーム確認）
    private pendingOctaveJumpFreq: number = 0;
    private pendingOctaveJumpCount: number = 0;

    // 中規模（5〜10半音）非オクターブジャンプ確認バッファ（2フレーム確認）
    private pendingLargeJumpFreq: number = 0;
    private pendingLargeJumpCount: number = 0;

    // 直近の確定周波数の履歴（中央値計算に利用、最大 7）
    private rawHistory: number[] = [];
    private readonly RAW_HISTORY_SIZE = 7;

    // ガイド消滅後の参照フリーズ（オクターブ誤検出を安定化）
    private recentExpectedFreq: number = 0;
    private framesSinceGuide: number = 999;

    // v2「厳密モード」専用ステート
    private v2Last: number = 0;       // 直近に採用した周波数
    private v2PendingCount: number = 0; // 急ジャンプの連続フレーム数

    setAnalysisRate(hz: number) {
        this.maxHoldFrames = Math.max(3, Math.round(hz * 0.2));
    }

    reset() {
        this.lastStableFreq = 0;
        this.holdFramesLeft = 0;
        this.consecutiveSilence = 0;
        this.pendingOctaveJumpFreq = 0;
        this.pendingOctaveJumpCount = 0;
        this.pendingLargeJumpFreq = 0;
        this.pendingLargeJumpCount = 0;
        this.rawHistory = [];
        this.recentExpectedFreq = 0;
        this.framesSinceGuide = 999;
        this.v2Last = 0;
        this.v2PendingCount = 0;
    }

    private getMedian(arr: number[]): number {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    analyze(buf: Float32Array, sampleRate: number, options: { viterbi?: boolean, guideFreq?: number, minRms?: number, version?: 'v1' | 'v2' } = { viterbi: true }): PitchResult {
        return options.version === 'v2'
            ? this.analyzeV2(buf, sampleRate, options)
            : this.analyzeV1(buf, sampleRate, options);
    }

    /**
     * v2「厳密モード」: ガイド非依存・無平滑のパススルー検出。
     * - 通常の音程変化（<9 半音）は McLeod 検出値をそのまま返す（EMA なし → セント値が正確）。
     * - 9 半音以上の急ジャンプは 1 フレームだけ旧値を保持して確認する。
     *   pitchy 由来の瞬間的オクターブ反転（持続しない）はこれで消え、
     *   本物の跳躍は次フレームで採用される（遅延 ≈ 1 フレーム）。
     * - ガイド音は一切使わないため、奏者の本当のオクターブ違いも正直に表示される。
     */
    private analyzeV2(buf: Float32Array, sampleRate: number, options: { minRms?: number }): PitchResult {
        if (!this.detector || this.inputLength !== buf.length) {
            this.inputLength = buf.length;
            this.detector = PitchDetector.forFloat32Array(this.inputLength);
            this.detector.minVolumeDecibels = -60;
        }

        // 1. RMS Gate（無音判定）
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);

        const minRms = options.minRms ?? 0.01;
        if (rms < minRms) {
            this.consecutiveSilence++;
            if (this.consecutiveSilence > 5) {
                this.v2Last = 0;
                this.v2PendingCount = 0;
                this.lastStableFreq = 0;
                this.holdFramesLeft = 0;
            } else if (this.holdFramesLeft > 0 && this.v2Last > 0) {
                this.holdFramesLeft--;
                return { freq: this.v2Last, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }
        this.consecutiveSilence = 0;

        // 2. McLeod Pitch Method
        const [rawFreq, clarity] = this.detector.findPitch(buf, sampleRate);
        if (clarity < 0.45 || rawFreq < 60 || rawFreq > 4200) {
            if (this.holdFramesLeft > 0 && this.v2Last > 0) {
                this.holdFramesLeft--;
                return { freq: this.v2Last, conf: HOLD_CONF };
            }
            return { freq: 0, conf: 0 };
        }

        // 3. 急ジャンプのみ 1 フレーム確認（それ以外は生値をそのまま採用）
        let resolved = rawFreq;
        if (this.v2Last > 0) {
            const jump = Math.abs(12 * Math.log2(rawFreq / this.v2Last));
            if (jump >= V2_JUMP_HOLD_SEMI) {
                this.v2PendingCount++;
                if (this.v2PendingCount >= 2) {
                    // 2 フレーム連続で離れた値 → 本物の跳躍として採用
                    this.v2PendingCount = 0;
                    resolved = rawFreq;
                } else {
                    // 最初の 1 フレームは旧値を保持（瞬間スパイク除去）
                    resolved = this.v2Last;
                }
            } else {
                this.v2PendingCount = 0;
                resolved = rawFreq;
            }
        }

        this.v2Last = resolved;
        this.lastStableFreq = resolved; // 共有フィールドを整合させておく
        this.holdFramesLeft = this.maxHoldFrames;
        return { freq: resolved, conf: clarity };
    }

    private analyzeV1(buf: Float32Array, sampleRate: number, options: { viterbi?: boolean, guideFreq?: number, minRms?: number } = { viterbi: true }): PitchResult {
        if (!this.detector || this.inputLength !== buf.length) {
            this.inputLength = buf.length;
            this.detector = PitchDetector.forFloat32Array(this.inputLength);
            this.detector.minVolumeDecibels = -60;
        }

        // 0. ガイド参照の更新（消滅後も短時間は保持）
        const isLiveGuide = !!(options.guideFreq && options.guideFreq > 0);
        if (isLiveGuide) {
            this.recentExpectedFreq = options.guideFreq!;
            this.framesSinceGuide = 0;
        } else {
            this.framesSinceGuide++;
            if (this.framesSinceGuide > RECENT_GUIDE_MAX_FRAMES) this.recentExpectedFreq = 0;
        }
        const effectiveGuide = isLiveGuide
            ? options.guideFreq!
            : (this.framesSinceGuide <= RECENT_GUIDE_MAX_FRAMES ? this.recentExpectedFreq : 0);

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
                this.pendingLargeJumpFreq = 0;
                this.pendingLargeJumpCount = 0;
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
        //     {f, 2f, f/2, 4f, f/4} の中からガイドに最も近い候補を選ぶ。
        //     ライブガイド: 8半音以内で採用（音域間ジャンプも対応）
        //     古いガイド (recentExpectedFreq): 2半音以内のみ採用。
        //       これにより「前のノート(ミ)のガイド残留がドの候補選択を汚染する」問題を防ぐ。
        //       純粋なオクターブ誤検出（E4→E5: 距離0）は引き続き補正できる。
        if (effectiveGuide > 0) {
            const cands = [rawFreq, rawFreq * 2, rawFreq / 2, rawFreq * 4, rawFreq / 4]
                .filter(f => f >= 60 && f <= 4200);
            let bestF = cands[0];
            let bestDist = Math.abs(12 * Math.log2(bestF / effectiveGuide));
            for (let i = 1; i < cands.length; i++) {
                const d = Math.abs(12 * Math.log2(cands[i] / effectiveGuide));
                if (d < bestDist) { bestDist = d; bestF = cands[i]; }
            }
            // ライブガイドは 8 半音、古いガイドは 2 半音（純オクターブ誤検出のみ補正）
            const tolerance = isLiveGuide ? 8 : 2;
            if (bestDist < tolerance) {
                if (bestF !== rawFreq) {
                    finalFreq = bestF;
                    finalConf = Math.min(1.0, finalConf * 1.1);
                    guideOctaveCorrected = true;
                }
                guideOctaveCorrected = guideOctaveCorrected || true;
            }
        }

        // 3b. ガイドなし時の履歴中央値ベースのオクターブスナップ
        //     【重要】±10～14半音は意図的ジャンプとの区別がつかないため触らない。
        if (!guideOctaveCorrected && this.rawHistory.length >= 5) {
            const median = this.getMedian(this.rawHistory);
            if (median > 0) {
                const rawDistSemi = 12 * Math.log2(rawFreq / median);
                const absRawDist = Math.abs(rawDistSemi);
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
                    if (best.factor !== 1 && bestDist < 2 && absRawDist > 8) {
                        finalFreq = best.f;
                    }
                }
            }
        }

        // 4. 時間的安定性チェック
        //    - <1.5 半音: EMA で平滑化
        //    - 1.5〜5 半音: 通常の音程変化（即採用）
        //    - 5〜9 半音: 中規模ジャンプ（2フレーム確認、ガイド保証で即採用）
        //    - 9〜15 半音（オクターブ圏）: 3フレーム確認（ガイド保証で即採用）
        //    - 15+ 半音: 大きすぎる跳躍（2フレーム確認、ガイド保証で即採用）
        if (this.lastStableFreq > 0) {
            const semitones = 12 * Math.log2(finalFreq / this.lastStableFreq);
            const absSemi = Math.abs(semitones);
            const octaveError = Math.abs(absSemi - 12);

            const clearAllPending = () => {
                this.pendingOctaveJumpFreq = 0;
                this.pendingOctaveJumpCount = 0;
                this.pendingLargeJumpFreq = 0;
                this.pendingLargeJumpCount = 0;
            };

            if (absSemi < 1.5) {
                // 微小変動 → EMA
                finalFreq = this.lastStableFreq * 0.5 + finalFreq * 0.5;
                clearAllPending();

            } else if (absSemi < 5.0) {
                // 小さな音程変化（通常のメロディ） → 即採用
                clearAllPending();

            } else if (octaveError < 2.0) {
                // オクターブ圏（9〜15 半音）
                if (guideOctaveCorrected) {
                    // ガイドが新オクターブを保証 → 即採用 + 履歴リセット
                    clearAllPending();
                    this.rawHistory = [];
                } else {
                    // 3 フレーム連続確認が必要
                    if (this.pendingOctaveJumpFreq > 0) {
                        const pendSemi = 12 * Math.log2(finalFreq / this.pendingOctaveJumpFreq);
                        if (Math.abs(pendSemi) < 2.0) {
                            this.pendingOctaveJumpCount++;
                            if (this.pendingOctaveJumpCount >= OCTAVE_CONFIRM_FRAMES) {
                                clearAllPending();
                                this.rawHistory = [];
                            } else {
                                finalFreq = this.lastStableFreq;
                            }
                        } else {
                            finalFreq = this.lastStableFreq;
                            clearAllPending();
                        }
                    } else {
                        this.pendingOctaveJumpFreq = finalFreq;
                        this.pendingOctaveJumpCount = 1;
                        finalFreq = this.lastStableFreq;
                    }
                }

            } else {
                // 中規模〜大規模ジャンプ（5〜9 or 15+ 半音）
                if (guideOctaveCorrected) {
                    // ガイドが保証 → 即採用
                    clearAllPending();
                    // 7 半音以上の確定ジャンプは履歴をリセット
                    if (absSemi >= 7) this.rawHistory = [];
                } else {
                    // 2 フレーム連続確認
                    if (this.pendingLargeJumpFreq > 0) {
                        const pendSemi = 12 * Math.log2(finalFreq / this.pendingLargeJumpFreq);
                        if (Math.abs(pendSemi) < 2.0) {
                            this.pendingLargeJumpCount++;
                            if (this.pendingLargeJumpCount >= LARGE_JUMP_CONFIRM_FRAMES) {
                                clearAllPending();
                                if (absSemi >= 7) this.rawHistory = [];
                            } else {
                                finalFreq = this.lastStableFreq;
                            }
                        } else {
                            finalFreq = this.lastStableFreq;
                            clearAllPending();
                        }
                    } else {
                        this.pendingLargeJumpFreq = finalFreq;
                        this.pendingLargeJumpCount = 1;
                        finalFreq = this.lastStableFreq;
                    }
                }
            }
        } else {
            this.pendingOctaveJumpFreq = 0;
            this.pendingOctaveJumpCount = 0;
            this.pendingLargeJumpFreq = 0;
            this.pendingLargeJumpCount = 0;
        }

        // 確定値を履歴に追加
        this.rawHistory.push(finalFreq);
        if (this.rawHistory.length > this.RAW_HISTORY_SIZE) this.rawHistory.shift();

        this.holdFramesLeft = this.maxHoldFrames;
        this.lastStableFreq = finalFreq;
        return { freq: finalFreq, conf: finalConf };
    }
}
