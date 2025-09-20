// YinPitchTracker: YIN/CMNDF + Hann window + parabolic interpolation
// ESM module, no external deps. Designed for reuse and low-GC.

export class YinPitchTracker {
  constructor({ sampleRate, frameSize = 2048, fmin = 65, fmax = 2000, threshold = 0.15 } = {}) {
    this.sampleRate = sampleRate || 44100;
    this.frameSize = frameSize | 0;
    this.fmin = fmin;
    this.fmax = fmax;
    this.threshold = threshold; // CMNDF valley threshold (0..1, lower is stricter)

    // Buffers (reused)
    this._hann = new Float32Array(this.frameSize);
    for (let n = 0; n < this.frameSize; n++) {
      this._hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (this.frameSize - 1)));
    }
    this._frame = new Float32Array(this.frameSize);
    this._diff = new Float32Array(this.frameSize);
    this._cmnd = new Float32Array(this.frameSize);
  }

  setSampleRate(sr) {
    this.sampleRate = sr | 0;
  }

  setFrameSize(N) {
    if (N === this.frameSize) return;
    this.frameSize = N | 0;
    this._hann = new Float32Array(this.frameSize);
    for (let n = 0; n < this.frameSize; n++) {
      this._hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (this.frameSize - 1)));
    }
    this._frame = new Float32Array(this.frameSize);
    this._diff = new Float32Array(this.frameSize);
    this._cmnd = new Float32Array(this.frameSize);
  }

  // Input: Float32Array time-domain frame (length == frameSize)
  // Output: { freq: Hz or 0 if unvoiced, tau: float, conf: 0..1 }
  process(input) {
    const N = this.frameSize;
    if (!input || input.length < N) return { freq: 0, tau: -1, conf: 0 };

    // DC removal + window
    let mean = 0;
    for (let i = 0; i < N; i++) mean += input[i];
    mean /= N;
    const x = this._frame;
    const w = this._hann;
    for (let i = 0; i < N; i++) x[i] = (input[i] - mean) * w[i];

    // YIN difference function d(tau)
    const diff = this._diff;
    diff[0] = 0;
    for (let tau = 1; tau < N; tau++) {
      let sum = 0;
      const nmax = N - tau;
      for (let n = 0; n < nmax; n++) {
        const d = x[n] - x[n + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // Cumulative mean normalized difference CMND
    const cmnd = this._cmnd;
    cmnd[0] = 1;
    let cumsum = 0;
    for (let tau = 1; tau < N; tau++) {
      cumsum += diff[tau];
      cmnd[tau] = diff[tau] * tau / (cumsum || 1);
    }

    // Search tau in [tauMin, tauMax] by threshold crossing of CMND
    const tauMin = Math.max(2, Math.floor(this.sampleRate / Math.min(this.fmax, this.sampleRate * 0.49)));
    const tauMax = Math.min(N - 3, Math.floor(this.sampleRate / Math.max(1, this.fmin)));
    let tau = -1;
    let minV = Infinity, minIdx = -1;
    let localMinIdx = -1, localMinVal = Infinity;
    for (let t = tauMin; t <= tauMax; t++) {
      const v = cmnd[t];
      if (v < minV) { minV = v; minIdx = t; }
      // 局所最小の検出（近傍比較）
      if (t > tauMin && t + 1 < N) {
        const v0 = cmnd[t - 1], v1 = cmnd[t], v2 = cmnd[t + 1];
        if (v1 <= v0 && v1 <= v2 && v1 < localMinVal) { localMinVal = v1; localMinIdx = t; }
      }
      if (v < this.threshold && (t + 1 < N)) { tau = t; break; }
    }
    if (tau < 0) tau = (localMinIdx > 0 ? localMinIdx : minIdx); // 局所最小優先
    if (!(tau > 0)) return { freq: 0, tau: -1, conf: 0 };

    // Parabolic interpolation around tau
    let estTau = tau;
    if (tau > tauMin && tau + 1 < N) {
      const ym1 = cmnd[tau - 1];
      const y0 = cmnd[tau];
      const yp1 = cmnd[tau + 1];
      const denom = (ym1 - 2 * y0 + yp1);
      if (Math.abs(denom) > 1e-12) {
        const delta = 0.5 * (ym1 - yp1) / denom;
        if (Math.abs(delta) <= 1) estTau = tau + delta;
      }
    }

    const freq = this.sampleRate / estTau;

    // Confidence: 1 - CMND at tau, mapped to 0..1
    const raw = 1 - Math.min(1, Math.max(0, cmnd[Math.round(tau)] || 1));
    // Sharpen confidence by penalizing near-border taus
    const band = (tau - tauMin) / Math.max(1, tauMax - tauMin);
    const edgePenalty = (band < 0.03 || band > 0.97) ? 0.15 : 0;
    const conf = Math.max(0, Math.min(1, raw - edgePenalty));

    if (!(freq > 0) || !Number.isFinite(freq)) return { freq: 0, tau: -1, conf: 0 };
    return { freq, tau: estTau, conf };
  }
}
