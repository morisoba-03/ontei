/**
 * ガイドを口笛の音域 [low, high] に収めるオクターブシフト（12 半音単位）を求める。
 *  1. 音域からはみ出す量（半音 × 音の長さ）が最小のシフトを優先する
 *  2. はみ出しが同じなら、曲の中心音（長さで重み付けした中央値）が comfort に最も近いもの
 *  3. それも同じなら、シフト量が小さいもの
 * notes の midi には移調を含めないこと（transpose で加える）。
 */
export interface OctaveFit { offset: number; lo: number; hi: number; fits: boolean }

export function fitOctaveToRange(
    notes: { midi: number; duration?: number }[],
    opt: { low: number; high: number; comfort: number; transpose?: number; current?: number },
): OctaveFit {
    const cur = opt.current ?? 0;
    if (notes.length === 0) return { offset: cur, lo: 0, hi: 0, fits: true };
    const { low, high, comfort } = opt;
    const tr = opt.transpose ?? 0;

    const items = notes
        .map(n => ({ m: n.midi + tr, w: n.duration && n.duration > 0 ? n.duration : 1 }))
        .sort((x, y) => x.m - y.m);
    const totalW = items.reduce((s, it) => s + it.w, 0);
    let acc = 0;
    let median = items[items.length - 1].m;
    for (const it of items) { acc += it.w; if (acc >= totalW / 2) { median = it.m; break; } }
    const minM = items[0].m;
    const maxM = items[items.length - 1].m;

    let best = { offset: cur, out: Infinity, center: Infinity };
    for (let k = -4; k <= 4; k++) {
        const sh = k * 12;
        let out = 0;
        for (const it of items) {
            const m = it.m + sh;
            if (m < low) out += (low - m) * it.w;
            else if (m > high) out += (m - high) * it.w;
        }
        out /= totalW;
        const center = Math.abs(median + sh - comfort);
        const better =
            out < best.out - 1e-9 ||
            (Math.abs(out - best.out) <= 1e-9 && (center < best.center - 1e-9 ||
                (Math.abs(center - best.center) <= 1e-9 && Math.abs(k) < Math.abs(best.offset))));
        if (better) best = { offset: k, out, center };
    }
    const sh = best.offset * 12;
    return { offset: best.offset, lo: minM + sh, hi: maxM + sh, fits: minM + sh >= low && maxM + sh <= high };
}
