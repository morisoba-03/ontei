// MicRunner: fetch time-domain frames for processors. ESM module.
// Uses AnalyserNode fallback. Optionally ScriptProcessor if needed by host.

export class MicRunner {
  constructor({ frameSize = 2048, analysisRate = 120 } = {}) {
    this.frameSize = frameSize | 0;
    this.analysisRate = analysisRate | 0;
    this.ctx = null;
    this.analyser = null;
    this.src = null;
    this.timer = 0;
    this.buffer = new Float32Array(this.frameSize);
    this.onFrame = null; // (Float32Array, sampleRate) => void
  }

  async start() {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = this.frameSize; // time-domain length
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    this.src = src; this.analyser = analyser;

    const interval = Math.max(1, Math.floor(1000 / Math.max(1, this.analysisRate)));
    const tick = () => {
      try {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(this.buffer);
        if (this.onFrame) this.onFrame(this.buffer, this.ctx.sampleRate);
      } catch (_) { /* ignore */ }
    };
    this.timer = setInterval(tick, interval);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    if (this.src) { try { this.src.disconnect(); } catch (_) {} this.src = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch (_) {} this.analyser = null; }
    if (this.ctx) { try { this.ctx.close(); } catch (_) {} this.ctx = null; }
  }
}
