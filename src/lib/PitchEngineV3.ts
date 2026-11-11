/**
 * PitchEngineV3 — 高精度・オクターブ頑健な音程検出エンジン（口笛メイン／歌声も可）
 *
 * 外部ライブラリ非依存。1 フレームあたり FFT 2 回（4096 点）で完結する。
 *
 * ── 仕組み（5 段構成） ───────────────────────────────────────────────
 *  1. 周期性（時間領域）: McLeod 法の NSDF を FFT で厳密計算し、周期候補を得る。
 *  2. 倍音の整合（周波数領域）: Hann 窓スペクトルで「候補 c の倍音列がどれだけ
 *     エネルギーを説明するか」E(c) を測り、
 *       - c が高すぎ（本当は c/2）→ c/2 の奇数倍音を取りこぼす → E(c)/E(c/2) が小さい
 *       - c が低すぎ（本当は 2c, 3c）→ 2c だけで説明できてしまう → E(2c)/E(c) ≒ 1
 *     の 2 方向からオクターブ（と 12 度）違いを判定する。
 *     時間領域と周波数領域という独立した 2 つの証拠を突き合わせるのが要点。
 *  3. 時間方向の追跡: 候補列に対する前向きビタビ。オクターブ/12 度の飛びには
 *     追加コストを課すので、一瞬だけ現れる誤候補には乗り換えない。
 *     一方、旧音程の候補が消えた本物の跳躍は遅延ゼロで採用される。
 *  4. 高精度化: 確定した周期の 2 倍・4 倍…のラグで NSDF ピークを取り直し、
 *     多周期にわたって平均した周期を使う（高音の口笛でも 1 セント未満）。
 *  5. 無音・つなぎ: RMS ゲートと短時間ホールド（既存 v1/v2 と同じ仕様）。
 *
 * 「演奏者がガイドと違うオクターブで吹いている」ことへの対応（正解扱い）は
 * 検出とは別問題なので、OctaveFolder として分離してある。
 */

export interface V3Result {
    freq: number;
    conf: number;
    held?: boolean;
}

export interface V3Options {
    minRms?: number;
    externalRms?: number;
}

const F_MIN = 60;
const F_MAX = 4500;
const CLARITY_MIN = 0.4;      // これ未満は「音程なし」
const MPM_K = 0.85;           // 最初に採るピークの相対しきい値（スペクトル検証があるので MPM 標準 0.9 より緩め）
const VALID_K = 0.8;          // 候補として有効とみなす NSDF 相対値
const HOLD_CONF = 0.55;
const SPEC_CHECK_MIN_HZ = 240; // これ未満の候補は「高すぎ」検証を省く（c/2 の櫛が密になり無意味なため）
const LOBE_HW = 3;            // Hann 主ローブの半幅（2W 点 FFT のビン数）
const MAX_HARM = 12;
const HARM_MAX_HZ = 12000;

// 前向きビタビの遷移コスト（単位: nat）
const TRANS_PER_OCT = 0.6;
const TRANS_OCTAVE_LIKE = 0.9; // 12 / 19 / 24 半音ちょうどの飛びへの追加コスト

function smoothstep(x: number, lo: number, hi: number): number {
    if (x <= lo) return 0;
    if (x >= hi) return 1;
    const t = (x - lo) / (hi - lo);
    return t * t * (3 - 2 * t);
}

/** この sampleRate / バッファ長で v3 が実際に使う解析窓の長さ（サンプル数） */
export function v3WindowSamples(sampleRate: number, bufLen: number): number {
    let w = 1;
    while (w < sampleRate * 0.04) w <<= 1; // 約 40ms 以上の 2 のべき（44.1k/48k → 2048）
    while (w > bufLen) w >>= 1;
    return Math.max(256, w);
}

class FFT {
    readonly n: number;
    private cos: Float64Array;
    private sin: Float64Array;
    private rev: Uint32Array;

