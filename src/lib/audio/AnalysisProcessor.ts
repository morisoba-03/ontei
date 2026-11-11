// @ts-ignore
import AnalysisWorker from './analysis.worker?worker';

export interface AnalysisResult {
    freq: number;
    conf: number;
    guideFreq: number;
    held?: boolean;
    rawFreq?: number;
    octaveShift?: number;
}

export class AnalysisProcessor {
    private worker: Worker;

    // Callback to receive results
    public onResult: ((res: AnalysisResult) => void) | null = null;

    constructor() {
        this.worker = new AnalysisWorker();
        this.worker.onmessage = (e) => {
            if (e.data.type === 'result' && this.onResult) {
                this.onResult(e.data.payload);
            }
        };
    }

    init(sampleRate: number, analysisRate?: number, holdMs?: number) {
        this.worker.postMessage({ type: 'init', payload: { sampleRate, analysisRate, holdMs } });
    }

    processAsync(inputBuffer: Float32Array, guideFreq: number = 0, minRms?: number, version: 'v1' | 'v2' | 'v3' = 'v3', externalRms?: number, octaveFree: boolean = true) {
        // Send buffer to worker for processing
        this.worker.postMessage({
            type: 'process',
            payload: { buffer: inputBuffer, guideFreq, minRms, version, externalRms, octaveFree }
        });
    }

    reset() {
        this.worker.postMessage({ type: 'reset' });
    }

    terminate() {
        this.worker.terminate();
    }
}
