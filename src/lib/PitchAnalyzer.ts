/**
 * PitchAnalyzer — マイク・音声ファイル共通の音程検出の入口。
 *
 * 検出そのものは PitchEngineV3（ガイドを一切見ない）。
 * 「ガイドと違うオクターブで吹いても正解」にするかどうかは、検出後の折り返し（OctaveFolder）だけで決める。
 */
import { PitchEngineV3, OctaveFolder } from './PitchEngineV3';

export interface PitchResult {
    freq: number;
    conf: number;
    /** 無音の直後、直前の音程を短時間保持しているフレーム */
    held?: boolean;
    /** オクターブ折り返し前の実音 */
    rawFreq?: number;
    /** 折り返したオクターブ数（+1 = 1 オクターブ上げて表示） */
    octaveShift?: number;
}

export interface AnalyzeOptions {
    guideFreq?: number;
    minRms?: number;
    externalRms?: number;
    /** true（既定）: ガイドに最も近いオクターブへ折り返す */
    octaveFree?: boolean;
}

export class PitchAnalyzer {
    private engine = new PitchEngineV3();
    private folder = new OctaveFolder();

    setAnalysisRate(hz: number, holdMs?: number) {
        this.engine.setAnalysisRate(hz, holdMs);
        this.folder.setAnalysisRate(hz);
    }

    reset() {
        this.engine.reset();
        this.folder.reset();
    }

    analyze(buf: Float32Array, sampleRate: number, options: AnalyzeOptions = {}): PitchResult {
        const r = this.engine.analyze(buf, sampleRate, { minRms: options.minRms, externalRms: options.externalRms });
        if (!(r.freq > 0)) return { freq: 0, conf: 0 };
        if (options.octaveFree === false) {
            this.folder.reset();
            return { ...r, rawFreq: r.freq, octaveShift: 0 };
        }
        const folded = this.folder.fold(r.freq, options.guideFreq ?? 0);
        return { freq: folded.freq, conf: r.conf, held: r.held, rawFreq: r.freq, octaveShift: folded.octaveShift };
    }
}