    constructor(n: number) {
        this.n = n;
        this.cos = new Float64Array(n / 2);
        this.sin = new Float64Array(n / 2);
        for (let i = 0; i < n / 2; i++) {
            this.cos[i] = Math.cos((2 * Math.PI * i) / n);
            this.sin[i] = Math.sin((2 * Math.PI * i) / n);
        }
        this.rev = new Uint32Array(n);
        let bits = 0;
        while (1 << bits < n) bits++;
        for (let i = 0; i < n; i++) {
            let r = 0;
            for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
            this.rev[i] = r;
        }
    }

    /** in-place 順変換（正規化なし） */
    forward(re: Float64Array, im: Float64Array) {
        const n = this.n;
        const rev = this.rev;
        for (let i = 0; i < n; i++) {
            const j = rev[i];
            if (j > i) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (let size = 2; size <= n; size <<= 1) {
            const half = size >> 1;
            const step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0, k = 0; j < half; j++, k += step) {
                    const wr = this.cos[k];
                    const wi = -this.sin[k];
                    const a = i + j;
                    const b = a + half;
                    const xr = re[b] * wr - im[b] * wi;
                    const xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                }
            }
        }
    }
}

interface Cand {
    freq: number;
    lag: number;
    clarity: number;
    p: number;
    cost: number;
}

export class PitchEngineV3 {
    private sr = 0;
    private W = 0;
    private N = 0;
    private fft: FFT | null = null;
    private x = new Float64Array(0);
    private re = new Float64Array(0);
    private im = new Float64Array(0);
    private pw = new Float64Array(0);   // Hann 窓パワースペクトル（0..N/2）
    private nsdf = new Float64Array(0); // 0..W/2
    private stamp = new Int32Array(0);
    private stampGen = 0;

    private prev: Cand[] = [];
    private last = 0;
    private holdLeft = 0;
    private silence = 0;
    private maxHold = 6;

    setAnalysisRate(hz: number, holdMs?: number) {
        const dur = holdMs !== undefined ? holdMs / 1000 : 0.2;
        this.maxHold = Math.max(3, Math.round(hz * dur));
    }

    reset() {
        this.prev = [];
        this.last = 0;
        this.holdLeft = 0;
        this.silence = 0;
    }

    private configure(sampleRate: number, bufLen: number) {
        const W = v3WindowSamples(sampleRate, bufLen);
        if (W === this.W && sampleRate === this.sr) return;
        this.sr = sampleRate;
        this.W = W;
        this.N = W * 2;
        this.fft = new FFT(this.N);
        this.x = new Float64Array(W);
        this.re = new Float64Array(this.N);
        this.im = new Float64Array(this.N);
        this.pw = new Float64Array(this.N / 2 + 1);
        this.nsdf = new Float64Array(W / 2 + 1);
        this.stamp = new Int32Array(this.N / 2 + 1);
        this.reset();
    }

    private hold(): V3Result {
        if (this.holdLeft > 0 && this.last > 0) {
            this.holdLeft--;
            return { freq: this.last, conf: HOLD_CONF, held: true };
        }
        this.prev = [];
        return { freq: 0, conf: 0 };
    }

