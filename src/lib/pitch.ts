// 音程（MIDI）と周波数（Hz）の相互変換。基準ピッチ A4 を指定できる（既定 440Hz）。
export const DEFAULT_A4 = 440;

export function midiToFreq(midi: number, a4: number = DEFAULT_A4): number {
    return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4: number = DEFAULT_A4): number {
    return 69 + 12 * Math.log2(Math.max(1e-9, freq) / a4);
}
