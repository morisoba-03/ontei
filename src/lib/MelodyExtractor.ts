
// @ts-nocheck - Legacy analysis logic with many untyped internal functions
import { findZeroCrossOffsetSec } from './audioUtils';
import { PitchAnalyzer } from './PitchAnalyzer';


/**
 * メロディ波形から単音列を高精度抽出
 * 手法: PitchAnalyzer (MPM) + ヒステリシス分節 + 短音マージ
 */
export async function extractMelodyNotesFromBuffer(
    buf,
    analysisRate = 20,
    A4Frequency = 440,
    strictOctaveMode = false,
    YinPitchTracker = null,
    onProgress = (p: number) => { }
) {
    const sr = buf.sampleRate;
    const ch0 = buf.getChannelData(0);
    // ステレオは簡易平均でモノラル化
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const mono = new Float32Array(ch0.length);
    for (let i = 0; i < mono.length; i++) mono[i] = ch0[i] * (ch1 ? 0.5 : 1) + (ch1 ? ch1[i] * 0.5 : 0);

    // Helpers for Octave Correction (Restore Legacy)
    function goertzelPower(frameArr, sr, freq) {
        if (!(freq > 0) || freq >= sr * 0.5) return 0;
        const w = 2 * Math.PI * freq / sr;
        const c = Math.cos(w);
        const coeff = 2 * c;
        let s0 = 0, s1 = 0, s2 = 0;
        for (let n = 0; n < frameArr.length; n++) {
            s0 = frameArr[n] + coeff * s1 - s2;
            s2 = s1; s1 = s0;
        }
        const power = s1 * s1 + s2 * s2 - coeff * s1 * s2; // magnitude^2
        return Math.max(0, power);
    }
    function shsScore(frameArr, sr, f0, K) {
        if (!(f0 > 0)) return 0;
        const maxH = Math.max(1, K | 0);
        let sum = 0; let used = 0;
        for (let k = 1; k <= maxH; k++) {
            const fk = f0 * k; if (fk >= sr * 0.5) break;
            const p = goertzelPower(frameArr, sr, fk);
            sum += (p > 0 ? Math.sqrt(p) : 0) * (1 / k);
            used++;
        }
        return used ? sum / used : 0;
    }

    // プリエンファシス（フォルマント影響の軽減） y[n]=x[n]-a*x[n-1]
    try {
        const a = 0.97;
        let prev = 0;
        for (let i = 0; i < mono.length; i++) {
            const x = mono[i];
            mono[i] = x - a * prev;
            prev = x;
        }
    } catch { }

    onProgress(10); // Pre-processing done

    // High fidelity approach: Keep SR high (e.g. 22050 or 44100) to match Mic accuracy
    const targetSR = 44100;
    const dsFactor = Math.max(1, Math.floor(sr / targetSR));
    const srd = sr / dsFactor; // 実際のダウンサンプルSR
    const dsLen = Math.floor(mono.length / dsFactor);
    const ds = new Float32Array(dsLen);
    // 簡易ブロック平均でダウンサンプリング
    for (let i = 0, j = 0; i < dsLen; i++, j += dsFactor) {
        let sum = 0; let cnt = 0; for (let k = 0; k < dsFactor && (j + k) < mono.length; k++) { sum += mono[j + k]; cnt++; }
        ds[i] = sum / Math.max(1, cnt);
    }

    onProgress(20); // Downsampling done

    // 解析設定（ダウンサンプル後の帯域に合わせる）
    const fmin = 65;   // Hz
    const fmax = 1200; // Hz
    const desiredRate = Math.max(28, Math.min(60, (analysisRate || 20) + 25)); // 高頻度化（~60fps上限）
    // 窓長は ~90ms 目安、[1024,2048]の2冪で丸め
    const targetWinSec = 0.09; const targetW = Math.floor(srd * targetWinSec);
    const pow2 = (x) => 1 << Math.round(Math.log2(Math.max(1, x)));
    const W = Math.max(1024, Math.min(2048, pow2(targetW)));
    const H = Math.max(1, Math.floor(srd / Math.max(28, desiredRate))); // 解析fpsを引き上げ
    const tauMin = Math.max(2, Math.floor(srd / fmax));
    const tauMax = Math.max(tauMin + 2, Math.min(Math.floor(srd / fmin), Math.floor(W * 0.9)));
    // 窓関数（Hann）
    const hann = new Float32Array(W);
    for (let n = 0; n < W; n++) hann[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (W - 1)));

    // 連続性制約: 前回推定を利用して探索範囲を±2半音に絞る（初回は全域）
    const SEMI_NARROW = Math.pow(2, 2 / 12); // 約±2半音
    let prevFreq = 0; let prevTau = 0;

    // Use PitchAnalyzer (MPM) for consistent high-accuracy detection
    const ftrack = new Float32Array(Math.ceil(ds.length / H));
    const ctrack = new Float32Array(Math.ceil(ds.length / H)); // Confidence track
    const analyzer = new PitchAnalyzer();

    // Analyze frame by frame
    let wIdx = 0;
    while (wIdx * H + W < ds.length) {
        const start = wIdx * H;
        const frame = ds.subarray(start, start + W);

        // Use PitchAnalyzer (Stateful)
        // Note: analyzer expects raw float32 samples. We use the downsampled buffer 'ds'.
        // We pass targetSR (11025) as sample rate.
        // Pass minRms: 0.002 to catch quiet parts (since we did pre-emphasis)
        const res = analyzer.analyze(frame, srd, { viterbi: true, minRms: 0.002 });

        ftrack[wIdx] = res.freq;
        ctrack[wIdx] = res.conf;
        wIdx++;


        // Report Progress & Yield
        if (wIdx % 200 === 0) {
            // Map 20 - 90 %
            const p = 20 + (wIdx / (ds.length / H)) * 70;
            onProgress(Math.min(90, p));
            await new Promise(r => setTimeout(r, 0));
        }
    }

    onProgress(95); // Analysis done, post-processing...

    // --- Legacy Viterbi/Enhancement Logic Removed (Replaced by PitchAnalyzer) ---

    // セグメンテーション
    const notes = [];
    const idxToTime = (idx) => idx * H / srd;
    const MIN_NOTE_SEC = 0.07;
    const HOLD_FRAMES = 2;
    // Latency Compensation: Align detected pitch to center of analysis window (approx)
    const LATENCY_SEC = 0.045;

    let curMidi = null, curStart = 0; let changeStreak = 0; let lastMidiRounded = null;
    for (let i = 0; i < ftrack.length; i++) {
        const f = ftrack[i]; const t = idxToTime(i);
        if (f <= 0) {
            if (curMidi != null) {
                const dur = t - curStart;
                if (dur > 0) {
                    notes.push({ midi: curMidi, time: Math.max(0, curStart - LATENCY_SEC), duration: dur });
                }
                curMidi = null;
            }
            changeStreak = 0; lastMidiRounded = null; continue;
        }
        let midiFloat = 69 + 12 * Math.log2(f / A4Frequency);
        if (curMidi != null) {
            while (midiFloat - curMidi > 6) midiFloat -= 12;
            while (curMidi - midiFloat > 6) midiFloat += 12;
        }
        const rounded = Math.round(midiFloat);
        if (curMidi == null) {
            curMidi = rounded; curStart = t; changeStreak = 0; lastMidiRounded = rounded;
        } else {
            if (rounded !== curMidi) {
                if (lastMidiRounded === rounded) { changeStreak++; } else { changeStreak = 1; lastMidiRounded = rounded; }
                if (changeStreak >= HOLD_FRAMES) {
                    const dur = t - curStart;
                    if (dur > 0) {
                        notes.push({ midi: curMidi, time: Math.max(0, curStart - LATENCY_SEC), duration: dur });
                    }
                    curMidi = rounded; curStart = t; changeStreak = 0;
                }
            } else {
                changeStreak = 0; lastMidiRounded = rounded;
            }
        }
    }
    if (curMidi != null) {
        const endT = idxToTime(ftrack.length);
        const dur = endT - curStart;
        if (dur > 0) {
            notes.push({ midi: curMidi, time: Math.max(0, curStart - LATENCY_SEC), duration: dur });
        }
    }

    // 短音マージ
    const merged = [];
    for (const n of notes) {
        if (!merged.length) { merged.push(n); continue; }
        const prev = merged[merged.length - 1];
        if (n.midi === prev.midi && (n.time - (prev.time + prev.duration)) < 0.02) {
            prev.duration = (n.time + n.duration) - prev.time;
        } else if (n.duration < MIN_NOTE_SEC && Math.abs(n.midi - prev.midi) <= 1 && (n.time - (prev.time + prev.duration)) < 0.03) {
            prev.duration = (n.time + n.duration) - prev.time;
        } else {
            merged.push(n);
        }
    }

    // サンドイッチ短音吸収
    const cleaned = [];
    for (let i = 0; i < merged.length; i++) {
        if (i > 0 && i < merged.length - 1) {
            const a = merged[i - 1], b = merged[i], c = merged[i + 1];
            const gapAB = b.time - (a.time + a.duration);
            const gapBC = c.time - (b.time + b.duration);
            if (b.duration < Math.min(0.06, MIN_NOTE_SEC) && a.midi === c.midi && Math.abs(b.midi - a.midi) <= 1 && gapAB < 0.03 && gapBC < 0.03) {
                a.duration = (c.time + c.duration) - a.time;
                i++;
                continue;
            }
        }
        cleaned.push(merged[i]);
    }

    // ノート単位のオクターブ安定化
    const clampMidiMin = 36, clampMidiMax = 127;
    const timeToIdx = (t) => Math.max(0, Math.min(ftrack.length - 1, Math.round(t * srd / H)));
    const safeMidi = (m) => Math.max(clampMidiMin, Math.min(clampMidiMax, m));
    const medVal = (arr) => { const v = arr.slice().sort((a, b) => a - b); const L = v.length; if (!L) return 0; return (L % 2) ? v[(L - 1) >> 1] : 0.5 * (v[L / 2 - 1] + v[L / 2]); };
    const noteMedFreq = []; const noteMedMidi = [];
    for (const n of cleaned) {
        const i0 = timeToIdx(n.time), i1 = timeToIdx(n.time + n.duration);
        const vals = []; for (let i = i0; i <= i1; i++) { const f = ftrack[i]; if (f > 0 && isFinite(f)) vals.push(f); }
        const mf = vals.length ? medVal(vals) : (A4Frequency * Math.pow(2, (n.midi - 69) / 12));
        noteMedFreq.push(mf);
        noteMedMidi.push(69 + 12 * Math.log2(mf / A4Frequency));
    }

    // SHSによるオクターブ選択
    (function () {
        const bufFrame = new Float32Array(W);
        const buildFrame = (fi) => {
            const start = fi * H; if (start + W > ds.length) return null;
            let mean = 0; for (let k = 0; k < W; k++) { mean += ds[start + k]; }
            mean /= W; let e = 0; for (let k = 0; k < W; k++) { const v = (ds[start + k] - mean) * hann[k]; bufFrame[k] = v; e += v * v; }
            return Math.sqrt(e / W);
        };
        const shsAt = (fi, f0) => { if (!(f0 > 0) && isFinite(f0)) return 0; const rms = buildFrame(fi); if (!rms || rms < 1e-5) return 0; return shsScore(bufFrame, srd, f0, 8); };
        for (let ni = 0; ni < cleaned.length; ni++) {
            const m0 = noteMedMidi[ni]; const f0 = noteMedFreq[ni]; if (!(f0 > 0) && isFinite(f0)) continue;
            const i0 = timeToIdx(cleaned[ni].time), i1 = timeToIdx(cleaned[ni].time + cleaned[ni].duration);
            let sHalf = 0, sBase = 0, sDouble = 0; const step = Math.max(1, Math.floor((i1 - i0 + 1) / 24));
            for (let fi = i0; fi <= i1; fi += step) { sBase += shsAt(fi, f0); sHalf += shsAt(fi, f0 * 0.5); sDouble += shsAt(fi, f0 * 2); }
            const best = (sHalf >= sBase && sHalf >= sDouble) ? -12 : ((sDouble >= sBase && sDouble >= sHalf) ? +12 : 0);
            if (best !== 0) { noteMedMidi[ni] = m0 + best; }
        }
    })();

    // 音級の優勢度に基づく丸めバイアス (Disabled for general accuracy)

    // (function () {
    //     const hist = new Array(12).fill(0);
    //     ...
    // })();

    // Simple rounding instead
    const outM = []; for (let i = 0; i < cleaned.length; i++) { outM.push(Math.round(noteMedMidi[i])); }

    // 厳密オクターブ補正（試験）
    if (strictOctaveMode && outM.length >= 2) {
        // ... (Keep existing Logic if strictly requested)
        const Kcands = [-24, -12, 0, 12, 24];
        const N = outM.length; const M = Kcands.length;
        const dp = new Array(N); const prv = new Array(N);
        for (let i = 0; i < N; i++) { dp[i] = new Array(M).fill(Infinity); prv[i] = new Array(M).fill(-1); }
        const ratios = new Array(N).fill(1);
        for (let i = 1; i < N; i++) {
            const r = (noteMedFreq[i - 1] > 0 && noteMedFreq[i] > 0) ? (noteMedFreq[i] / noteMedFreq[i - 1]) : 1;
            ratios[i] = r;
        }
        function localCost(i, kIdx) {
            const K = Kcands[kIdx];
            let cost = 0;
            if (K !== 0) cost += 0.12;
            return cost;
        }
        function transCost(i, kFrom, kTo) {
            const K1 = Kcands[kFrom], K2 = Kcands[kTo];
            const m1 = outM[i - 1] + K1, m2 = outM[i] + K2;
            const dSemi = Math.abs(m2 - m1);
            const r = ratios[i]; const allowOct = (r > 1.8 || r < 0.55);
            let cost = 0.10 * dSemi;
            const nearOct = Math.min(Math.abs(dSemi - 12), Math.abs(dSemi - 24));
            if (nearOct < 0.6) { cost += allowOct ? 0.05 : 1.1; }
            if (dSemi <= 6) cost -= 0.03;
            return cost;
        }
        for (let k = 0; k < M; k++) { dp[0][k] = localCost(0, k); prv[0][k] = -1; }
        for (let i = 1; i < N; i++) {
            for (let k2 = 0; k2 < M; k2++) {
                let best = Infinity, bestp = -1; const lc = localCost(i, k2);
                for (let k1 = 0; k1 < M; k1++) {
                    const tc = transCost(i, k1, k2);
                    const c = dp[i - 1][k1] + lc + tc;
                    if (c < best) { best = c; bestp = k1; }
                }
                dp[i][k2] = best; prv[i][k2] = bestp;
            }
        }
        let last = 0; { let minv = Infinity; for (let k = 0; k < M; k++) { if (dp[N - 1][k] < minv) { minv = dp[N - 1][k]; last = k; } } }
        const Ksel = new Array(N).fill(0);
        for (let i = N - 1; i >= 0; i--) { Ksel[i] = Kcands[last]; last = (prv[i][last] >= 0) ? prv[i][last] : 0; }
        for (let i = 0; i < N; i++) { outM[i] = safeMidi(outM[i] + Ksel[i]); }
    } else {
        // Relaxed Octave Jump Limit
        for (let i = 1; i < outM.length; i++) {
            const r = noteMedFreq[i - 1] > 0 ? (noteMedFreq[i] / noteMedFreq[i - 1]) : 1;
            const allowOct = (r > 1.8 || r < 0.55); // Ratio suggests octave jump?
            const d = Math.abs(outM[i] - outM[i - 1]);

            // Legacy was strict 6 semitones, which broke large intervals.
            // Only constrain if NO octave jump signal is present.
            if (!allowOct && d > 12) {
                // If jump is >12 semitones but ratio doesn't support it, maybe bring it closer?
                // But PitchAnalyzer is robust. Trust it more.
                // Only fix really obvious errors?
                // Let's iterate cands [-12, 0, 12] to see which is closest to prev if we distrust the jump.
                // But without bias, let's keep it raw mostly.
                // Just do nothing here if we trust MPM + SHS.
            }
        }
    }

    // フレーズ跨ぎ整合
    (function () {
        if (cleaned.length <= 1) return;
        const PHRASE_GAP_SEC = 0.26;
        const phrases = []; let sIdx = 0;
        for (let i = 1; i < cleaned.length; i++) {
            const prev = cleaned[i - 1]; const cur = cleaned[i];
            const gap = cur.time - (prev.time + prev.duration);
            if (gap >= PHRASE_GAP_SEC) { phrases.push({ s: sIdx, e: i - 1 }); sIdx = i; }
        }
        phrases.push({ s: sIdx, e: cleaned.length - 1 });
        if (phrases.length <= 1) return;
        const medInt = (arr) => { const v = arr.slice().sort((a, b) => a - b); const n = v.length; return n ? v[(n - 1) >> 1] : 0; };
        const Kcands = [-24, -12, 0, 12, 24];
        const p0 = phrases[0]; let prevAnchor = medInt(outM.slice(p0.s, p0.e + 1)); let prevLast = outM[p0.e];
        for (let pi = 1; pi < phrases.length; pi++) {
            const ph = phrases[pi]; const seg = outM.slice(ph.s, ph.e + 1); if (!seg.length) continue;
            const mFirst = seg[0]; const mMed = medInt(seg);
            let bestK = 0, bestCost = 1e9;
            for (const K of Kcands) {
                const d1 = Math.abs((mFirst + K) - prevLast);
                const d2 = Math.abs((mMed + K) - prevAnchor);
                const cost = 1.2 * d1 + 1.0 * d2;
                if (cost < bestCost) { bestCost = cost; bestK = K; }
            }
            if (bestK !== 0) { for (let i = ph.s; i <= ph.e; i++) { outM[i] = safeMidi(outM[i] + bestK); } }
            prevAnchor = medInt(outM.slice(ph.s, ph.e + 1)); prevLast = outM[ph.e];
        }
    })();
    for (let i = 0; i < cleaned.length; i++) { cleaned[i].midi = outM[i]; }

    // 同音連結の最終マージ
    const finalNotes = []; for (const n of cleaned) { if (!finalNotes.length) { finalNotes.push(n); continue; } const p = finalNotes[finalNotes.length - 1]; if (n.midi === p.midi && n.time <= p.time + p.duration + 0.03) { p.duration = Math.max(p.duration, (n.time + n.duration) - p.time); } else { finalNotes.push(n); } }

    // Extract Pitch Data for visualization with post-processing
    const pitchData = [];
    if (ftrack.length > 0) {
        // Step 0: Confidence Gating
        // If confidence is low, ignore the pitch (set to 0) to avoid noise.
        const gated = new Float32Array(ftrack.length);
        for (let i = 0; i < ftrack.length; i++) {
            if (ctrack[i] >= 0.4 && ftrack[i] > 0) {
                gated[i] = ftrack[i];
            } else {
                gated[i] = 0;
            }
        }

        // Step 1: Global Median Clamp
        // Remove outliers that are > 2 octaves away from the global median pitch.
        const validMidi = [];
        for (let i = 0; i < gated.length; i++) {
            if (gated[i] > 0) {
                const m = 69 + 12 * Math.log2(gated[i] / A4Frequency);
                validMidi.push(m);
            }
        }

        let globalMedian = 0;
        if (validMidi.length > 0) {
            validMidi.sort((a, b) => a - b);
            globalMedian = validMidi[Math.floor(validMidi.length / 2)];

            // Apply Clamp
            for (let i = 0; i < gated.length; i++) {
                if (gated[i] > 0) {
                    const m = 69 + 12 * Math.log2(gated[i] / A4Frequency);
                    if (Math.abs(m - globalMedian) > 36) { // > 3 octaves
                        gated[i] = 0;
                    }
                }
            }
        }

        // Step 2: Strong Median Filter (Window 5)
        const smoothed = new Float32Array(gated.length);
        const win = 5;
        const half = 2;

        for (let i = 0; i < gated.length; i++) {
            const vals = [];
            for (let k = -half; k <= half; k++) {
                if (i + k >= 0 && i + k < gated.length) {
                    const v = gated[i + k];
                    if (v > 0) vals.push(v);
                }
            }
            if (vals.length === 0) {
                smoothed[i] = 0;
            } else {
                vals.sort((a, b) => a - b);
                smoothed[i] = vals[Math.floor(vals.length / 2)];
            }
        }

        // Step 3: Octave Consistency (Glue)
        const cleaned = new Float32Array(smoothed.length);
        cleaned.set(smoothed);

        let lastValidMidi = -1;

        for (let i = 0; i < cleaned.length; i++) {
            const f = cleaned[i];
            if (f <= 0) {
                continue;
            }

            const m = 69 + 12 * Math.log2(f / A4Frequency);

            if (lastValidMidi > 0) {
                const diff = m - lastValidMidi;
                const absDiff = Math.abs(diff);

                // Check for roughly octave errors (offset by ~12, ~24)
                const isOctaveJump = (Math.abs(absDiff - 12) < 2.5) || (Math.abs(absDiff - 24) < 2.5);

                if (isOctaveJump) {
                    const shift = (diff > 0) ? -12 : 12;
                    // Double octave jump?
                    const shift2 = (diff > 0) ? -24 : 24;

                    const mShifted1 = m + shift;
                    const mShifted2 = m + shift2;

                    const d1 = Math.abs(mShifted1 - lastValidMidi);
                    const d2 = Math.abs(mShifted2 - lastValidMidi);

                    if (d1 < 4.0) {
                        cleaned[i] = f * Math.pow(2, shift / 12);
                    } else if (d2 < 4.0) {
                        cleaned[i] = f * Math.pow(2, shift2 / 12);
                    }
                }
            }

            // Update last valid
            lastValidMidi = 69 + 12 * Math.log2(cleaned[i] / A4Frequency);
        }

        // 4. Export
        for (let i = 0; i < cleaned.length; i++) {
            const f = cleaned[i];
            if (f > 0) {
                pitchData.push({ time: idxToTime(i), freq: f });
            }
        }
    }

    return { notes: finalNotes, pitchData };
}
