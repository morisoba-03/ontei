
import type { AudioEngineState } from './types';

// Helper functions
function noteLabel(midi: number, type: 'alphabet' | 'katakana' = 'alphabet'): string {
    const namesAlpha = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const namesKata = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

    const m = Math.round(midi);
    const oct = Math.floor(m / 12) - 1;
    const pc = ((m % 12) + 12) % 12;

    const name = type === 'katakana' ? namesKata[pc] : namesAlpha[pc];
    return name + oct;
}

function getPlayX(width: number): number {
    const w = Math.max(0, width | 0);
    return Math.round(Math.max(60, Math.min(w - 80, w * 0.33)));
}



export class Visualizer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    pxPerPitch: number = 20;

    // Particle System
    private particles: {
        x: number; y: number;
        vx: number; vy: number;
        color: string;
        life: number;
        maxLife: number;
        size: number;
    }[] = [];
    private lastPhraseId: string | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get 2d context");
        this.ctx = ctx;
    }

    private spawnParticles(x: number, y: number, count: number, colors: string[]) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 4;
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1.0,
                maxLife: 1.0,
                size: 2 + Math.random() * 3
            });
        }
    }

    private updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02; // Fade out
            p.vy += 0.1; // Gravity (optional)

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    private drawVibratoIndicators(
        ctx: CanvasRenderingContext2D,
        pts: { t: number; midi: number; conf: number; freq: number }[],
        _state: AudioEngineState,
        playX: number,
        pxSemi: number,
        vmin: number,
        h: number,
        w: number,
        eff: number,
        pxPerSec: number,
        tempoFactor: number
    ) {
        // Detect vibrato patterns: oscillating pitch with frequency 4-8 Hz and amplitude 0.2-1 semitones
        const minVibratoFreq = 4; // Hz
        const maxVibratoFreq = 8; // Hz
        const minVibratoAmp = 0.15; // semitones
        const maxVibratoAmp = 1.5; // semitones
        const windowSize = 15; // samples to analyze

        if (pts.length < windowSize * 2) return;

        ctx.save();

        // Analyze pitch oscillation in sliding windows
        for (let i = windowSize; i < pts.length - windowSize; i++) {
            const window = pts.slice(i - windowSize, i + windowSize);

            // Calculate mean pitch
            const meanMidi = window.reduce((sum, p) => sum + p.midi, 0) / window.length;

            // Calculate deviations from mean
            const deviations = window.map(p => p.midi - meanMidi);

            // Count zero crossings (oscillation indicator)
            let zeroCrossings = 0;
            for (let j = 1; j < deviations.length; j++) {
                if (deviations[j] * deviations[j - 1] < 0) zeroCrossings++;
            }

            // Calculate amplitude (peak-to-peak / 2)
            const maxDev = Math.max(...deviations);
            const minDev = Math.min(...deviations);
            const amplitude = (maxDev - minDev) / 2;

            // Estimate frequency from zero crossings
            const windowDuration = window[window.length - 1].t - window[0].t;
            const estimatedFreq = windowDuration > 0 ? zeroCrossings / (2 * windowDuration) : 0;

            // Check if this is vibrato
            const isVibrato =
                estimatedFreq >= minVibratoFreq &&
                estimatedFreq <= maxVibratoFreq &&
                amplitude >= minVibratoAmp &&
                amplitude <= maxVibratoAmp;

            if (isVibrato && i % 10 === 0) { // Draw every 10th point to avoid clutter
                const p = pts[i];
                const x = playX + ((p.t - eff) * pxPerSec / tempoFactor);
                const y = h - (meanMidi - vmin + 1) * pxSemi;

                if (x >= 0 && x <= w) {
                    // Draw vibrato wave indicator
                    const waveWidth = 20;
                    const waveHeight = amplitude * pxSemi * 0.5;

                    ctx.beginPath();
                    ctx.strokeStyle = '#FF69B4'; // Hot pink
                    ctx.lineWidth = 2;
                    ctx.globalAlpha = 0.7;

                    // Draw small sine wave
                    for (let wx = -waveWidth / 2; wx <= waveWidth / 2; wx += 2) {
                        const wy = Math.sin(wx * 0.5) * waveHeight;
                        if (wx === -waveWidth / 2) {
                            ctx.moveTo(x + wx, y + wy);
                        } else {
                            ctx.lineTo(x + wx, y + wy);
                        }
                    }
                    ctx.stroke();

                    // Draw small circle at center
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = '#FF69B4';
                    ctx.fill();
                }
            }
        }

        ctx.restore();
    }


    draw(state: AudioEngineState) {
        if (!this.ctx) return;
        const { width, height } = this.canvas;
        const w = width;
        const h = height;
        const ctx = this.ctx;

        // Calculate pxPerPitch based on verticalZoom
        const total = state.verticalZoom * 12;
        this.pxPerPitch = height / total;

        // Clear
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width, height);

        ctx.save();

        // 1. Grid
        this.drawGrid(state);
        this.drawBpmMarkers(state);
        this.drawLoopRegion(state);
        this.drawPhraseBoundaries(state);

        // Check for new phrase result
        if (state.lastPhraseResult && state.lastPhraseResult.phraseId !== this.lastPhraseId) {
            this.lastPhraseId = state.lastPhraseResult.phraseId;

            // Trigger Effect (if enabled)
            if (state.isParticlesEnabled) {
                const res = state.lastPhraseResult;
                const playX = getPlayX(width);
                const playY = height / 2;

                if (res.evaluation === 'Perfect') {
                    this.spawnParticles(playX, playY, 50, ['#FFD700', '#FFA500', '#FFFFFF', '#00FFFF']);
                } else if (res.evaluation === 'Good') {
                    this.spawnParticles(playX, playY, 20, ['#00FF00', '#AAFFAA', '#FFFFFF']);
                }
            }
        }

        this.updateParticles();

        const {
            isCalibrating, isPracticing, isPitchOnlyMode,
            playbackPosition, timelineOffsetSec, verticalOffset,
            tempoFactor, pxPerSec, guideLineWidth, showNoteNames,
            currentTracks, melodyTrackIndex, pitchHistory, midiGhostNotes,
            micRenderMode,
            toleranceCents
        } = state;

        // Common Metrics
        const playX = getPlayX(width);
        const eff = playbackPosition + timelineOffsetSec;
        const vmin = 36 + Math.round((132 - 36 - total) * (verticalOffset / 100));
        const pxSemi = this.pxPerPitch;

        const visMarginSec = 2.0;
        const visStart = eff - (playX / pxPerSec) * tempoFactor - visMarginSec;
        const visEnd = eff + ((w - playX) / pxPerSec) * tempoFactor + visMarginSec;

        // Draw Measure Lines
        const beatDur = 60 / (state.bpm || 120);
        const barDur = beatDur * 4;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const tStartVis = visStart;
        const tEndVis = visEnd;
        const barStartIdx = Math.floor(tStartVis / barDur);
        const barEndIdx = Math.ceil(tEndVis / barDur);

        for (let b = barStartIdx; b <= barEndIdx; b++) {
            if (b < 0) continue;
            const t = b * barDur;
            const x = playX + (t - eff) * pxPerSec / tempoFactor;
            if (x >= 0 && x <= w) {
                ctx.moveTo(x, 0); ctx.lineTo(x, h);
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillText(String(b + 1), x + 4, 10);
            }
        }
        ctx.stroke();
        ctx.restore();

        // Helper


        // Draw Melody Notes or Audio Pitch Curve
        if (!isCalibrating && currentTracks[melodyTrackIndex] && !isPitchOnlyMode) {
            const track = currentTracks[melodyTrackIndex];

            // Audio Track: Draw Pitch Curve (Orange)
            if (track.type === 'audio' && track.pitchData && track.pitchData.length > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = '#FFA500'; // Orange
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Optional: Shine
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#FFA500';

                let first = true;
                const data = track.pitchData;

                // Optimization: Binary search start index? Or simple loop with bounds check (data is sorted by time)
                // data is sorted by time.
                // Find first point > visStart
                // Simple skip loop for now (assuming not huge data for short clips, but for songs it might be large)
                // Let's optimize slightly:


                // Binary search or estimation could go here. For now simple scan to find start.
                // Actually, binary search is better if array is large.
                // data[i].time

                // Simple implementation:
                for (let i = 0; i < data.length; i++) {
                    const p = data[i];
                    if (p.time > visEnd) break;
                    if (p.time < visStart - 0.5) continue; // Buffer

                    const midi = 69 + 12 * Math.log2(p.freq / 440);
                    const y = h - (midi - vmin + 1) * pxSemi;
                    const x = playX + (p.time - eff) * pxPerSec / tempoFactor;

                    // Gap detection (if silence/break in extraction)
                    if (!first && i > 0) {
                        const prev = data[i - 1];
                        if (p.time - prev.time > 0.1) {
                            ctx.stroke();
                            ctx.beginPath();
                            first = true;
                        }
                    }

                    if (first) {
                        ctx.moveTo(x, y);
                        first = false;
                    } else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }
            // MIDI Track: Draw Note Rectangles
            else {
                ctx.lineWidth = guideLineWidth;
                ctx.strokeStyle = '#4e8cff';
                const notes = track.notes;

                for (const n of notes) {
                    if (n.time > visEnd) break;
                    if (n.time + n.duration < visStart) continue;
                    const x1 = playX + (n.time - eff) * pxPerSec / tempoFactor;
                    let x2 = playX + ((n.time + n.duration) - eff) * pxPerSec / tempoFactor;

                    // Visual Separation for adjacent notes (1px gap)
                    if (x2 - x1 > 3) {
                        x2 -= 1;
                    }

                    if (x2 < 0 || x1 > w) continue;

                    // Apply Octave Offset + Key Change
                    const dispMidi = n.midi + (state.guideOctaveOffset * 12) + state.transposeOffset;
                    const y = h - (dispMidi - vmin + 1) * pxSemi;

                    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();

                    // Separator Line (Vertical bar at end)
                    if (x2 - x1 > 5) { // Only if note is long enough
                        ctx.save();
                        ctx.lineWidth = 2; // Thicker
                        ctx.strokeStyle = '#ff0000'; // Red
                        ctx.globalAlpha = 1.0;
                        // Draw a vertical line matching note height
                        const hBar = pxSemi;
                        ctx.beginPath();
                        ctx.moveTo(x2, y - hBar / 2);
                        ctx.lineTo(x2, y + hBar / 2);
                        ctx.stroke();
                        ctx.restore();
                    }

                    // Selection Highlight
                    if (state.editTool !== 'view' && state.selectedNote === n) {
                        ctx.save();
                        ctx.strokeStyle = '#ffdd55';
                        ctx.lineWidth = guideLineWidth + 2;
                        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
                        // Resize handles
                        ctx.fillStyle = '#ffdd55';
                        ctx.beginPath(); ctx.arc(x1, y, 6, 0, Math.PI * 2); ctx.fill();
                        ctx.beginPath(); ctx.arc(x2, y, 6, 0, Math.PI * 2); ctx.fill();
                        ctx.restore();
                    }

                    // Tolerance lines
                    const dy = (toleranceCents / 100) * pxSemi;
                    if (dy > 0.2) {
                        ctx.save();
                        ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff';
                        ctx.beginPath(); ctx.moveTo(x1, y - dy); ctx.lineTo(x2, y - dy); ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(x1, y + dy); ctx.lineTo(x2, y + dy); ctx.stroke();
                        ctx.restore();
                    }

                    if (showNoteNames) {
                        ctx.font = '10px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        const lab = noteLabel(dispMidi);
                        ctx.fillText(lab, (x1 + x2) / 2, y - 8);
                    }
                }
            }
        }

        // Draw Ghost Notes
        if (Array.isArray(midiGhostNotes) && midiGhostNotes.length && (!isPitchOnlyMode || isPracticing)) {
            ctx.save();
            ctx.lineWidth = Math.max(2, guideLineWidth);
            ctx.lineWidth = Math.max(2, guideLineWidth);
            for (let i = 0; i < midiGhostNotes.length; i++) {
                const n = midiGhostNotes[i];
                if (n.role === 'resp' || n.role === 'calib') {
                    ctx.strokeStyle = '#4e8cff'; ctx.setLineDash([4, 4]);
                } else if (n.role === 'call') {
                    ctx.strokeStyle = '#ff5050'; ctx.setLineDash([]);
                } else if (n.role === 'practice') {
                    ctx.strokeStyle = '#ffb300'; ctx.lineWidth = Math.max(3, guideLineWidth); ctx.setLineDash([]);
                } else {
                    ctx.strokeStyle = 'rgba(255,80,80,0.9)'; ctx.setLineDash([6, 4]);
                }
                if (n.time + n.duration < visStart || n.time > visEnd) continue;
                const x1 = playX + (n.time - eff) * pxPerSec / tempoFactor;
                const x2 = playX + ((n.time + n.duration) - eff) * pxPerSec / tempoFactor;
                if (x2 < 0 || x1 > w) continue;

                const dispMidi = n.midi + (state.guideOctaveOffset * 12) + state.transposeOffset;
                const y = h - (dispMidi - vmin + 1) * pxSemi;

                ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();

                // Separator Line for Ghost Notes (Consecutive Same Pitch Only)
                // Check next note
                if (n.role === 'call') {
                    const nextNote = midiGhostNotes[i + 1];
                    // Condition: Next note exists, same MIDI, and starts relatively close (e.g. within 0.1s or touching)
                    // If visual gap is huge, no need for separator? User said "Looks like long tone", implies they are touching.
                    const isConsecutive = nextNote &&
                        nextNote.midi === n.midi &&
                        (nextNote.time - (n.time + n.duration) < 0.15); // tolerance for slight gaps

                    if (isConsecutive) {
                        ctx.save();
                        ctx.globalAlpha = 1.0;

                        // Height: Match Note Width (guideLineWidth)
                        const noteHeight = Math.max(2, guideLineWidth);
                        // Make it slightly thicker than note to be visible? Or same?
                        // User said "Visible". But "Same vertical width".
                        // Let's use same width but ensure it cuts clearly.
                        // Since note is red, separator should be different? User asked for Red separator before.
                        // "Red separator" on "Red Note" is invisible unless there is a gap or outline.
                        // User previously accepted "Black Outline + Red Line".
                        // Let's keep the high contrast style but restrict to consecutive.

                        const pad = 0; // No extra height
                        const hBar = noteHeight + pad;

                        // 1. Black Outline (Gap effect)
                        ctx.lineWidth = 3;
                        ctx.strokeStyle = '#000000';
                        ctx.beginPath();
                        ctx.moveTo(x2, y - hBar / 2);
                        ctx.lineTo(x2, y + hBar / 2);
                        ctx.stroke();

                        // 2. Red Line
                        ctx.lineWidth = 1.5;
                        ctx.strokeStyle = '#ff0000';
                        ctx.beginPath();
                        ctx.moveTo(x2, y - hBar / 2);
                        ctx.lineTo(x2, y + hBar / 2);
                        ctx.stroke();

                        ctx.restore();
                    }
                }

                if (n.role === 'call' || n.role === 'resp' || n.role === 'practice') {
                    try {
                        const lbl = n.label || noteLabel(Math.round(dispMidi));
                        ctx.save();
                        ctx.font = '12px sans-serif';
                        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                        const textX = (x1 + x2) / 2, textY = y - 6;
                        const tw = ctx.measureText(lbl).width;
                        ctx.fillStyle = 'rgba(0,0,0,0.6)';
                        ctx.fillRect(textX - tw / 2 - 4, textY - 16, tw + 8, 14);
                        if (n.role === 'practice') ctx.fillStyle = '#ffca28';
                        else ctx.fillStyle = (n.role === 'call') ? '#ffd27d' : '#d6f0ff';
                        ctx.fillText(lbl, textX, textY - 2);
                        ctx.restore();
                    } catch { /* ignore */ }
                }
            }
            ctx.restore();
        }

        // Draw Pitch History
        const allowDrawPitch = !isCalibrating;
        if (allowDrawPitch && pitchHistory && pitchHistory.length) {
            const getPitchVisOffsetSec = () => 0.05;
            const LAG_MS = Math.round((getPitchVisOffsetSec()) * 1000);
            const lag = LAG_MS / 1000;
            const drawUntil = (playbackPosition - lag);
            const A4Frequency = 440;

            const vmin = 36 + Math.round((132 - 36 - total) * (verticalOffset / 100));
            const vmax = vmin + total;

            const pts = [];
            for (const p of pitchHistory) {
                const t = p.time + ((p.visOff != null) ? (p.visOff - 0.05) : 0);
                if (t < visStart || t > visEnd) continue;
                if (t > drawUntil) continue;
                // if (isCallAt(t)) continue; // Allow drawing over guide notes

                const midi = (69 + 12 * Math.log2(Math.max(1e-9, p.freq) / A4Frequency));
                if (midi < vmin || midi > vmax) continue;
                pts.push({ t, midi, conf: p.conf, freq: p.freq });
            }

            if (micRenderMode === 'dot') {
                ctx.save();
                for (const p of pts) {
                    const y = h - (p.midi - vmin + 1) * pxSemi;
                    const x = playX + ((p.t - eff) * pxPerSec / tempoFactor);
                    if (x < 0 || x > w) continue;
                    ctx.beginPath();
                    ctx.arc(x, y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = '#00FFCC';
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#00FFCC';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1.5;
                    ctx.fill(); ctx.stroke();
                    ctx.shadowBlur = 0;
                }
                ctx.restore();
            } else {
                // Graph mode
                if (pts.length > 1) {
                    // Start Pitch Line
                    ctx.save();
                    ctx.beginPath();
                    ctx.strokeStyle = '#39FF14'; // Neon Green
                    ctx.lineWidth = 4;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.shadowBlur = 15;
                    ctx.shadowColor = '#39FF14';

                    let first = true;
                    // Draw loop with gap detection
                    for (let i = 0; i < pts.length; i++) {
                        const p = pts[i];
                        const y = h - (p.midi - vmin + 1) * pxSemi;
                        // Align with playhead: The user said "From the playline". 
                        // Logic: playX is where "now" is. 
                        // p.t is the timestamp of the pitch. eff is current playback time.
                        // x = playX + (p.t - eff) ...
                        // If p.t == eff, x = playX. So it aligns with playhead.
                        // However, pitch detection has latency (buffer size + viterbi lag).
                        // AudioEngine pushes with `now - vOff`.
                        // If we want to align "sound heard now" with "playhead", we might need to adjust.
                        // But strictly speaking, x calculation is correct for "time T is at position X".

                        const x = playX + ((p.t - eff) * pxPerSec / tempoFactor);

                        // optimization
                        if (x < -10) continue;
                        if (x > w + 10) break;

                        // Gap detection
                        if (i > 0) {
                            const prev = pts[i - 1];
                            const dt = p.t - prev.t;
                            // If gap > 0.1s (approx 2-3 frames at 20fps analysis), break line
                            if (dt > 0.12) {
                                ctx.stroke();
                                ctx.beginPath();
                                ctx.strokeStyle = '#39FF14';
                                ctx.lineWidth = 4;
                                ctx.shadowBlur = 15;
                                ctx.shadowColor = '#39FF14';
                                first = true;
                            }
                        }

                        if (first) { ctx.moveTo(x, y); first = false; }
                        else { ctx.lineTo(x, y); }

                    }
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // Vibrato Detection and Visualization
            if (pts.length > 20) {
                this.drawVibratoIndicators(ctx, pts, state, playX, pxSemi, vmin, h, w, eff, pxPerSec, tempoFactor);
            }
        }

        // Draw Live Pitch Cursor (Always, if signal present)
        if (state.currentMicPitch && state.currentMicConf && state.currentMicConf > 0.3) {
            const freq = state.currentMicPitch;
            const vmin = 36 + Math.round((132 - 36 - total) * (verticalOffset / 100));
            const A4Frequency = 440;
            const midi = 69 + 12 * Math.log2(freq / A4Frequency);

            if (midi >= vmin && midi <= vmin + total) {
                const y = h - (midi - vmin + 1) * pxSemi;

                ctx.save();
                ctx.beginPath();
                ctx.arc(playX, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = state.meterColor || '#00FFFF'; // Cyan or Green
                ctx.shadowBlur = 15;
                ctx.shadowColor = state.meterColor || '#00FFFF';
                ctx.strokeStyle = '#fff';

                // Pulsing effect?
                // const pulse = (performance.now() % 1000) / 1000;
                // ctx.lineWidth = 2 + pulse * 2;
                ctx.lineWidth = 2;

                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // Playhead
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(playX + 0.5, 0);
        ctx.lineTo(playX + 0.5, h);
        ctx.stroke();
        ctx.restore(); // Closes default ctx.save()

        // Piano Keys
        this.ctx.save();
        this.ctx.resetTransform();
        // this.drawPianoKeys(state); // Disabled
        this.ctx.restore();
    }

    drawPianoKeys(state: AudioEngineState) {
        if (!this.ctx) return;
        const { height } = this.canvas;
        const { verticalOffset, verticalZoom } = state;
        const keyWidth = 40;

        // Draw Background strip (White base for all keys to simulate "long" white keys)
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, 0, keyWidth, height);

        // Calc visible range
        const total = verticalZoom * 12;
        const min = 36;
        const maxDisplay = 132;
        const vmin = min + Math.round((maxDisplay - min - total) * (verticalOffset / 100));
        const vmax = vmin + total;

        const pxSemi = this.pxPerPitch;

        // Draw Black Keys on top
        this.ctx.textAlign = 'right';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = '10px sans-serif';

        for (let m = Math.floor(vmin); m <= Math.ceil(vmax); m++) {
            if (m < 0 || m > 127) continue;

            const y = height - (m - vmin + 1) * pxSemi;
            const isBlack = [1, 3, 6, 8, 10].includes(m % 12);

            // Separator lines for white keys (optional, but helps distinctness)
            if (!isBlack) {
                // Bottom edge of white key
                this.ctx.fillStyle = '#ccc';
                this.ctx.fillRect(0, y + pxSemi - 1, keyWidth, 1);
            }

            // Label C
            if (m % 12 === 0) {
                this.ctx.fillStyle = '#333';
                this.ctx.fillText('C' + (m / 12 - 1), keyWidth - 4, y + pxSemi / 2);
            }

            // Draw Black Key
            if (isBlack) {
                this.ctx.fillStyle = 'black';
                // Short black key (e.g. 60% width), aligned left
                this.ctx.fillRect(0, y, keyWidth * 0.6, pxSemi);

                // Border for pop
                this.ctx.strokeStyle = '#555';
                this.ctx.strokeRect(0, y, keyWidth * 0.6, pxSemi);
            }
        }

        // Key separator line (Right edge of keyboard)
        this.ctx.fillStyle = '#555';
        this.ctx.fillRect(keyWidth - 1, 0, 1, height);
    }

    private drawPhraseBoundaries(state: AudioEngineState) {
        if (!state.phrases || state.phrases.length === 0) return;

        const ctx = this.ctx;
        const { width, height } = this.canvas;
        const playX = getPlayX(width);
        const { playbackPosition, timelineOffsetSec, pxPerSec, tempoFactor } = state;
        const eff = playbackPosition + timelineOffsetSec;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        state.phrases.forEach(phrase => {
            // Draw End Time
            const t = phrase.endTime;
            const x = playX + (t - eff) * pxPerSec / tempoFactor;

            if (x >= 0 && x <= width) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    drawGrid(state: AudioEngineState) {
        if (!this.ctx) return;
        const { width, height } = this.canvas;
        const { timelineOffsetSec, verticalOffset, bpm, pxPerSec, verticalZoom } = state;

        // Font for labels
        this.ctx.font = '10px sans-serif';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'bottom';

        // Horizontal Lines (Pitch)
        const total = verticalZoom * 12;
        const min = 36;
        const maxDisplay = 132;
        const vmin = min + Math.round((maxDisplay - min - total) * (verticalOffset / 100));
        const vmax = vmin + total;
        const pxSemi = this.pxPerPitch;

        // Draw Grid Lines (No background fill)
        for (let m = Math.floor(vmin); m <= Math.ceil(vmax); m++) {
            const y = height - (m - vmin + 1) * pxSemi;

            // Grid line color
            const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
            const isC = (m % 12 === 0);

            this.ctx.beginPath();

            if (isC) {
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2; // Thicker line for Octave text
            } else if (!isBlack) {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                this.ctx.lineWidth = 1;
            } else {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
                this.ctx.lineWidth = 1;
            }

            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
            this.ctx.stroke();

            // Label C (Octave)
            if (isC) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                this.ctx.fillText('C' + (m / 12 - 1), 2, y - 2);
            }
        }

        // Vertical Lines (Time)
        const beatInterval = 60 / bpm;

        // Calculate visible time range based on playback position
        const playX = getPlayX(width);
        const eff = state.playbackPosition + timelineOffsetSec;
        // Inverse of x calculation: t = eff + (x - playX) * tempoFactor / pxPerSec
        // visible x from 0 to width
        const visStartT = eff + (0 - playX) * state.tempoFactor / pxPerSec;
        const visEndT = eff + (width - playX) * state.tempoFactor / pxPerSec;

        const startBeat = Math.floor(visStartT / beatInterval);
        const endBeat = Math.ceil(visEndT / beatInterval);

        for (let b = startBeat; b <= endBeat; b++) {
            const t = b * beatInterval;
            const x = playX + (t - eff) * pxPerSec / state.tempoFactor;

            if (b % 4 === 0) {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            } else {
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            }

            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }
    }

    // Coordinate Conversion for Interaction
    getQuantizedTimeMidi(x: number, y: number, state: AudioEngineState): { time: number, midi: number, exactTime: number, exactMidi: number } | null {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const {
            verticalZoom, verticalOffset,
            playbackPosition, timelineOffsetSec,
            pxPerSec, tempoFactor
        } = state;

        // Y -> MIDI
        const total = verticalZoom * 12;
        const min = 36;
        const maxDisplay = 132;
        const vmin = min + Math.round((maxDisplay - min - total) * (verticalOffset / 100));
        // y = h - (midi - vmin + 1) * pxSemi;
        // midi - vmin + 1 = (h - y) / pxSemi
        const pxSemi = h / total;
        const exactMidi = vmin - 1 + (h - y) / pxSemi;
        const roundMidi = Math.round(exactMidi);

        // X -> Time
        const playX = getPlayX(w);
        const eff = playbackPosition + timelineOffsetSec;
        // x = playX + (time - eff) * pxPerSec / tempoFactor
        // x - playX = (time - eff) * ppS / tF
        // (x - playX) * tF / ppS = time - eff
        const exactTime = eff + (x - playX) * tempoFactor / pxPerSec;

        // Simple quantization (16th note at 120bpm = 0.125s, varies by logic. Using fixed 0.1s snap for now as in legacy)
        const SNAP_SEC = 0.125;
        const roundTime = Math.round(exactTime / SNAP_SEC) * SNAP_SEC;

        return { time: roundTime, midi: roundMidi, exactTime, exactMidi };
    }

    getLoopHandleHit(x: number, y: number, state: AudioEngineState): 'start' | 'end' | null {
        if (!state.loopEnabled || y > 30) return null; // Handles are top 30px

        const { width } = this.canvas;
        const { timelineOffsetSec, playbackPosition, pxPerSec, tempoFactor } = state;
        const playX = getPlayX(width);
        const eff = playbackPosition + timelineOffsetSec;

        const xStart = playX + (state.loopStart - eff) * pxPerSec / tempoFactor;
        const xEnd = playX + (state.loopEnd - eff) * pxPerSec / tempoFactor;

        // Hit tolerance
        const TOL = 10;

        // Priority to END handle if close (to resize loop easily)
        if (Math.abs(x - xEnd) < TOL) return 'end';
        if (Math.abs(x - xStart) < TOL) return 'start';

        return null;
    }

    drawBpmMarkers(state: AudioEngineState) {
        if (!this.ctx || !state.tempoMap || state.tempoMap.length === 0) return;
        const { width, height } = this.canvas;
        const { timelineOffsetSec, playbackPosition, pxPerSec, tempoFactor } = state;

        const playX = getPlayX(width);
        const eff = playbackPosition + timelineOffsetSec;
        // inverse: t = eff + (x - playX) * tempoFactor / pxPerSec
        // we want x for t

        this.ctx.save();
        this.ctx.font = 'bold 12px sans-serif';
        this.ctx.textBaseline = 'top';

        for (const tm of state.tempoMap) {
            const x = playX + (tm.time - eff) * pxPerSec / tempoFactor;

            // Check visibility
            if (x < -50 || x > width + 50) continue;

            // Draw Marker Line
            this.ctx.beginPath();
            this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)'; // Gold
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();

            // Draw Label
            this.ctx.fillStyle = 'rgba(255, 215, 0, 1)';
            this.ctx.fillText(`BPM ${Math.round(tm.bpm)}`, x + 4, 25);
        }

        this.ctx.restore();
    }

    drawLoopRegion(state: AudioEngineState) {
        if (!state.loopEnabled) return;
        if (!this.ctx) return;

        const { width, height } = this.canvas;
        const { timelineOffsetSec, playbackPosition, pxPerSec, tempoFactor } = state;

        const playX = getPlayX(width);
        const eff = playbackPosition + timelineOffsetSec;

        // Check if loop is complete (both start and end set properly)
        const isComplete = state.loopEnd > state.loopStart;
        const isPartial = !isComplete; // Treat any incomplete loop as partial if enabled (Start is always >= 0)

        if (isComplete) {
            // Complete loop: Green region
            const x1 = playX + (state.loopStart - eff) * pxPerSec / tempoFactor;
            const x2 = playX + (state.loopEnd - eff) * pxPerSec / tempoFactor;

            const left = Math.max(0, x1);
            const right = Math.min(width, x2);
            if (right > left) {
                this.ctx.save();
                this.ctx.fillStyle = 'rgba(0, 200, 100, 0.15)';
                this.ctx.fillRect(left, 0, right - left, height);

                this.ctx.strokeStyle = 'rgba(0, 200, 100, 0.7)';
                this.ctx.lineWidth = 2;
                if (x1 >= 0 && x1 <= width) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(x1, 0);
                    this.ctx.lineTo(x1, height);
                    this.ctx.stroke();
                }
                if (x2 >= 0 && x2 <= width) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(x2, 0);
                    this.ctx.lineTo(x2, height);
                    this.ctx.stroke();
                }

                this.ctx.font = 'bold 10px sans-serif';
                this.ctx.fillStyle = 'rgba(0, 200, 100, 0.9)';
                this.ctx.fillText('LOOP', left + 5, 12);

                // Draw Handles (Triangles at top)
                const drawHandle = (x: number, isStart: boolean) => {
                    if (x < -10 || x > width + 10) return;
                    this.ctx.beginPath();
                    this.ctx.fillStyle = '#00E676';
                    this.ctx.strokeStyle = '#004D40';
                    this.ctx.lineWidth = 1;
                    if (isStart) {
                        // Right-pointing triangle or simple bracket
                        this.ctx.moveTo(x, 0);
                        this.ctx.lineTo(x + 10, 0);
                        this.ctx.lineTo(x, 15);
                    } else {
                        // Left-pointing
                        this.ctx.moveTo(x, 0);
                        this.ctx.lineTo(x - 10, 0);
                        this.ctx.lineTo(x, 15);
                    }
                    this.ctx.fill();
                    this.ctx.stroke();
                };

                drawHandle(x1, true);
                drawHandle(x2, false);

                this.ctx.restore();
            }
        } else if (isPartial) {
            // Partial loop: Yellow region from start to current playback
            const x1 = playX + (state.loopStart - eff) * pxPerSec / tempoFactor;
            // End is exactly at the playback cursor (playX)
            // But we must respect the physical timeline.
            // If the user has scrolled away (timelineOffsetSec != 0), playX might not represent "playback cursor" relative to notes?
            // "playX" IS the screen coordinate where the playhead sits.
            // "eff" IS the time at playX.
            // "playbackPosition" is the current time of the playhead.
            // So yes, the playhead is ALWAYS at playX (unless stopped/seeking? No, Visualizer always centers playX for 'playbackPosition').
            // Wait, if I pan, timelineOffsetSec changes. playbackPosition continues increasing.
            // eff = playbackPosition + timelineOffsetSec.
            // The Playhead is drawn at playX ONLY if timelineOffsetSec == 0 ?
            // Let's check how Grid/Notes are drawn.
            // x = playX + (t - eff) ...
            // Playhead is at t = playbackPosition.
            // x_playhead = playX + (playbackPosition - (playbackPosition + timelineOffsetSec)) ...
            // x_playhead = playX - timelineOffsetSec * ...
            // So if timelineOffsetSec is 0 (tracking), playhead is at playX.
            // If I pan, playhead moves.

            const currentHeadX = playX - (timelineOffsetSec * pxPerSec / tempoFactor);

            // We want to draw from Start(x1) to CurrentHead(x2)
            const x2 = currentHeadX;

            // Only draw if x2 > x1 (positive time range)
            if (x2 > x1) {
                const left = Math.max(0, x1);
                const right = Math.min(width, x2);

                if (right > left) {
                    this.ctx.save();
                    // Yellow pulsing effect
                    const pulse = 0.1 + 0.05 * Math.sin(Date.now() / 200);
                    this.ctx.fillStyle = `rgba(234, 179, 8, ${pulse})`;
                    this.ctx.fillRect(left, 0, right - left, height);

                    // Start marker (solid yellow)
                    this.ctx.strokeStyle = 'rgba(234, 179, 8, 0.9)';
                    this.ctx.lineWidth = 3;
                    if (x1 >= 0 && x1 <= width) {
                        this.ctx.beginPath();
                        this.ctx.moveTo(x1, 0);
                        this.ctx.lineTo(x1, height);
                        this.ctx.stroke();
                    }

                    // End marker (dashed at playhead)
                    if (x2 >= 0 && x2 <= width) {
                        this.ctx.setLineDash([8, 8]);
                        this.ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
                        this.ctx.lineWidth = 2;
                        this.ctx.beginPath();
                        this.ctx.moveTo(x2, 0);
                        this.ctx.lineTo(x2, height);
                        this.ctx.stroke();
                        this.ctx.setLineDash([]);
                    }

                    // Label
                    if (left + 100 < width) {
                        this.ctx.font = 'bold 11px sans-serif';
                        this.ctx.fillStyle = 'rgba(234, 179, 8, 1)';
                        this.ctx.fillText('▶ 開始点設定済み', left + 8, 14);
                    }

                    this.ctx.restore();
                }
            }
        }
    }
}
