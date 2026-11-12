/** テスト用の合成音（口笛・歌声）を作る */
export const SR = 48000;

export function rng(seed = 1) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function synth(
    dur: number, f0: (t: number) => number, harm: number[], snrDb: number, seed = 1, sr = SR,
): Float32Array {
    const r = rng(seed);
    const gauss = () => { let u = 0; for (let i = 0; i < 12; i++) u += r(); return u - 6; };
    const n = Math.floor(dur * sr);
    const s = new Float32Array(n);
    let ph = r() * 2 * Math.PI;
    let p = 0;
    for (let i = 0; i < n; i++) {
        const f = f0(i / sr);
        ph += (2 * Math.PI * f) / sr;
        let v = 0;
        for (let h = 0; h < harm.length; h++) if (f * (h + 1) < sr / 2) v += harm[h] * Math.sin(ph * (h + 1) + h);
        s[i] = v;
        p += v * v;
    }
    const na = Math.sqrt(p / n / Math.pow(10, snrDb / 10));
    let mx = 0;
    for (let i = 0; i < n; i++) { s[i] += gauss() * na; mx = Math.max(mx, Math.abs(s[i])); }
    for (let i = 0; i < n; i++) s[i] *= 0.3 / mx;
    return s;
}

export const WHISTLE = [1, 0.04, 0.01];
export const VOICE_H2 = [0.25, 1, 0.3, 0.2, 0.15, 0.1, 0.05];
export const VOICE_RICH = [1, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05, 0.03];
