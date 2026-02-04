// PitchOverlay: draw current pitch info on a canvas context

export class PitchOverlay {
  constructor({ getNoteLabel, getOctave, getMidi, color = 'rgba(240,70,70,0.9)' } = {}) {
    this.getNoteLabel = getNoteLabel || ((m) => m.toFixed(2));
    this.getOctave = getOctave || ((m) => Math.floor(m / 12) - 1);
    this.getMidi = getMidi || ((hz, A4) => 69 + 12 * Math.log2(hz / A4));
    this.color = color;
    this.lastText = '';
  }

  draw(ctx, hz, A4, x = 10, y = 16) {
    if (!(ctx && hz > 0)) return;
    const midi = this.getMidi(hz, A4);
    const label = this.getNoteLabel(midi);
    const oct = this.getOctave(midi);
    const txt = `${label}${oct >= 0 ? oct : ''}`;
    if (txt !== this.lastText) this.lastText = txt;
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.font = 'bold 13px system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textBaseline = 'top';
    ctx.fillText(txt, x, y);
    ctx.restore();
  }
}
