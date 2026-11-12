import { describe, it, expect } from 'vitest';
import { PitchEngineV3, OctaveFolder, v3WindowSamples } from '../PitchEngineV3';
import { PitchAnalyzer } from '../PitchAnalyzer';
import { synth, SR, WHISTLE, VOICE_H2, VOICE_RICH } from './signal';

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

/** buf の末尾 bufLen サンプルを hop ずつずらして解析し、[推定, 正解] を返す */
function track(sig: Float32Array, f0: (t: number) => number, bufLen = 2048, rate = 60) {
    const e = new PitchEngineV3();
    e.setAnalysisRate(rate);
    const hop = Math.round(SR / rate);
    const win = v3WindowSamples(SR, bufLen);
    const out: { est: number; truth: number }[] = [];
    for (let end = bufLen; end <= sig.length; end += hop) {
        const r = e.analyze(sig.subarray(end - bufLen, end), SR, { minRms: 0.001 });
        if (r.freq > 0 && !r.held) out.push({ est: r.freq, truth: f0((end - win / 2) / SR) });
    }
    return out;
}

function stats(rows: { est: number; truth: number }[]) {
    const c = rows.map(r => Math.abs(cents(r.est, r.truth)));
    const gross = c.filter(x => x > 50).length;
    const fine = c.filter(x => x <= 50).sort((a, b) => a - b);
    return { n: rows.length, gross, median: fine[Math.floor(fine.length / 2)] ?? NaN };
}

describe('PitchEngineV3', () => {
    it('口笛（500〜4000Hz、雑音少なめ）を 1 セント未満で検出する', () => {
        for (const f of [523.25, 1046.5, 1760, 2637, 3951]) {
            const s = stats(track(synth(0.6, () => f, WHISTLE, 30, 3), () => f));
            expect(s.n).toBeGreaterThan(20);
            expect(s.gross).toBe(0);
            expect(s.median).toBeLessThan(1);
        }
    });

    it('雑音が多い口笛（SNR 5dB）でもオクターブを間違えない', () => {
        for (const f of [700, 1200, 2400]) {
            const s = stats(track(synth(0.6, () => f, WHISTLE, 5, 7), () => f));
            expect(s.gross).toBe(0);
        }
    });

    it('第2倍音が強い歌声でも基音を選ぶ（1オクターブ上に間違えない）', () => {
        for (const f of [110, 196, 330]) {
            const s = stats(track(synth(0.6, () => f, VOICE_H2, 25, 11), () => f));
            expect(s.gross).toBe(0);
        }
    });

    it('倍音の多い歌声を正しく検出する', () => {
        for (const f of [130.8, 261.6, 523.3]) {
            const s = stats(track(synth(0.6, () => f, VOICE_RICH, 25, 13), () => f));
            expect(s.gross).toBe(0);
        }
    });

    it('本物のオクターブ跳躍には数フレームで追従する', () => {
        const f0 = (t: number) => (t < 0.3 ? 880 : 1760);
        const rows = track(synth(0.6, f0, WHISTLE, 25, 5), f0);
        const after = rows.filter(r => r.truth === 1760);
        const wrong = after.filter(r => Math.abs(cents(r.est, r.truth)) > 50).length;
        expect(wrong).toBeLessThanOrEqual(3);
    });

    it('スマホ設定（バッファ 8192・40fps）でもビブラートを追従する', () => {
        const base = 1200;
        const f0 = (t: number) => base * Math.pow(2, (40 / 1200) * Math.sin(2 * Math.PI * 6 * t));
        const s = stats(track(synth(0.8, f0, WHISTLE, 20, 9), f0, 8192, 40));
        expect(s.gross).toBe(0);
        expect(s.median).toBeLessThan(5);
    });

    it('無音では音程を返さない', () => {
        const e = new PitchEngineV3();
        const silence = new Float32Array(2048);
        for (let i = 0; i < 10; i++) expect(e.analyze(silence, SR, {}).freq).toBe(0);
    });
});

describe('OctaveFolder（オクターブ違いを正解にする）', () => {
    it('2 オクターブ上で吹いた音をガイドのオクターブに折り返す', () => {
        const f = new OctaveFolder();
        const r = f.fold(1760, 440);
        expect(r.octaveShift).toBe(-2);
        expect(r.freq).toBeCloseTo(440, 6);
    });

    it('境界付近（±6半音）で上下にばたつかない', () => {
        const f = new OctaveFolder();
        const shifts = [615, 630, 618, 628, 640, 612].map(x => f.fold(x, 440).octaveShift);
        expect(new Set(shifts).size).toBe(1);
    });

    it('ガイドが途切れても直前のシフトを保つ', () => {
        const f = new OctaveFolder();
        f.fold(1760, 440);
        expect(f.fold(1760, 0).octaveShift).toBe(-2);
    });
});

describe('PitchAnalyzer', () => {
    it('octaveFree=false では実際の高さのまま返す', () => {
        const a = new PitchAnalyzer();
        const sig = synth(0.3, () => 1760, WHISTLE, 30, 2);
        let last = 0;
        for (let end = 2048; end <= sig.length; end += 800) {
            const r = a.analyze(sig.subarray(end - 2048, end), SR, { guideFreq: 440, octaveFree: false, minRms: 0.001 });
            if (r.freq > 0) last = r.freq;
        }
        expect(Math.abs(cents(last, 1760))).toBeLessThan(5);
    });

    it('octaveFree=true ではガイドのオクターブに合わせる', () => {
        const a = new PitchAnalyzer();
        const sig = synth(0.3, () => 1760, WHISTLE, 30, 2);
        let last = 0;
        for (let end = 2048; end <= sig.length; end += 800) {
            const r = a.analyze(sig.subarray(end - 2048, end), SR, { guideFreq: 440, minRms: 0.001 });
            if (r.freq > 0) last = r.freq;
        }
        expect(Math.abs(cents(last, 440))).toBeLessThan(5);
    });
});
