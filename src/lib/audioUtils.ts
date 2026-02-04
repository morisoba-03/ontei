

export function findZeroCrossOffsetSec(buf: AudioBuffer, maxMs?: number) {
    try {
        const sr = buf.sampleRate || 48000;
        const chL = buf.numberOfChannels > 0 ? buf.getChannelData(0) : null;
        const chR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
        if (!chL) return 0;
        const maxS = Math.min(chL.length, Math.floor(sr * (maxMs || 0.005)));
        // 1) 真のゼロクロス（符号反転）を優先。左右の平均で判定。
        let prev = (chL[0] + (chR ? chR[0] : 0)) * (chR ? 0.5 : 1);
        for (let i = 1; i < maxS; i++) {
            const cur = (chL[i] + (chR ? chR[i] : 0)) * (chR ? 0.5 : 1);
            if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0)) {
                // 線形補間で正確なゼロ交差点を推定
                const frac = Math.abs(cur - prev) > 1e-12 ? (Math.abs(prev) / Math.abs(cur - prev)) : 0;
                const pos = (i - 1) + frac; // サンプル精度
                return pos / sr;
            }
            prev = cur;
        }
        // 2) 符号反転が無ければ、絶対値最小点を選ぶ（左右平均）
        let bestI = 0; let bestAbs = 1e9;
        for (let i = 0; i < maxS; i++) {
            const vL = Math.abs(chL[i]); const vR = chR ? Math.abs(chR[i]) : vL; const v = (vL + vR) * (chR ? 0.5 : 1);
            if (v < bestAbs) { bestAbs = v; bestI = i; if (v < 1e-5) break; }
        }
        return bestI / sr;
    } catch { return 0; }
}

export function readWavMeta(arrayBuffer: ArrayBuffer) {
    // RIFF/WAVE の "fmt " と "smpl" を読み、sampleRate とループポイント(サンプル単位)を返す
    const dv = new DataView(arrayBuffer);
    function readStr(off: number, len: number) { let s = ''; for (let i = 0; i < len; i++) { s += String.fromCharCode(dv.getUint8(off + i)); } return s; }
    const meta: { sampleRate: number; loopStart: number | null; loopEnd: number | null } = { sampleRate: 0, loopStart: null, loopEnd: null };
    try {
        if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') return meta;
        let p = 12; // chunk start
        const len = dv.byteLength;
        while (p + 8 <= len) {
            const id = readStr(p, 4); const size = dv.getUint32(p + 4, true); const body = p + 8; const next = body + size + (size % 2);
            if (id === 'fmt ') {
                if (size >= 16) { meta.sampleRate = dv.getUint32(body + 4, true); }
            } else if (id === 'smpl') {
                if (size >= 36) {
                    const numLoops = dv.getUint32(body + 28, true);
                    const lpOff = body + 36;
                    for (let i = 0; i < numLoops; i++) {
                        if (lpOff + 24 > len) break;
                        const start = dv.getUint32(lpOff + 8, true);
                        const end = dv.getUint32(lpOff + 12, true);
                        meta.loopStart = start; meta.loopEnd = end; break;
                    }
                }
            }
            p = next;
        }
    } catch { /* ignore */ }
    return meta;
}
