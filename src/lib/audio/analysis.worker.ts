import { PitchAnalyzer } from '../PitchAnalyzer';
import type { PitchResult } from '../PitchAnalyzer';

const analyzer = new PitchAnalyzer();
let sampleRate = 44100;

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'init') {
        sampleRate = payload.sampleRate;
        if (payload.analysisRate) analyzer.setAnalysisRate(payload.analysisRate, payload.holdMs);
    } else if (type === 'process') {
        const { buffer, guideFreq, minRms, externalRms, octaveFree } = payload;
        const result: PitchResult = analyzer.analyze(buffer, sampleRate, { guideFreq, minRms, externalRms, octaveFree });
        self.postMessage({ type: 'result', payload: { ...result, guideFreq } });
    } else if (type === 'reset') {
        analyzer.reset();
    }
};
