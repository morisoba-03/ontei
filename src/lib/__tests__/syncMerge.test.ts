import { describe, it, expect } from 'vitest';
import { mergeSnapshots, sameSnapshot, emptySnapshot } from '../syncMerge';

describe('mergeSnapshots（PCとスマホの同期）', () => {
    const A = { ...emptySnapshot(), songs: [{ id: 'a', name: 'A-pc', updatedAt: 10 }, { id: 'b', name: 'B', updatedAt: 5 }], midi: { a: 'AAA' }, best: { s1: { score: 70, ghost: [] } } };
    const B = { ...emptySnapshot(), songs: [{ id: 'a', name: 'A-phone', updatedAt: 20 }, { id: 'c', name: 'C', updatedAt: 7 }], tombstones: { b: 6 }, midi: { c: 'CCC' }, best: { s1: { score: 80, ghost: [] }, s2: { score: 50, ghost: [] } } };

    it('同じ曲は新しいほうを残す', () => {
        const m = mergeSnapshots(A, B);
        expect(m.songs.find(s => s.id === 'a')?.name).toBe('A-phone');
    });
    it('もう一方で消した曲は消える', () => {
        expect(mergeSnapshots(A, B).songs.find(s => s.id === 'b')).toBeUndefined();
    });
    it('片方にしかない曲と MIDI は取り込む', () => {
        const m = mergeSnapshots(A, B);
        expect(m.songs.find(s => s.id === 'c')).toBeDefined();
        expect(m.midi.c).toBe('CCC');
    });
    it('ベスト記録は高いほうを残す', () => {
        const m = mergeSnapshots(A, B);
        expect(m.best.s1.score).toBe(80);
        expect(m.best.s2.score).toBe(50);
    });
    it('削除のあとで保存し直した曲は残る', () => {
        const m = mergeSnapshots({ ...emptySnapshot(), songs: [{ id: 'b', name: 'B2', updatedAt: 9 }] }, { ...emptySnapshot(), tombstones: { b: 6 } });
        expect(m.songs.map(s => s.name)).toEqual(['B2']);
        expect(m.tombstones.b).toBeUndefined();
    });
    it('どちらから合併しても同じ結果になる', () => {
        expect(sameSnapshot(mergeSnapshots(A, B), mergeSnapshots(B, A))).toBe(true);
    });
    it('曲ごとのオクターブは新しく変えたほうを残す（古い形式のデータが相手でも消えない）', () => {
        const pc = { ...emptySnapshot(), oct: { s1: { o: 2, t: 100 }, s2: { o: 1, t: 50 } } };
        const phone = { ...emptySnapshot(), oct: { s1: { o: 1, t: 200 } } };
        const m = mergeSnapshots(pc, phone);
        expect(m.oct?.s1.o).toBe(1);
        expect(m.oct?.s2.o).toBe(1);
        expect(mergeSnapshots(pc, emptySnapshot()).oct?.s1.o).toBe(2);
        expect(sameSnapshot(mergeSnapshots(pc, phone), mergeSnapshots(phone, pc))).toBe(true);
    });
});
