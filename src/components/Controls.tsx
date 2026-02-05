import { useState, useEffect } from 'react';
import { Play, Square, Mic, MousePointer2, Hand, Pencil, Eraser, Settings, Activity, Clock, Repeat, SkipBack, Music2, Volume2, X, Plus, Minus } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { MidiTrackSelector } from './MidiTrackSelector';
import type { MidiTrackInfo } from './MidiTrackSelector';
import type { AudioEngineState } from '../lib/types';
import { cn } from '../lib/utils';
// Unused modal imports removed since they are handled by App.tsx callbacks

interface ControlsProps {
    onOpenSettings: () => void;
    onOpenPractice: () => void; // Not used here yet but in props
    onOpenHistory?: () => void;
    onRecordingComplete?: (blob: Blob) => void;

}

export function Controls({ onOpenSettings, onOpenPractice, onOpenHistory, onRecordingComplete }: ControlsProps) {
    const [isPlaying, setIsPlaying] = useState(audioEngine.state.isPlaying);
    const [isMicOn, setIsMicOn] = useState(!!audioEngine.micStream);
    const [isRecording, setIsRecording] = useState(audioEngine.isRecording);
    const [editTool, setEditTool] = useState(audioEngine.state.editTool);
    const [loopEnabled, setLoopEnabled] = useState(audioEngine.state.loopEnabled);
    const [midiTracks, setMidiTracks] = useState<MidiTrackInfo[]>([]);
    const [showMidiSelector, setShowMidiSelector] = useState(false);
    const [isGuideOn, setIsGuideOn] = useState(audioEngine.state.isGuideSoundEnabled);
    const [isBackingOn, setIsBackingOn] = useState(audioEngine.state.isBackingSoundEnabled);

    useEffect(() => {

        const unsub = audioEngine.subscribe(() => {
            setIsPlaying(audioEngine.state.isPlaying);
            setIsMicOn(!!audioEngine.micStream);
            setIsRecording(audioEngine.isRecording);
            setEditTool(audioEngine.state.editTool);
            setLoopEnabled(audioEngine.state.loopEnabled);
            setIsGuideOn(audioEngine.state.isGuideSoundEnabled);
            setIsBackingOn(audioEngine.state.isBackingSoundEnabled);

            // Check for MIDI candidates to import
            const candidates = audioEngine.state.midiTrackCandidates;
            if (candidates && candidates.length > 0) {
                setMidiTracks(candidates);
                setShowMidiSelector(true);
                // Clear the state so it doesn't pop up again immediately
                // Actually we should clear it after selection or cancel
                audioEngine.updateState({ midiTrackCandidates: undefined });
            }
        });
        const i = setInterval(() => {
            // Polling for selectedNote visibility since it's not in local state
            // Or better, add it to local state:
            // setHasSelection(!!audioEngine.state.selectedNote);
        }, 100);

        return () => {
            unsub();
            clearInterval(i);
        };
    }, []);

    // Better way: use useSyncExternalStore or just a simple hook wrapper.
    // For now, let's use a simple "dummy" state to force re-render on notify
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        return audioEngine.subscribe(() => forceUpdate(n => n + 1));
    }, []);

    const togglePlay = async () => {
        if (audioEngine.state.isPlaying) {
            audioEngine.stopPlayback();
        } else {
            await audioEngine.ensureAudio();
            audioEngine.startPlayback();
        }
    };

    const toggleMic = async () => {
        if (isMicOn) {
            // Stop mic
            if (audioEngine.micStream) {
                audioEngine.micStream.getTracks().forEach(t => t.stop());
                audioEngine.micStream = null;
                audioEngine.notify();
            }
        } else {
            await audioEngine.initMic();
        }
    };

    const handleMidiSelect = (trackId: number) => {
        audioEngine.importMidiTrack(trackId);
        audioEngine.startPractice({ mode: 'Midi' });
        setShowMidiSelector(false);
    };

    const toggleRecord = async () => {
        if (isRecording) {
            const blob = await audioEngine.stopRecording();
            if (blob && onRecordingComplete) {
                onRecordingComplete(blob);
            }
        } else {
            await audioEngine.startRecording();
        }
    };

    return (
        <div
            id="bottom-controls-panel"
            className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-white/10 p-4 z-50 shadow-2xl"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">

                {/* Left: Playback & Recording */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => {
                            audioEngine.onSeek(0);
                            // If not playing, maybe we want to just reset position? 
                            // onSeek(0) does reset position. 
                            audioEngine.updateState({ playbackPosition: 0 });
                        }}
                        className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-all border",
                            "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                        )}
                        title="最初に戻る"
                    >
                        <SkipBack className="w-5 h-5 fill-current" />
                    </button>

                    <button
                        onClick={togglePlay}
                        className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                            isPlaying
                                ? "bg-red-500/20 text-red-500 hover:bg-red-500/30"
                                : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                        )}
                        title={isPlaying ? "停止 (Space)" : "再生 (Space)"}
                    >
                        {isPlaying ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
                    </button>

                    <button
                        onClick={toggleMic}
                        className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-all border",
                            isMicOn
                                ? "bg-red-500 text-white border-red-500 shadow-red-500/20 animate-pulse"
                                : "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                        )}
                        title="マイク入力切替"
                    >
                        <Mic className="w-5 h-5" />
                    </button>

                    <button
                        onClick={toggleRecord}
                        className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center transition-all border",
                            isRecording
                                ? "bg-red-600 text-white border-red-600 shadow-lg shadow-red-600/30"
                                : "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                        )}
                        title={isRecording ? "録音停止" : "録音開始"}
                    >
                        <div className={cn(
                            "w-4 h-4 rounded-full transition-all",
                            isRecording ? "bg-white rounded-sm" : "bg-red-500"
                        )} />
                    </button>
                </div>

                <div className="w-px h-8 bg-white/10 shrink-0 hidden sm:block" />

                {/* Guide & Backing Toggles */}
                <button
                    onClick={() => audioEngine.updateState({ isGuideSoundEnabled: !isGuideOn })}
                    className={cn(
                        "p-1.5 md:p-2.5 rounded-lg border transition-all shrink-0",
                        isGuideOn
                            ? "bg-purple-500/20 border-purple-500/40 text-purple-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={isGuideOn ? "ガイド音ON" : "ガイド音OFF"}
                >
                    <Music2 className="w-5 h-5" />
                </button>

                <button
                    onClick={() => audioEngine.updateState({ isBackingSoundEnabled: !isBackingOn })}
                    className={cn(
                        "p-1.5 md:p-2.5 rounded-lg border transition-all shrink-0",
                        isBackingOn
                            ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={isBackingOn ? "伴奏ON" : "伴奏OFF"}
                >
                    <Volume2 className="w-5 h-5" />
                </button>

                {/* Tempo Control (Simple +/-) */}
                {/* Tempo Control (Simple +/-) */}
                <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
                    <button
                        onClick={() => {
                            const current = typeof audioEngine.state.tempoFactor === 'number' ? audioEngine.state.tempoFactor : 1.0;
                            audioEngine.updateState({ tempoFactor: Math.max(0.1, current - 0.01) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="速度ダウン (-1%)"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <div className="px-1 text-xs font-mono text-white/70 min-w-[3em] text-center">
                        {Math.round((audioEngine.state.tempoFactor || 1) * 100)}%
                    </div>
                    <button
                        onClick={() => {
                            const current = typeof audioEngine.state.tempoFactor === 'number' ? audioEngine.state.tempoFactor : 1.0;
                            audioEngine.updateState({ tempoFactor: Math.min(2.0, current + 0.01) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="速度アップ (+1%)"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* Loop Toggle */}
                <button
                    onClick={() => {
                        const newLoopEnabled = !audioEngine.state.loopEnabled;
                        if (newLoopEnabled && audioEngine.state.loopEnd <= audioEngine.state.loopStart) {
                            // Set default loop range (current position + 10 seconds)
                            const start = audioEngine.state.playbackPosition;
                            audioEngine.updateState({
                                loopEnabled: true,
                                loopStart: start,
                                loopEnd: start + 4
                            });
                        } else {
                            audioEngine.updateState({ loopEnabled: newLoopEnabled });
                        }
                    }}
                    className={cn(
                        "p-1.5 md:p-2.5 rounded-l-lg border-y border-l transition-all shrink-0",
                        loopEnabled
                            ? "bg-orange-500/20 border-orange-500/40 text-orange-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={loopEnabled ? "ループOFF" : "ループON"}
                >
                    <Repeat className="w-5 h-5" />
                </button>
                {/* Loop Reset Button */}
                <button
                    onClick={() => {
                        audioEngine.updateState({
                            loopEnabled: false,
                            loopStart: 0,
                            loopEnd: 0
                        });
                    }}
                    className={cn(
                        "p-1.5 md:p-2.5 rounded-r-lg border transition-all shrink-0 -ml-px",
                        "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title="ループ解除・リセット"
                >
                    <div className="relative w-5 h-5 flex items-center justify-center">
                        <Repeat className="w-5 h-5 opacity-30" />
                        <X className="w-3 h-3 absolute" />
                    </div>
                </button>

                {/* Center: Tools */}
                <div className="flex items-center bg-white/5 rounded-full p-1 gap-1 shrink-0">
                    {[
                        { id: 'select', icon: MousePointer2, label: '選択' },
                        { id: 'view', icon: Hand, label: '移動' },
                        { id: 'pencil', icon: Pencil, label: 'ペン' },
                        { id: 'eraser', icon: Eraser, label: '消しゴム' }
                    ].map(tool => (
                        <button
                            key={tool.id}
                            onClick={() => audioEngine.setTool(tool.id as AudioEngineState['editTool'])}
                            className={cn(
                                "p-2 rounded-full transition-all relative group",
                                editTool === tool.id
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "text-white/50 hover:text-white hover:bg-white/10"
                            )}
                            title={tool.label}
                        >
                            <tool.icon className="w-5 h-5" />
                        </button>
                    ))}
                </div>

                <div className="w-px h-8 bg-white/10 shrink-0 hidden sm:block" />

                {/* Right: Actions */}
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                    {onOpenPractice && (
                        <button
                            onClick={onOpenPractice}
                            className="p-2.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all"
                            title="練習メニュー"
                        >
                            <Activity className="w-5 h-5" />
                        </button>
                    )}

                    {onOpenHistory && (
                        <button
                            onClick={onOpenHistory}
                            className="p-2.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all"
                            title="履歴と分析"
                        >
                            <Clock className="w-5 h-5" />
                        </button>
                    )}

                    <button
                        onClick={onOpenSettings}
                        className="p-2.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all"
                        title="設定"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* MIDI Selector Modal */}
            {showMidiSelector && (
                <MidiTrackSelector
                    tracks={midiTracks}
                    onSelect={handleMidiSelect}
                    onCancel={() => setShowMidiSelector(false)}
                    open={showMidiSelector}
                />
            )}
        </div>
    );
}
