// @ts-ignore
import AnalysisWorker from './analysis.worker?worker';

export interface AnalysisResult {
    freq: number;
    conf: number;
    guideFreq: number;
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

    init(sampleRate: number, analysisRate?: number) {
        this.worker.postMessage({ type: 'init', payload: { sampleRate, analysisRate } });
    }

    processAsync(inputBuffer: Float32Array, guideFreq: number = 0, minRms?: number, version: 'v1' | 'v2' = 'v1') {
        // Send buffer to worker for processing
        this.worker.postMessage({
            type: 'process',
            payload: { buffer: inputBuffer, guideFreq, minRms, version }
        });
    }

    reset() {
        this.worker.postMessage({ type: 'reset' });
    }

    terminate() {
        this.worker.terminate();
    }
}
