import { describe, it, expect } from 'vitest';
import { fitOctaveToRange } from '../guideRange';

const RANGE = { low: 72, high: 103, comfort: 84 }; // C5〜G7、中心 C6
const notes = (ms: number[]) => ms.map(m => ({ midi: m, duration: 1 }));

describe('fitOctaveToRange（口笛の音域に合わせる）', () => {
    it('童謡（C4〜C5）は +2 オクターブ', () => {
        const r = fitOctaveToRange(notes([60, 62, 64, 65, 67, 69, 71, 72]), RANGE);
        expect(r.offset).toBe(2);
        expect(r.fits).toBe(true);
    });
    it('低い曲（C3〜G3）は +3 オクターブ', () => {
        expect(fitOctaveToRange(notes([48, 50, 52, 55]), RANGE).offset).toBe(3);
    });
    it('すでに口笛の音域（D5〜A6）ならそのまま', () => {
        expect(fitOctaveToRange(notes([74, 79, 81, 86, 93]), RANGE).offset).toBe(0);
    });
    it('音域が広すぎる曲は、はみ出しが最小になるよう合わせて fits=false を返す', () => {
        const r = fitOctaveToRange(notes([48, 60, 72, 88]), RANGE);
        expect(r.fits).toBe(false);
        expect(r.offset).toBe(2);
    });
    it('移調ぶんも考慮する', () => {
        expect(fitOctaveToRange(notes([48, 50, 52, 55]), { ...RANGE, transpose: 12 }).offset).toBe(2);
    });
    it('ノートが無ければ現在の値を返す', () => {
        expect(fitOctaveToRange([], { ...RANGE, current: 1 }).offset).toBe(1);
    });
});
