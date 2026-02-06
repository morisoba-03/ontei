import { X, HelpCircle } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { useState, useEffect } from 'react';
import { HelpModal } from './HelpModal';
import type { AudioEngineState } from '../lib/types';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
    const [state, setState] = useState(audioEngine.state);
    const [showHelp, setShowHelp] = useState(false);

    useEffect(() => {
        return audioEngine.subscribe(() => setState(audioEngine.state));
    }, []);

    const update = <K extends keyof AudioEngineState>(key: K, value: AudioEngineState[K]) => {
        audioEngine.updateState({ [key]: value } as Partial<AudioEngineState>);
    };

    return (
        <>
            <div className="absolute top-14 right-2 md:right-4 z-[60] w-[95vw] md:w-80 max-w-[95vw] md:max-w-none bg-black/90 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden text-white/90 animate-in fade-in slide-in-from-right-4 flex flex-col max-h-[calc(100dvh-8rem)]">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5 shrink-0">
                    <h3 className="font-bold flex items-center gap-2">
                        <span className="w-2 h-6 bg-blue-500 rounded-full" />
                        <span>設定</span>
                        <span className="text-xs font-normal text-white/30 bg-white/10 px-1.5 py-0.5 rounded ml-2">v1.2.0</span>
                    </h3>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowHelp(true)}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors text-blue-300 hover:text-blue-200"
                            title="使い方ガイド"
                        >
                            <HelpCircle size={20} />
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors" aria-label="閉じる">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-5 space-y-6 overflow-y-auto overscroll-contain flex-1 min-h-0">

                    {/* Display Settings */}
                    <div className="bg-white/5 rounded-lg overflow-hidden border border-white/5">
                        <div className="px-4 py-2 bg-white/10 text-xs font-bold uppercase tracking-wider text-white/70">
                            表示設定
                        </div>
                        <div className="p-4 space-y-6">
                            {/* Note Notation */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>音名表記</span>
                                    <div className="flex bg-white/10 rounded-lg p-1">
                                        <button
                                            onClick={() => update('noteNotation', 'alphabet')}
                                            className={`px-3 py-1 rounded-md text-xs transition-all ${state.noteNotation === 'alphabet' ? 'bg-blue-500 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
                                        >
                                            CDE
                                        </button>
                                        <button
                                            onClick={() => update('noteNotation', 'katakana')}
                                            className={`px-3 py-1 rounded-md text-xs transition-all ${state.noteNotation === 'katakana' ? 'bg-blue-500 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
                                        >
                                            ドレミ
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Vertical Zoom */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>縦ズーム (音域)</span>
                                    <span className="font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">{(state.verticalZoom).toFixed(1)} Octave</span>
                                </div>
                                <input
                                    type="range" min="1" max="10" step="0.5"
                                    value={state.verticalZoom}
                                    onChange={(e) => update('verticalZoom', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            {/* Scroll Speed */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>スクロール速度</span>
                                    <span className="font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">{state.pxPerSec} px/s</span>
                                </div>
                                <input
                                    type="range" min="50" max="300" step="10"
                                    value={state.pxPerSec}
                                    onChange={(e) => update('pxPerSec', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            {/* Visual Effects */}
                            <div className="flex items-center justify-between text-sm pt-2 border-t border-white/5">
                                <span>リアルタイム演出</span>
                                <button
                                    onClick={() => update('isParticlesEnabled', !state.isParticlesEnabled)}
                                    className={`w-10 h-5 rounded-full transition-colors relative ${state.isParticlesEnabled ? 'bg-blue-500' : 'bg-white/10'}`}
                                >
                                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${state.isParticlesEnabled ? 'left-5.5' : 'left-0.5'}`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Playback & Volume */}
                    <div className="bg-white/5 rounded-lg overflow-hidden border border-white/5">
                        <div className="px-4 py-2 bg-white/10 text-xs font-bold uppercase tracking-wider text-white/70">
                            再生・音量・キー
                        </div>
                        <div className="p-4 space-y-6">
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>再生速度 (テンポ)</span>
                                    <span className="font-mono text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded">x{state.tempoFactor.toFixed(2)}</span>
                                </div>
                                <input
                                    type="range" min="0.5" max="2.0" step="0.05"
                                    value={state.tempoFactor}
                                    onChange={(e) => update('tempoFactor', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            <div className="flex items-center justify-between text-sm pt-2">
                                <span>カウントイン (再生前1小節)</span>
                                <button
                                    onClick={() => update('countIn', !state.countIn)}
                                    className={`w-10 h-5 rounded-full transition-colors relative ${state.countIn ? 'bg-orange-500' : 'bg-white/10'}`}
                                >
                                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${state.countIn ? 'left-5.5' : 'left-0.5'}`} />
                                </button>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>ガイド音程シフト</span>
                                    <span className="font-mono text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                                        {state.guideOctaveOffset > 0 ? '+' : ''}{state.guideOctaveOffset} Oct
                                    </span>
                                </div>
                                <div className="flex bg-white/10 rounded-lg p-1 gap-1">
                                    <button
                                        onClick={() => update('guideOctaveOffset', state.guideOctaveOffset - 1)}
                                        className="flex-1 py-1 hover:bg-white/10 rounded-md transition-colors text-white/80"
                                    >
                                        -1
                                    </button>
                                    <button
                                        onClick={() => update('guideOctaveOffset', 0)}
                                        className="flex-1 py-1 hover:bg-white/10 rounded-md transition-colors text-xs text-white/40"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        onClick={() => update('guideOctaveOffset', state.guideOctaveOffset + 1)}
                                        className="flex-1 py-1 hover:bg-white/10 rounded-md transition-colors text-white/80"
                                    >
                                        +1
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>キー変更（移調）</span>
                                    <span className="font-mono text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded">
                                        {state.transposeOffset > 0 ? '+' : ''}{state.transposeOffset} 半音
                                    </span>
                                </div>
                                <input
                                    type="range" min="-12" max="12" step="1"
                                    value={state.transposeOffset}
                                    onChange={(e) => update('transposeOffset', parseInt(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                                <div className="flex justify-between text-[10px] text-white/30 px-1">
                                    <span>-1オクターブ</span>
                                    <button onClick={() => update('transposeOffset', 0)} className="text-white/50 hover:text-white">Reset</button>
                                    <span>+1オクターブ</span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>ガイド音量</span>
                                    <span className="font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">{(state.guideVolume * 100).toFixed(0)}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={state.guideVolume}
                                    onChange={(e) => update('guideVolume', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>伴奏音量</span>
                                    <span className="font-mono text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">{(state.accompVolume * 100).toFixed(0)}%</span>
                                </div>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={state.accompVolume}
                                    onChange={(e) => update('accompVolume', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-purple-400 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Audio Settings (Moved to Bottom) */}
                    <div className="bg-white/5 rounded-lg overflow-hidden border border-white/5">
                        <div className="px-4 py-2 bg-white/10 text-xs font-bold uppercase tracking-wider text-white/70">
                            オーディオ設定
                        </div>
                        <div className="p-4 space-y-6">
                            {/* Mic Gate */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>マイク感度 (Gate)</span>
                                    <span className="font-mono text-red-400 bg-red-400/10 px-2 py-0.5 rounded">{state.gateThreshold} dB</span>
                                </div>
                                <input
                                    type="range" min="-80" max="0" step="1"
                                    value={state.gateThreshold}
                                    onChange={(e) => update('gateThreshold', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            {/* Mic Latency */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>マイク遅延補正</span>
                                    <span className="font-mono text-pink-400 bg-pink-400/10 px-2 py-0.5 rounded">{(state.inputLatency * 1000).toFixed(0)} ms</span>
                                </div>
                                <input
                                    type="range" min="0" max="500" step="10"
                                    value={state.inputLatency * 1000}
                                    onChange={(e) => update('inputLatency', parseFloat(e.target.value) / 1000)}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-pink-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>

                            {/* Tolerance */}
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm items-center">
                                    <span>判定許容誤差</span>
                                    <span className="font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">±{state.toleranceCents} cent</span>
                                </div>
                                <input
                                    type="range" min="10" max="100" step="5"
                                    value={state.toleranceCents}
                                    onChange={(e) => update('toleranceCents', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                                />
                            </div>
                        </div>
                    </div>

                </div>

                <div className="pt-4 pb-4 text-center shrink-0">
                    <p className="text-[10px] text-white/20">Ontei Web - Refactor</p>
                </div>
            </div>
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        </>
    );
}
