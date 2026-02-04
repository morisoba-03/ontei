import type { ScoreFrame } from './ScoreAnalyzer';

export interface ExpertAdvice {
    category: 'pitch' | 'timing' | 'expression' | 'stability';
    level: 'info' | 'warning' | 'positive';
    message: string;
}

export class PerformanceAdvisor {
    analyze(frames: ScoreFrame[], vibratoCount: number): ExpertAdvice[] {
        const advice: ExpertAdvice[] = [];
        if (frames.length === 0) return advice;

        // 1. Pitch Tendency (High vs Low notes)
        const avgError = frames.reduce((s, f) => s + f.diffCents, 0) / frames.length;
        if (Math.abs(avgError) > 15) {
            advice.push({
                category: 'pitch',
                level: 'warning',
                message: `全体的に${avgError > 0 ? 'シャープ（高め）' : 'フラット（低め）'}になっている傾向があります。${avgError > 0 ? 'リラックスして重心を下げるイメージで。' : '表情筋を上げて、明るい音色を意識してみましょう。'}`
            });
        }

        // Analyze specific ranges (e.g. High notes tendency)
        // Simple heuristic: top 20% of pitch
        const pitches = frames.map(f => f.guidePitch).sort((a, b) => a - b);
        const highThresh = pitches[Math.floor(pitches.length * 0.8)];
        const highFrames = frames.filter(f => f.guidePitch >= highThresh);

        if (highFrames.length > 5) {
            const highAvg = highFrames.reduce((s, f) => s + f.diffCents, 0) / highFrames.length;
            if (highAvg < -20) {
                advice.push({
                    category: 'pitch',
                    level: 'info',
                    message: '高音域でピッチが下がりがちです。喉を締めず、頭のてっぺんから声を出すイメージで支えを意識しましょう。'
                });
            }
        }

        // 2. Interval Accuracy (Long jumps)
        // Detect frames where guide pitch changed significantly from previous frame
        let jumpErrors = 0;
        let largeJumps = 0;
        for (let i = 5; i < frames.length; i++) {
            const prev = frames[i - 5]; // look back a bit for stability
            const curr = frames[i];
            const interval = 1200 * Math.log2(curr.guidePitch / prev.guidePitch);

            if (Math.abs(interval) > 500) { // > 5 semitones
                largeJumps++;
                // Check if user followed accurately within a short time (e.g. next 0.5s)
                // We check the error of the current frame (presumably after the jump)
                if (Math.abs(curr.diffCents) > 50) {
                    jumpErrors++;
                }
            }
        }

        if (largeJumps > 0 && (jumpErrors / largeJumps) > 0.4) {
            advice.push({
                category: 'pitch',
                level: 'warning',
                message: '音が大きく飛ぶ箇所でピッチが不安定になっています。次の音を頭の中でしっかりイメージしてから発声しましょう。'
            });
        }

        // 3. Vibrato / Expression
        // Only praise if vibrato is used well; do NOT suggest adding vibrato (user prefers straight tone as default)
        if (vibratoCount > 5) {
            advice.push({
                category: 'expression',
                level: 'positive',
                message: 'ビブラートが上手く使えています！表現力が素晴らしいです。'
            });
        }

        return advice;
    }
}
