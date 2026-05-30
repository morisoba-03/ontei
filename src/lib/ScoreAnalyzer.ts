
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
    scoopCount: number;
    vibratoSec: number;
    notesHit: number;
    notesTotal: number;
    comment: string;
    advice: import('./PerformanceAdvisor').ExpertAdvice[];
    phraseScores: import('./types').PhraseResult[];
    weakNotes: { noteIndex: number; diff: number; count: number }[];
    // 反復練習のための苦手区間（複数）
    difficultSections?: {
        start: number;          // 苦手区間の生の開始時刻（秒）
        end: number;            // 苦手区間の生の終了時刻（秒）
        extendedStart: number;  // 前後 2 小節を含めたループ練習開始時刻
        extendedEnd: number;    // 前後 2 小節を含めたループ練習終了時刻
        badRatio: number;       // この区間の悪さの度合い（0-1）
        avgCents: number;       // 区間内のセント誤差平均（絶対値）
    }[];
}

import { PerformanceAdvisor } from './PerformanceAdvisor';

// Helper for note names

export class ScoreAnalyzer {
    private frames: ScoreFrame[] = [];
    private vibratoBuffer: { t: number, p: number }[] = [];
    private lastVibratoTime: number = 0;
    private vibratoState: boolean = false;
    private vibratoCount: number = 0;
    private scoopCount: number = 0;
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
        this.scoopCount = 0;
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
                scoopCount: 0,
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

        // Technique: Vibrato + Scoop
        const vibratoBonus = this.vibratoCount * 10;
        const scoopBonus = this.scoopCount * 5;
        const techniqueScore = Math.min(100, vibratoBonus + scoopBonus);

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
            scoopCount: this.scoopCount,
            vibratoSec: 0,
            notesHit: 0,
            notesTotal: 0,
            comment: this.getComment(totalScore, { pitch: pitchScore, stability: stabilityScore, rhythm: rhythmScore, expressiveness: techniqueScore }, avgDiff),
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
        this.scoopCount = 0; // Reset for recalculation based on phrases

        if (!phrases || phrases.length === 0) return;

