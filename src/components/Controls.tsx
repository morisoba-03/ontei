import { useState, useEffect } from 'react';
import { Play, Square, MousePointer2, Hand, Pencil, Eraser, Settings, Activity, Clock, Repeat, SkipBack, Music2, Music, Volume2, X, Plus, Minus, ListMusic } from 'lucide-react';
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
    onOpenScalePractice?: () => void;
}

export function Controls({ onOpenSettings, onOpenPractice, onOpenHistory, onRecordingComplete, onOpenScalePractice }: ControlsProps) {
    const [isPlaying, setIsPlaying] = useState(audioEngine.state.isPlaying);
    const [isRecording, setIsRecording] = useState(audioEngine.isRecording);
    const [editTool, setEditTool] = useState(audioEngine.state.editTool);
    const [loopEnabled, setLoopEnabled] = useState(audioEngine.state.loopEnabled);
    const [midiTracks, setMidiTracks] = useState<MidiTrackInfo[]>([]);
    const [showMidiSelector, setShowMidiSelector] = useState(false);
    const [isGuideOn, setIsGuideOn] = useState(audioEngine.state.isGuideSoundEnabled);
    const [isBackingOn, setIsBackingOn] = useState(audioEngine.state.isBackingSoundEnabled);
    const [availableTracks, setAvailableTracks] = useState<MidiTrackInfo[]>(audioEngine.state.midiAvailableTracks || []);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(audioEngine.state.melodyTrackIndex);

    useEffect(() => {
        const unsub = audioEngine.subscribe(() => {
            setIsPlaying(audioEngine.state.isPlaying);
            setIsRecording(audioEngine.isRecording);
            setEditTool(audioEngine.state.editTool);
            setLoopEnabled(audioEngine.state.loopEnabled);
            setIsGuideOn(audioEngine.state.isGuideSoundEnabled);
            setIsBackingOn(audioEngine.state.isBackingSoundEnabled);
            setCurrentTrackIndex(audioEngine.state.melodyTrackIndex);

            if (audioEngine.state.midiAvailableTracks) {
                setAvailableTracks(audioEngine.state.midiAvailableTracks);
            }

            // Check for MIDI candidates to import (triggers selector popup)
            const candidates = audioEngine.state.midiTrackCandidates;
            if (candidates && candidates.length > 0) {
                setMidiTracks(candidates);
                setShowMidiSelector(true);
                audioEngine.updateState({ midiTrackCandidates: undefined });
            }
        });

        return unsub;
    }, []);

    const togglePlay = async () => {
        if (audioEngine.state.isPlaying) {
            audioEngine.stopPlayback();
        } else {
            await audioEngine.ensureAudio();
            audioEngine.startPlayback();
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
            <div className="w-full flex items-center justify-start md:justify-center gap-2 md:gap-4 px-4 overflow-x-auto xl:overflow-visible no-scrollbar">

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
                {/* Display Scale Control (visual zoom only) */}
                <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
                    <button
                        onClick={() => {
                            const current = audioEngine.state.pxPerSec || 100;
                            audioEngine.updateState({ pxPerSec: Math.max(20, current - 5) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="表示倍率ダウン (-5%)"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <div className="px-1 text-xs font-mono text-white/70 min-w-[3em] text-center">
                        {Math.round(audioEngine.state.pxPerSec || 100)}%
                    </div>
                    <button
                        onClick={() => {
                            const current = audioEngine.state.pxPerSec || 100;
                            audioEngine.updateState({ pxPerSec: Math.min(400, current + 5) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="表示倍率アップ (+5%)"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* BPM Control */}
                <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
                    <button
                        onClick={() => {
                            const base = audioEngine.state.baseBpm || 120;
                            const newBpm = Math.max(20, audioEngine.state.bpm - 5);
                            audioEngine.updateState({ bpm: newBpm, tempoFactor: newBpm / base });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="BPMダウン (-5)"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <div className="px-1 text-xs font-mono text-white/70 min-w-[4.5em] text-center leading-tight">
                        <div>{audioEngine.state.bpm}</div>
                        <div className="text-[9px] text-white/40">BPM</div>
                    </div>
                    <button
                        onClick={() => {
                            const base = audioEngine.state.baseBpm || 120;
                            const newBpm = Math.min(300, audioEngine.state.bpm + 5);
                            audioEngine.updateState({ bpm: newBpm, tempoFactor: newBpm / base });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="BPMアップ (+5)"
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
                    {/* Track change button — shown when MIDI with multiple tracks is loaded */}
                    {availableTracks.filter(t => t.noteCount > 0).length > 1 && (
                        <button
                            onClick={() => {
                                setMidiTracks(availableTracks);
                                setShowMidiSelector(true);
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs max-w-[120px]"
                            title="練習トラックを変更"
                        >
                            <ListMusic className="w-4 h-4 shrink-0" />
                            <span className="truncate">
                                {availableTracks.find(t => t.id === currentTrackIndex)?.name || `Track ${currentTrackIndex + 1}`}
                            </span>
                        </button>
                    )}

                    {onOpenScalePractice && (
                        <button
                            onClick={onOpenScalePractice}
                            className="p-2.5 rounded-lg border border-white/10 bg-white/5 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-all"
                            title="スケール練習"
                        >
                            <Music className="w-5 h-5" />
                        </button>
                    )}

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
                    selectedId={currentTrackIndex}
                />
            )}
        </div>
    );
}