    analyze(buf: Float32Array, sampleRate: number, options: V3Options = {}): V3Result {
        this.configure(sampleRate, buf.length);
        const { W, N, x, re, im, pw, nsdf } = this;
        const sr = this.sr;

        // ── 0. 最新 W サンプルを取り出し DC を除去 ──
        const off = buf.length - W;
        let mean = 0;
        for (let i = 0; i < W; i++) mean += buf[off + i];
        mean /= W;
        let energy = 0;
        for (let i = 0; i < W; i++) {
            const v = buf[off + i] - mean;
            x[i] = v;
            energy += v * v;
        }

        // ── 1. 無音ゲート ──
        const rms = options.externalRms !== undefined && options.externalRms >= 0
            ? options.externalRms
            : Math.sqrt(energy / W);
        if (rms < (options.minRms ?? 0.01) || energy <= 1e-12) {
            this.silence++;
            if (this.silence > 5) {
                this.reset();
                return { freq: 0, conf: 0 };
            }
            return this.hold();
        }
        this.silence = 0;

        // ── 2. FFT（矩形窓・2 倍ゼロ詰め）→ Hann 窓スペクトルと自己相関を同時に得る ──
        re.fill(0); im.fill(0);
        for (let i = 0; i < W; i++) re[i] = x[i];
        this.fft!.forward(re, im);

        // 長さ W の Hann 窓は、2W 点 FFT 上では ±2 ビンの畳み込みに等しい
        const half = N / 2;
        const mask = N - 1;
        for (let k = 0; k <= half; k++) {
            const a = (k - 2) & mask;
            const b = (k + 2) & mask;
            const wr = 0.5 * re[k] - 0.25 * (re[a] + re[b]);
            const wi = 0.5 * im[k] - 0.25 * (im[a] + im[b]);
            pw[k] = wr * wr + wi * wi;
        }

        // 自己相関 = IFFT(|X|^2)。実・偶対称なので順変換をそのまま使える
        for (let k = 0; k < N; k++) {
            re[k] = re[k] * re[k] + im[k] * im[k];
            im[k] = 0;
        }
        this.fft!.forward(re, im);

        // ── 3. NSDF（McLeod）: n(τ) = 2 r(τ) / m(τ) ──
        const maxLag = W / 2;
        let m = 2 * (re[0] / N);
        nsdf[0] = 1;
        for (let tau = 1; tau <= maxLag; tau++) {
            const a = x[tau - 1];
            const b = x[W - tau];
            m -= a * a + b * b;
            nsdf[tau] = m > 1e-12 ? (2 * (re[tau] / N)) / m : 0;
        }

        // ── 4. NSDF のキー極大から一次候補 c0 を決める ──
        const lagMin = Math.max(2, Math.floor(sr / F_MAX));
        const lagMax = Math.min(maxLag - 1, Math.ceil(sr / F_MIN));
        let t = 1;
        while (t < lagMax && nsdf[t] > 0) t++; // 最初の負への零交差まで飛ばす
        let nMax = 0;
        let firstLag = 0;
        const peakLags: number[] = [];
        const peakVals: number[] = [];
        while (t < lagMax) {
            while (t < lagMax && nsdf[t] <= 0) t++;
            let best = -1;
            let bestV = 0;
            while (t < lagMax && nsdf[t] > 0) {
                if (nsdf[t] > bestV && t >= lagMin) { bestV = nsdf[t]; best = t; }
                t++;
            }
            if (best > 0 && nsdf[best] >= nsdf[best - 1] && nsdf[best] >= nsdf[best + 1]) {
                peakLags.push(best);
                peakVals.push(bestV);
                if (bestV > nMax) nMax = bestV;
            }
        }
        if (nMax < CLARITY_MIN) return this.hold();
        for (let i = 0; i < peakLags.length; i++) {
            if (peakVals[i] >= MPM_K * nMax) { firstLag = peakLags[i]; break; }
        }
        const lag0 = this.peakNear(firstLag, 1).lag;

        // ── 5. 候補集合: c0 とその整数比（上下のオクターブ・12 度）、最強スペクトルピーク ──
        const cands: Cand[] = [];
        const addCand = (lagGuess: number) => {
            if (!(lagGuess >= lagMin && lagGuess <= lagMax)) return;
            const win = Math.max(1, Math.round(lagGuess * 0.06));
            const pk = this.peakNear(lagGuess, win);
            const f = sr / pk.lag;
            if (f < F_MIN || f > F_MAX) return;
            for (const c of cands) if (Math.abs(Math.log2(c.freq / f)) < 0.03) return;
            cands.push({ freq: f, lag: pk.lag, clarity: pk.val, p: 0, cost: 0 });
        };
        addCand(lag0);
        addCand(lag0 * 2);
        addCand(lag0 * 3);
        addCand(lag0 / 2);
        addCand(lag0 / 3);
        {
            const df = sr / N;
            const k0 = Math.ceil(F_MIN / df);
            const k1 = Math.min(half - 1, Math.floor(F_MAX / df));
            let bk = k0;
            for (let k = k0; k <= k1; k++) if (pw[k] > pw[bk]) bk = k;
            addCand(sr / (bk * df));
        }

        // ── 6. 各候補を「周期性 × 倍音の整合」で採点 ──
        let best: Cand | null = null;
        for (const c of cands) {
            const valid = c.clarity >= VALID_K * nMax;
            const eC = this.explained(c.freq);

            // 高すぎ検証: 本当の基音が c/2, c/3 なら、c はその奇数倍音を取りこぼす
            let upOk = 1;
            if (c.freq >= SPEC_CHECK_MIN_HZ) {
                upOk = Math.min(
                    smoothstep(eC / (this.explained(c.freq / 2) + 1e-30), 0.6, 0.85),
                    c.freq / 3 >= SPEC_CHECK_MIN_HZ / 2
                        ? smoothstep(eC / (this.explained(c.freq / 3) + 1e-30), 0.6, 0.85)
                        : 1
                );
            }

            // 低すぎ検証: 2c や 3c だけでほぼ全部説明でき、かつそれ自体が周期として成立するなら c は低すぎ
            let subLike = 0;
            for (const mul of [2, 3, 5]) {
                const f2 = c.freq * mul;
                if (f2 > F_MAX) continue;
                const n2 = this.valueAt(c.lag / mul);
                if (n2 < VALID_K * nMax) continue;
                subLike = Math.max(subLike, smoothstep(this.explained(f2) / (eC + 1e-30), 0.75, 0.92));
            }
            const downOk = 1 - 0.92 * subLike;

            c.p = Math.max(0, c.clarity) * (valid ? 1 : 0.25) * (0.08 + 0.92 * upOk) * downOk;
        }

        // ── 7. 前向きビタビ（遅延ゼロ） ──
        for (const c of cands) {
            const obs = -Math.log(Math.max(c.p, 1e-3));
            let trans = 0;
            if (this.prev.length > 0) {
                trans = Infinity;
                for (const a of this.prev) {
                    const d = Math.abs(12 * Math.log2(c.freq / a.freq));
                    let cost = TRANS_PER_OCT * Math.min(d, 24) / 12;
                    if (Math.abs(d - 12) < 0.7 || Math.abs(d - 19) < 0.7 || Math.abs(d - 24) < 0.7) cost += TRANS_OCTAVE_LIKE;
                    const total = a.cost + cost;
                    if (total < trans) trans = total;
                }
            }
            c.cost = obs + trans;
            if (!best || c.cost < best.cost) best = c;
        }
        if (!best || best.p < 0.05) return this.hold();
        const base = best.cost;
        for (const c of cands) c.cost = Math.min(c.cost - base, 6); // 正規化＋上限（古い履歴に縛られすぎない）
        this.prev = cands;

        // ── 8. 多周期ラグで周期を精密化 ──
        let lag = best.lag;
        let mult = 1;
        const refV = best.clarity;
        while (lag * mult * 2 <= maxLag - 2) {
            const target = lag * mult * 2;
            const win = Math.max(1, Math.floor(lag * 0.25));
            const pk = this.peakNear(target, win);
            if (!pk.interior || pk.val < 0.8 * refV) break;
            mult *= 2;
            lag = pk.lag / mult;
        }
        const freq = sr / lag;
        if (!(freq >= F_MIN && freq <= F_MAX)) return this.hold();

        this.last = freq;
        this.holdLeft = this.maxHold;
        const conf = Math.max(0, Math.min(1, best.clarity * (0.5 + 0.5 * Math.min(1, best.p / Math.max(best.clarity, 1e-6)))));
        return { freq, conf };
    }

