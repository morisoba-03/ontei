import type { ScoreFrame } from './ScoreAnalyzer';

export interface ExpertAdvice {
    category: 'pitch' | 'timing' | 'expression' | 'stability';
    level: 'info' | 'warning' | 'positive';
    message: string;
}

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

export class PerformanceAdvisor {
    analyze(frames: ScoreFrame[], vibratoCount: number): ExpertAdvice[] {
        const valid = frames.filter(f => f.userPitch > 0 && f.guidePitch > 0);
        if (valid.length < 10) return [];

        const advice: ExpertAdvice[] = [];
        const diffs = valid.map(f => f.diffCents);
        const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;

        // ── 1. 全体的な音程傾向 ──────────────────────────────────────────
        if (avgDiff > 45) {
            advice.push({
                category: 'pitch', level: 'warning',
                message: pick([
                    '全体的に音が大きくシャープ（高め）になっています。息の圧力を少し弱め、唇の形をわずかに緩めて調整してみましょう。',
                    '音全体が高すぎる傾向があります。力みをほぐして、リラックスした息の流れを意識してください。',
                    'オーバーブロー気味です。息を「吹き込む」のではなく「当てる」イメージに切り替えてみましょう。',
                    '強く吹きすぎることでピッチが高くなっています。息のスピードを少し落とし、丁寧に音を作りましょう。',
                    '音が全体的に上ずっています。深い腹式呼吸で落ち着かせ、少し低めを狙う感覚で吹くと改善します。',
                ])
            });
        } else if (avgDiff > 18) {
            advice.push({
                category: 'pitch', level: 'info',
                message: pick([
                    '全体的にわずかにシャープ（高め）な傾向があります。意識的に少し低めを狙うと、ちょうどよくなるでしょう。',
                    'ピッチが少しだけ高め。息圧をほんの少し抑えると安定します。大きな問題ではありません。',
                    '音がほんのり高めです。慌てず丁寧に吹くことで自然と改善されます。',
                    '僅かにシャープ傾向があります。唇の形をもう少し絞るか、息のスピードを微調整してみましょう。',
                ])
            });
        } else if (avgDiff < -45) {
            advice.push({
                category: 'pitch', level: 'warning',
                message: pick([
                    '全体的に音が大きくフラット（低め）になっています。息のスピードを上げるか、唇の形（アンブシュア）を見直しましょう。',
                    'ピッチが全体的に低すぎます。唇の隙間を少し絞り、息を集中させるイメージで吹いてみましょう。',
                    '音が届いていない箇所が多いです。お腹からしっかり息を送り出すことを意識しましょう。',
                    'フラットが目立ちます。「もう少し高く」という意識を常に持ちながら吹いてみてください。',
                    '口の形が緩んでいるかもしれません。アンブシュアを意識的に作り、息が一点に集まるよう調整しましょう。',
                ])
            });
        } else if (avgDiff < -18) {
            advice.push({
                category: 'pitch', level: 'info',
                message: pick([
                    '全体的にわずかにフラット（低め）な傾向があります。息のスピードをほんの少し速くすると改善します。',
                    'ピッチが少し低め。唇の形をしっかり作ることで音程が上がります。',
                    '音がほんのり低めです。「明るい音色」を意識するとピッチが自然に上がります。',
                    '僅かにフラット傾向があります。口の形を一定に保ち、均一な息の流れを心がけましょう。',
                ])
            });
        }

        // ── 2. 高音域の傾向 ──────────────────────────────────────────────
        const sorted = [...valid].sort((a, b) => a.guidePitch - b.guidePitch);
        const highThresh = sorted[Math.floor(sorted.length * 0.75)]?.guidePitch ?? Infinity;
        const lowThresh = sorted[Math.floor(sorted.length * 0.25)]?.guidePitch ?? 0;

        const highFrames = valid.filter(f => f.guidePitch >= highThresh);
        const lowFrames = valid.filter(f => f.guidePitch <= lowThresh);

        if (highFrames.length >= 5) {
            const highAvg = highFrames.reduce((s, f) => s + f.diffCents, 0) / highFrames.length;
            if (highAvg < -28) {
                advice.push({
                    category: 'pitch', level: 'warning',
                    message: pick([
                        '高音域でピッチが届いていません。高い音は息のスピードを上げ、唇の開口部を少し小さくすることで改善します。',
                        '高音でフラットになりやすいです。「明るく遠くへ飛ばす」イメージで吹いてみましょう。',
                        '高い音で息が足りなくなっています。高音域に入る前に充分な息を確保しておきましょう。',
                        '高音域で音が下がっています。フレーズの終わりまで息のサポートを意識して維持しましょう。',
                        '高い音ほど唇の形が崩れやすいです。鏡で確認しながら練習するのも効果的です。',
                    ])
                });
            } else if (highAvg > 35) {
                advice.push({
                    category: 'pitch', level: 'info',
                    message: pick([
                        '高音域でオーバーブロー（吹きすぎ）の傾向があります。高音では力を抜いて、柔らかく息を当てるコツを試してみましょう。',
                        '高い音になるほど息の圧力が上がっています。高音域は「フワッと乗せる」感覚が大切です。',
                        '高音で音が高くなりすぎています。高音ほど息を細く集中させる意識を持ちましょう。',
                        '高音への移行時に力んでいるようです。次の音へ移る前に、一瞬リラックスする間を取りましょう。',
                    ])
                });
            }
        }

        // ── 3. 低音域の傾向 ──────────────────────────────────────────────
        if (lowFrames.length >= 5) {
            const lowAvg = lowFrames.reduce((s, f) => s + f.diffCents, 0) / lowFrames.length;
            if (lowAvg < -28) {
                advice.push({
                    category: 'pitch', level: 'info',
                    message: pick([
                        '低音域でピッチが低めになっています。低い音は唇を適度にリラックスさせ、息の流れを一定に保ちましょう。',
                        '低い音でフラットになる傾向があります。口の形を崩さず、均一な息で吹くことを意識してください。',
                        '低音域では息の量が少なくなりがちです。しっかり息を流してピッチを支えましょう。',
                    ])
                });
            } else if (lowAvg > 28) {
                advice.push({
                    category: 'pitch', level: 'info',
                    message: pick([
                        '低音域でピッチが高くなりがちです。低い音ほど唇を少し緩め、大きめの開口部を意識しましょう。',
                        '低い音でシャープになっています。低音域に入る際は意識的に口の形を切り替えてみましょう。',
                    ])
                });
            }
        }

        // ── 4. 音程跳躍の精度 ────────────────────────────────────────────
        let jumpCount = 0, jumpMisses = 0;
        for (let i = 5; i < valid.length; i++) {
            const prev = valid[i - 5];
            const curr = valid[i];
            const interval = Math.abs(1200 * Math.log2(curr.guidePitch / prev.guidePitch));
            if (interval > 500) {
                jumpCount++;
                if (Math.abs(curr.diffCents) > 60) jumpMisses++;
            }
        }
        if (jumpCount >= 3) {
            const missRate = jumpMisses / jumpCount;
            if (missRate > 0.6) {
                advice.push({
                    category: 'pitch', level: 'warning',
                    message: pick([
                        '音程の大きな跳躍（5度以上）で音を外しやすいです。次の音のピッチを頭の中で「先取り」してから吹くよう練習しましょう。',
                        '大きく音程が飛ぶ箇所でピッチが不安定です。跳躍前に一瞬だけ口の形を準備する余裕を作りましょう。',
                        '大きな音程跳躍が苦手のようです。跳躍の両端の音だけを繰り返し吹いて、口の形の切り替えを体に覚えさせましょう。',
                        '音が大きく飛ぶ場面で外れやすいです。ゆっくりテンポで何度も繰り返し、筋肉記憶を作ることが大切です。',
                        '跳躍時の精度を上げるには、目標音を「聴こえる前から想像する」内的聴音の練習が効果的です。',
                    ])
                });
            } else if (missRate > 0.3) {
                advice.push({
                    category: 'pitch', level: 'info',
                    message: pick([
                        '音程の大きな跳躍で時々音を外しています。難しい跳躍フレーズだけを取り出してゆっくり反復練習すると効果的です。',
                        '大きな音程跳躍が少し不安定ですが、改善の余地があります。テンポを落として丁寧に練習しましょう。',
                        '跳躍の部分でわずかにズレがあります。そのフレーズを区間ループ機能で集中練習してみましょう。',
                    ])
                });
            }
        }

        // ── 5. ピッチの揺れ（安定性） ──────────────────────────────────
        const winSize = 30;
        let highJitterCount = 0, winCount = 0;
        for (let i = winSize; i < valid.length; i += winSize) {
            const win = valid.slice(i - winSize, i);
            const wDiffs = win.map(f => f.diffCents);
            const mean = wDiffs.reduce((a, b) => a + b, 0) / wDiffs.length;
            const std = Math.sqrt(wDiffs.reduce((a, b) => a + (b - mean) ** 2, 0) / wDiffs.length);
            winCount++;
            if (std > 40) highJitterCount++;
        }
        const jitterRate = winCount > 0 ? highJitterCount / winCount : 0;
        if (jitterRate > 0.45) {
            advice.push({
                category: 'stability', level: 'warning',
                message: pick([
                    'ピッチが細かく震えています。息の流れが不安定な状態です。ロングトーン練習でお腹から均一に息を出す感覚を養いましょう。',
                    '音程の揺れが多めです。横隔膜を使って息を一定量ずつ送り出す意識を持ちましょう。',
                    'ピッチが安定していません。まず1音をまっすぐ長く吹けるよう練習してみましょう。',
                    '音の揺れが目立ちます。力みを取り除き、ゆっくりとした腹式呼吸を意識して吹きましょう。',
                    '細かい音のブレがあります。体全体をリラックスさせ、特に肩・首の緊張を解いてみましょう。',
                ])
            });
        } else if (jitterRate > 0.25) {
            advice.push({
                category: 'stability', level: 'info',
                message: pick([
                    '音がわずかに揺れる箇所があります。息の量を一定に保つ意識を持つと、さらに安定します。',
                    'ところどころピッチが揺れています。ロングトーン練習で息のコントロール力を鍛えましょう。',
                    '部分的に音が不安定になっています。難しいフレーズは特にゆっくり丁寧に練習してみましょう。',
                ])
            });
        }

        // ── 6. 後半にかけての一貫性 ──────────────────────────────────────
        if (valid.length >= 40) {
            const half = Math.floor(valid.length / 2);
            const earlyAcc = valid.slice(0, half).filter(f => Math.abs(f.diffCents) < 50).length / half;
            const lateAcc = valid.slice(half).filter(f => Math.abs(f.diffCents) < 50).length / (valid.length - half);
            const delta = lateAcc - earlyAcc;

            if (delta > 0.15) {
                advice.push({
                    category: 'expression', level: 'positive',
                    message: pick([
                        '演奏が後半にかけて安定してきました！ウォームアップ後に本領を発揮するタイプです。最初から本番のつもりで臨むとさらに良くなります。',
                        '後半になるほど良くなっています。この調子で練習を重ねれば、最初から安定した演奏ができるようになります。',
                        '前半より後半の方が音程が良くなっています。体が温まるほど上手くなる傾向が出ています。',
                        '後半はとても安定しています。この安定感を前半から発揮できるよう、ウォームアップを念入りにしてみましょう。',
                    ])
                });
            } else if (delta < -0.18) {
                advice.push({
                    category: 'stability', level: 'info',
                    message: pick([
                        '後半になるにつれてピッチが乱れています。疲れが影響しているかもしれません。休憩をはさみながら練習しましょう。',
                        '演奏の後半で集中力が落ちているようです。長い練習は短いセクションに区切るのが効果的です。',
                        '後半でピッチが不安定になっています。無理のない範囲で練習し、疲れたら休むことも上達への道です。',
                        '前半は良かったですが後半で崩れています。息の持ちや集中力の維持を意識して練習しましょう。',
                    ])
                });
            }
        }

        // ── 7. ピッチ精度が高い場合の称賛 ────────────────────────────────
        const pitchAcc = valid.filter(f => Math.abs(f.diffCents) < 50).length / valid.length;
        if (pitchAcc > 0.88) {
            advice.push({
                category: 'pitch', level: 'positive',
                message: pick([
                    '音程の精度が非常に高いです！ガイドメロディへの追従が素晴らしい。',
                    'ピッチコントロールが優秀です。正確な耳と口の形の連携ができています。',
                    'ほとんどの音が的確なピッチで吹けています。この精度を維持しましょう！',
                    '音程の取り方が非常に上手です。練習の成果がしっかり出ています。',
                    '細かい音程までしっかりコントロールできています。音楽的な耳が育っています！',
                ])
            });
        }

        // ── 8. 安定性が高い場合の称賛 ────────────────────────────────────
        const nonVibFrames = valid.filter(f => !f.hasVibrato);
        const stableRate = nonVibFrames.length > 0
            ? nonVibFrames.filter(f => f.isStable).length / nonVibFrames.length
            : 0;
        if (stableRate > 0.82 && jitterRate <= 0.2) {
            advice.push({
                category: 'stability', level: 'positive',
                message: pick([
                    'まっすぐ安定した音が吹けています！息のコントロールが素晴らしいです。',
                    'ピッチが非常に安定しています。口笛の基礎がしっかりできています。',
                    '音のブレが少なく、安定した演奏ができています。この安定感が表現力のベースになります。',
                    '一定したピッチで吹き続けられています。ロングトーンの成果が出ていますね。',
                ])
            });
        }

        // ── 9. ビブラートのフィードバック ───────────────────────────────
        if (vibratoCount >= 8) {
            advice.push({
                category: 'expression', level: 'positive',
                message: pick([
                    `${vibratoCount}回ものビブラートが自然にかかっています！豊かな表現力が素晴らしいです。`,
                    'ビブラートが演奏全体に彩りを添えています。ビブラートのかけ方が自然で美しいです。',
                    '自然なビブラートが演奏の魅力を高めています。音楽的な表現力が際立っています。',
                ])
            });
        } else if (vibratoCount >= 3) {
            advice.push({
                category: 'expression', level: 'positive',
                message: pick([
                    'ビブラートが効果的にかかっています！表現力が豊かです。',
                    'ところどころビブラートが入って、演奏に表情が出ています。',
                    'ビブラートが演奏にアクセントを加えています。',
                ])
            });
        }

        // ── 優先順位順に並べて最大5件を返す ──────────────────────────────
        const warnings = advice.filter(a => a.level === 'warning');
        const infos = advice.filter(a => a.level === 'info');
        const positives = advice.filter(a => a.level === 'positive');
        return [...warnings.slice(0, 2), ...infos.slice(0, 2), ...positives.slice(0, 2)].slice(0, 5);
    }
}
