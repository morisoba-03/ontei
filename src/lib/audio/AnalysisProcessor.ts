// @ts-ignore
import AnalysisWorker from './analysis.worker?worker';

export interface AnalysisResult {
    freq: number;
    conf: number;
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

    init(sampleRate: number) {
        this.worker.postMessage({ type: 'init', payload: { sampleRate } });
    }

    processAsync(inputBuffer: Float32Array, guideFreq: number = 0) {
        // Send buffer to worker for processing
        this.worker.postMessage({
            type: 'process',
            payload: { buffer: inputBuffer, guideFreq }
        });
    }

    reset() {
        this.worker.postMessage({ type: 'reset' });
    }

    terminate() {
        this.worker.terminate();
    }
}