    /** 整数ラグ center±win の NSDF 最大点を放物線補間で返す */
    private peakNear(center: number, win: number): { lag: number; val: number; interior: boolean } {
        const nsdf = this.nsdf;
        const hi = nsdf.length - 2;
        const c = Math.round(center);
        const a = Math.max(1, c - win);
        const b = Math.min(hi, c + win);
        if (a > b) return { lag: center, val: this.valueAt(center), interior: false };
        let k = a;
        for (let i = a; i <= b; i++) if (nsdf[i] > nsdf[k]) k = i;
        const y0 = nsdf[k - 1], y1 = nsdf[k], y2 = nsdf[k + 1];
        if (y1 < y0 || y1 < y2) {
            // 範囲の端で単調 → 本当の極大ではない。指定ラグの値を返す
            return { lag: center, val: this.valueAt(center), interior: false };
        }
        const den = y0 - 2 * y1 + y2;
        const d = den < -1e-12 ? (0.5 * (y0 - y2)) / den : 0;
        return { lag: k + d, val: y1 - 0.25 * (y0 - y2) * d, interior: true };
    }

    /** 実数ラグでの NSDF 値（線形補間） */
    private valueAt(lag: number): number {
        const nsdf = this.nsdf;
        if (lag < 1 || lag >= nsdf.length - 1) return 0;
        const i = Math.floor(lag);
        const f = lag - i;
        return nsdf[i] * (1 - f) + nsdf[i + 1] * f;
    }

