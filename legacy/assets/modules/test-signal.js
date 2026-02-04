// Optional: generate test tones and sweeps to validate tracker

export function sine(f, sr, t) {
  return Math.sin(2 * Math.PI * f * t);
}

export function genFrameSine(freq, sr, N) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return out;
}

export function genSweep(f0, f1, durSec, sr, N) {
  // Log sweep
  const out = new Float32Array(N);
  const k = Math.pow(f1 / f0, 1 / (durSec * sr));
  let f = f0;
  let phase = 0;
  for (let i = 0; i < N; i++) {
    out[i] = Math.sin(phase);
    phase += 2 * Math.PI * f / sr;
    f *= k;
  }
  return out;
}
