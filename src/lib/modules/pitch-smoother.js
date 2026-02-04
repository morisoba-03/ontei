// PitchSmoother: median + hysteresis + deadband
// Keeps low-GC by reusing buffers. ESM module.

export class PitchSmoother {
  constructor({ windowSize = 5, deadbandCents = 6, riseCents = 30, fallCents = 40 } = {}) {
    this.N = windowSize | 0;
    if (this.N < 1) this.N = 1;
    this.deadband = deadbandCents;
    this.rise = riseCents;
    this.fall = fallCents;
    this.buf = new Float32Array(this.N);
    this.len = 0;
    this.idx = 0;
    this.last = 0;
    this.has = false;
  }

  reset() {
    this.len = 0; this.idx = 0; this.last = 0; this.has = false;
  }

  // Push new frequency in Hz with optional confidence 0..1.
  // Returns the smoothed frequency (Hz). If not enough data, returns raw.
  push(freq, conf = 1) {
    if (!(freq > 0)) { return this.has ? this.last : 0; }
    this.buf[this.idx] = freq;
    this.idx = (this.idx + 1) % this.N;
    if (this.len < this.N) this.len++;

    // median (copy to temp array only N<=11 small)
    let tmp = [];
    for (let i = 0; i < this.len; i++) tmp.push(this.buf[i]);
    tmp.sort((a, b) => a - b);
    const med = tmp[(this.len - 1) >> 1];

    let out = med;
    if (this.has) {
      // deadband around last
      const cents = 1200 * Math.log2(out / this.last);
      const db = this.deadband * (0.6 + 0.4 * conf); // smaller with higher conf
      if (Math.abs(cents) < db) out = this.last;

      // hysteresis for note changes: larger threshold when falling (to avoid octave flips)
      const upr = this.rise * (0.8 + 0.4 * (1 - conf));
      const dwr = this.fall * (0.8 + 0.4 * (1 - conf));
      if (cents > 0 && cents < upr) out = this.last;
      else if (cents < 0 && -cents < dwr) out = this.last;

      // clamp max step per frame (safety)
      const maxStep = Math.max(20, 50 * conf); // cents per update
      const maxMul = Math.pow(2, maxStep / 1200);
      const hi = this.last * maxMul;
      const lo = this.last / maxMul;
      if (out > hi) out = hi; else if (out < lo) out = lo;
    }

    this.last = out; this.has = true;
    return out;
  }
}
