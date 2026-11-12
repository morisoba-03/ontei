/**
 * 同期データの合併（純粋関数。テストしやすいよう Drive やブラウザ API から切り離してある）
 *  - 曲: 同じ id なら updatedAt が新しい方。削除記録（tombstone）の方が新しければ消す
 *  - MIDI: 採用した側の曲に付いている MIDI。無ければもう一方
 *  - ベスト記録: スコアが高い方
 */

export interface SyncSong {
    id: string;
    updatedAt?: number;
    createdAt?: number;
    hasMidiData?: boolean;
    [k: string]: unknown;
}

export interface SyncSnapshot {
    v: 1;
    savedAt: number;
    songs: SyncSong[];
    tombstones: Record<string, number>;
    midi: Record<string, string>; // id -> base64
    best: Record<string, { score: number; ghost: unknown[] }>;
}

export const emptySnapshot = (): SyncSnapshot => ({ v: 1, savedAt: 0, songs: [], tombstones: {}, midi: {}, best: {} });

const stamp = (s: SyncSong) => s.updatedAt ?? s.createdAt ?? 0;

export function mergeSnapshots(a: SyncSnapshot, b: SyncSnapshot): SyncSnapshot {
    const tombstones: Record<string, number> = { ...a.tombstones };
    for (const [id, t] of Object.entries(b.tombstones)) tombstones[id] = Math.max(tombstones[id] ?? 0, t);

    const aMap = new Map(a.songs.map(s => [s.id, s]));
    const bMap = new Map(b.songs.map(s => [s.id, s]));
    const ids = new Set([...aMap.keys(), ...bMap.keys()]);

    const songs: SyncSong[] = [];
    const midi: Record<string, string> = {};
    for (const id of ids) {
        const sa = aMap.get(id);
        const sb = bMap.get(id);
        let pick: SyncSong;
        let fromA: boolean;
        if (sa && sb) { fromA = stamp(sa) >= stamp(sb); pick = fromA ? sa : sb; }
        else if (sa) { fromA = true; pick = sa; }
        else { fromA = false; pick = sb!; }

        const dead = tombstones[id];
        if (dead !== undefined && dead >= stamp(pick)) continue;

        songs.push(pick);
        const m = fromA ? (a.midi[id] ?? b.midi[id]) : (b.midi[id] ?? a.midi[id]);
        if (m) midi[id] = m;
    }
    // 生きている曲の削除記録は不要
    for (const s of songs) delete tombstones[s.id];

    const best: SyncSnapshot['best'] = { ...a.best };
    for (const [sig, r] of Object.entries(b.best)) {
        if (!best[sig] || r.score > best[sig].score) best[sig] = r;
    }

    return { v: 1, savedAt: Date.now(), songs, tombstones, midi, best };
}

/** 中身が同じか（savedAt は無視） */
export function sameSnapshot(a: SyncSnapshot, b: SyncSnapshot): boolean {
    const norm = (s: SyncSnapshot) => JSON.stringify({
        songs: [...s.songs].sort((x, y) => x.id.localeCompare(y.id)),
        tombstones: Object.keys(s.tombstones).sort().map(k => [k, s.tombstones[k]]),
        midi: Object.keys(s.midi).sort().map(k => [k, s.midi[k].length, s.midi[k].slice(0, 64)]),
        best: Object.keys(s.best).sort().map(k => [k, s.best[k].score]),
    });
    return norm(a) === norm(b);
}
