import { PitchAnalyzer } from '../PitchAnalyzer';
import type { PitchResult } from '../PitchAnalyzer';

const analyzer = new PitchAnalyzer();
let sampleRate = 44100;

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        sampleRate = payload.sampleRate;
        if (payload.analysisRate) analyzer.setAnalysisRate(payload.analysisRate);
    } else if (type === 'process') {
        const { buffer, guideFreq, minRms, version } = payload;
        // buffer is a Float32Array
        const result: PitchResult = analyzer.analyze(buffer, sampleRate, {
            viterbi: true,
            guideFreq: guideFreq,
            minRms: minRms,
            version: version
        });
        self.postMessage({ type: 'result', payload: { ...result, guideFreq } });
    } else if (type === 'reset') {
        analyzer.reset();
    }
};