    /** 基音 f の倍音列（各倍音の主ローブ）が占めるパワーの合計。重複ビンは 1 回だけ数える */
    private explained(f: number): number {
        const pw = this.pw;
        const stamp = this.stamp;
        const df = this.sr / this.N;
        const half = this.N / 2;
        const gen = ++this.stampGen;
        const fTop = Math.min(this.sr / 2 - df * 4, HARM_MAX_HZ);
        let sum = 0;
        for (let h = 1; h <= MAX_HARM; h++) {
            const fh = f * h;
            if (fh > fTop) break;
            const kc = Math.round(fh / df);
            // 候補周波数の誤差ぶんだけ近傍で実ピークを探す
            const tol = 1 + Math.floor(0.012 * kc);
            let kp = kc;
            for (let k = Math.max(1, kc - tol); k <= Math.min(half - 1, kc + tol); k++) if (pw[k] > pw[kp]) kp = k;
            for (let k = Math.max(1, kp - LOBE_HW); k <= Math.min(half, kp + LOBE_HW); k++) {
                if (stamp[k] !== gen) { stamp[k] = gen; sum += pw[k]; }
            }
        }
        return sum;
    }
}

/**
 * OctaveFolder — 「ガイドと違うオクターブで演奏しても、音名が合っていれば正解」にするための層。
 *
 * 検出した周波数を、ガイドに最も近いオクターブへ折り返す（±3 オクターブまで）。
 *  - 境界（ガイドから±6 半音付近）で上下にばたつかないようヒステリシスを持つ。
 *  - ガイドが無い瞬間（休符・ノートの隙間）は直前のオクターブ差を維持し、線が飛ばないようにする。
 * 折り返す前の実音（rawFreq）と、何オクターブ動かしたか（octaveShift）も返す。
 */
export class OctaveFolder {
    private shift = 0;
    private has = false;
    private framesNoGuide = 0;
    private keepFrames = 120;

    setAnalysisRate(hz: number) {
        this.keepFrames = Math.max(10, Math.round(hz * 2)); // ガイド無しで約 2 秒まで維持
    }

    reset() {
        this.shift = 0;
        this.has = false;
        this.framesNoGuide = 0;
    }

    fold(freq: number, guideFreq: number): { freq: number; octaveShift: number } {
        if (!(freq > 0)) return { freq, octaveShift: 0 };
        if (guideFreq > 0) {
            this.framesNoGuide = 0;
            const exact = Math.log2(guideFreq / freq);
            let k = Math.round(exact);
            // ヒステリシス: 直前のシフトのままでも 6.9 半音以内なら変えない
            if (this.has && Math.abs(exact - this.shift) <= 0.575) k = this.shift;
            k = Math.max(-3, Math.min(3, k));
            this.shift = k;
            this.has = true;
        } else {
            this.framesNoGuide++;
            if (this.framesNoGuide > this.keepFrames) this.reset();
        }
        const k = this.has ? this.shift : 0;
        return { freq: freq * Math.pow(2, k), octaveShift: k };
    }
}