        phrases.forEach(phrase => {
            const phraseFrames = this.frames.filter(f => f.time >= phrase.startTime && f.time <= phrase.endTime);
            const valid = phraseFrames.filter(f => f.userPitch > 0 && f.guidePitch > 0);

            if (phraseFrames.length === 0) return;

            let score = 0;
            if (valid.length > 0) {
                // Scoop Detection Logic (Portamento support)
                // Check first few frames (e.g., first 300ms)
                const attackDuration = 0.3;
                const attackFrames = valid.filter(f => f.time - phrase.startTime < attackDuration);

                if (attackFrames.length > 3) {
                    // Check if starting low and rising
                    const startDiff = attackFrames[0].diffCents; // Should be negative (flat)
                    const endDiff = attackFrames[attackFrames.length - 1].diffCents;

                    // Condition 1: Starts significantly flat (-200 to -50 cents)
                    // Condition 2: Ends closer to target (improving)
                    // Condition 3: Monotonic increase in pitch (roughly)
                    if (startDiff < -50 && endDiff > startDiff + 30 && Math.abs(endDiff) < 50) {
                        this.scoopCount++;

                        // Bonus: treat attack frames as hits without mutating shared frame objects
                        const attackSet = new Set(attackFrames);
                        const validWithBonus = valid.map(f =>
                            attackSet.has(f) ? { ...f, diffCents: 0 } : f
                        );
                        score = this.calculatePitchScore(validWithBonus);
                    } else {
                        score = this.calculatePitchScore(valid);
                    }
                } else {
                    score = this.calculatePitchScore(valid);
                }
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

    private getComment(score: number, radar: { pitch: number; stability: number; rhythm: number; expressiveness: number }, tendency: number): string {
        const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

        // 弱点に応じた具体的なコメント（スコアが低い場合）
        if (score < 80) {
            const weakestArea = radar.pitch <= radar.stability && radar.pitch <= radar.rhythm ? 'pitch'
                : radar.stability <= radar.pitch && radar.stability <= radar.rhythm ? 'stability'
                : 'rhythm';

            if (weakestArea === 'pitch' && radar.pitch < 65) return pick([
                "音程が外れやすい状態です。ガイドの音をよく耳で追いながら、焦らずゆっくり吹いてみましょう。",
                "ピッチのズレが目立ちます。まずはガイドと全く同じ音を出す「コピー練習」から始めましょう。",
                "音程を正確にとるには「内的聴音」が大切です。吹く前に頭の中でメロディを歌ってみてください。",
                "音階練習でドレミの位置を体に覚えさせましょう。正確なピッチ感は繰り返しで身につきます。",
                "難しいフレーズは1音ずつ確認する「分割練習」が効果的です。一気に吹こうとしなくて大丈夫です。",
                "口の形（アンブシュア）が安定していないとピッチが定まりません。基本の形を確認してみましょう。",
                "まずはゆっくりなテンポで、音程を正確に取ることだけに集中して練習してみましょう。",
                "音がズレているフレーズをループ練習機能で繰り返し練習するのが効果的です。",
            ]);

            if (weakestArea === 'stability' && radar.stability < 65) return pick([
                "音が震えてしまっています。ロングトーン練習でお腹から均一に息を出す感覚を養いましょう。",
                "フレーズの途中でピッチが揺れています。最後の音まで息をしっかり支える意識を持ちましょう。",
                "まっすぐ1音を長く吹く練習を毎日やってみましょう。安定感の土台になります。",
                "一定の強さで吹き続ける練習が効果的です。メトロノームに合わせてリズム練習も合わせましょう。",
                "音の揺れは息のコントロールが鍵です。腹式呼吸を意識しながら、じっくり基礎を固めましょう。",
                "緊張や力みが音の揺れにつながります。深く息を吸って、肩の力を抜いてから吹いてみましょう。",
            ]);

            if (weakestArea === 'rhythm' && radar.rhythm < 65) return pick([
                "音の入りタイミングがズレています。ガイドのリズムを手や足でたたきながら練習してみましょう。",
                "吹くタイミングが早めか遅めになっています。カウントを声に出しながら練習すると改善します。",
                "リズムを体で感じることが大切です。メトロノームに合わせて、まず体でリズムを刻んでみましょう。",
                "音の長さ（音価）を意識して吹いていますか？楽譜のリズムをあらためて確認してみましょう。",
            ]);

            if (Math.abs(tendency) > 25) {
                if (tendency > 0) return pick([
                    "全体的に音が上ずっています（シャープ傾向）。息の圧力を少し弱め、リラックスして吹きましょう。",
                    "ピッチが全体的に高めです。深呼吸して落ち着かせ、少し低めを狙う感覚で吹くと改善します。",
                    "張り切りすぎて音が高くなっているかもしれません。力まずゆったりとした息の流れを意識してください。",
                    "全体的にシャープ傾向があります。唇の形を少し緩めるか、息のスピードを落として調整しましょう。",
                ]);
                else return pick([
                    "全体的に音が下がり気味（フラット傾向）です。息のスピードを少し上げると改善します。",
                    "ピッチが全体的に低めです。口の形（アンブシュア）をしっかり作り、息を集中させましょう。",
                    "音が届いていない箇所があります。明るい音色をイメージして、前向きに息を出してみましょう。",
                    "全体的にフラット傾向があります。唇の隙間を少し絞り、息を一点に集める意識を持ちましょう。",
                ]);
            }
        }

        // スコア帯別コメント
        if (score >= 95) return pick([
            "完璧に近い演奏です！音程・安定性・リズムすべてが高水準でした。このレベルを維持し続けてください。",
            "驚異的な精度です。ガイドメロディへの追従が完璧で、聴いていて心地よい演奏でした。",
            "素晴らしいコントロール！口笛の魅力を最大限に引き出せています。",
            "まさに達人の域！ピッチの揺れがほとんどなく、美しい演奏でした。",
            "圧巻のパフォーマンス！息のコントロールが完璧に仕上がっています。",
            "ほぼパーフェクト！細部まで丁寧に吹けています。録音して聴き返す価値があります。",
            "このレベルまで来たら、あとは表現の幅を広げることに集中しましょう。素晴らしい基礎力です！",
            "完璧に近い出来栄えです。次のステップは曲全体のダイナミクス（強弱）を意識することです。",
        ]);

        if (score >= 85) return pick([
            "かなりハイレベルです！細かい音程のコントロールが身についています。",
            "とても安定した演奏でした。さらに表現力を加えれば完璧に近づきます。",
            "高い精度で吹けています。音程の取り方がしっかりできています。",
            "基礎力が高く、安定した演奏です。次は強弱をつけた表現に挑戦してみましょう。",
            "素晴らしい！あとは細部を詰めるだけで95点超えも見えてきます。",
            "全体的によく仕上がっています。苦手なフレーズだけ集中的に練習すれば更に伸びます。",
            "高得点です！ピッチコントロールが安定しており、練習の成果がしっかり出ています。",
            "非常に良い演奏でした。この水準をキープしながら、表現の幅を広げていきましょう。",
        ]);

        if (score >= 75) return pick([
            "良い調子です！全体的によく吹けています。あと一歩で上位圏に届きます。",
            "安定感が出てきました。細かいピッチの揺れを抑えればさらに伸びます。",
            "ガイドメロディによく追従できています。苦手フレーズを特定して重点練習しましょう。",
            "基礎はしっかりできています。さらに抑揚をつけるとより良くなるでしょう。",
            "上手に吹けています！難しいフレーズを重点的に練習すれば90点台も狙えます。",
            "全体的に良い演奏でしたが、一部ピッチが外れる箇所があります。その部分を集中練習してみましょう。",
            "良い演奏です！ここから一段上がるためには、弱点フレーズへの集中練習が効果的です。",
            "まずまずの仕上がりです。後もう少しの磨きをかけることで大きく上達します。",
        ]);

        if (score >= 60) return pick([
            "もう少しです！音程のズレを意識して、丁寧に吹くことを心がけましょう。",
            "惜しいところまで来ています。ガイドメロディをよく聴いて、音程を合わせる練習を続けましょう。",
            "所々良い部分があります。安定して吹ける音域を広げていきましょう。",
            "課題はありますが、改善の余地は十分あります。特に音程が外れやすいフレーズに注目してください。",
            "落ち着いて一音一音丁寧に吹いてみましょう。焦りが音程のズレにつながることがあります。",
            "ガイドメロディを先にしっかり聴いて、音を「耳で覚えて」から吹くと改善します。",
            "難しいと感じたら、テンポを落として練習するのがとても効果的です。",
            "短いフレーズに分けて、完璧に吹けるようになってから次に進むと着実に上達します。",
        ]);

        if (score >= 45) return pick([
            "まずはリラックスして。ガイドの音をよく聴くことから始めましょう。",
            "焦らず練習しましょう。まずは短いフレーズから完璧にするのがコツです。",
            "難しかったですか？テンポを落としてゆっくり練習するのがおすすめです。",
            "音程を合わせるのに時間がかかっていますね。耳でガイドを何度も聴いてから吹く練習から始めましょう。",
            "基礎となるロングトーン練習（1音をまっすぐ長く吹く）から始めてみましょう。",
            "このフレーズはまず最初の音だけを正確に吹けるよう練習し、少しずつ伸ばしていきましょう。",
        ]);

        return pick([
            "あきらめないで！繰り返し練習すれば必ず上手くなります。",
            "最初は誰でも難しいものです。楽しんで吹くことが一番の上達法です！",
            "一歩一歩着実に。まずは一番簡単なフレーズを完璧にすることから始めましょう。",
            "難しいと感じることは成長している証拠です。毎日少しずつ練習を続けましょう。",
            "口笛の上達には時間がかかりますが、コツコツ続けることが大切です。今日より明日、確実に上手くなっています！",
            "スコアは気にせず、まずは音を楽しむことから始めましょう。楽しい練習が一番の近道です。",
        ]);
    }
}
