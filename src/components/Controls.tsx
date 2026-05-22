import { useState, useEffect, useRef } from 'react';
import { Play, Square, MousePointer2, Hand, Pencil, Eraser, Settings, Activity, Repeat, SkipBack, Music2, Music, Volume2, X, Plus, Minus, ListMusic, Flag, Timer } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { MidiTrackSelector } from './MidiTrackSelector';
import type { MidiTrackInfo } from './MidiTrackSelector';
import type { AudioEngineState, Marker } from '../lib/types';
import { cn } from '../lib/utils';
import { toast } from './Toast';
// Unused modal imports removed since they are handled by App.tsx callbacks

interface ControlsProps {
    onOpenSettings: () => void;
    onOpenPractice: () => void; // Not used here yet but in props
    onRecordingComplete?: (blob: Blob) => void;
    onOpenScalePractice?: () => void;
}

export function Controls({ onOpenSettings, onOpenPractice, onRecordingComplete, onOpenScalePractice }: ControlsProps) {
    const [isPlaying, setIsPlaying] = useState(audioEngine.state.isPlaying);
    const [isRecording, setIsRecording] = useState(audioEngine.isRecording);
    const [editTool, setEditTool] = useState(audioEngine.state.editTool);
    const [loopEnabled, setLoopEnabled] = useState(audioEngine.state.loopEnabled);
    const [midiTracks, setMidiTracks] = useState<MidiTrackInfo[]>([]);
    const [showMidiSelector, setShowMidiSelector] = useState(false);
    const [isGuideOn, setIsGuideOn] = useState(audioEngine.state.isGuideSoundEnabled);
    const [isBackingOn, setIsBackingOn] = useState(audioEngine.state.isBackingSoundEnabled);
    const [availableTracks, setAvailableTracks] = useState<MidiTrackInfo[]>(audioEngine.state.midiAvailableTracks || []);
    const [currentTrackIndex, setCurrentTrackIndex] = useState(audioEngine.state.selectedMidiTrackId ?? audioEngine.state.melodyTrackIndex);
    const [markers, setMarkers] = useState<Marker[]>(audioEngine.state.markers);
    const [countIn, setCountIn] = useState(audioEngine.state.countIn);
    const [markerLoopAnchor, setMarkerLoopAnchor] = useState<string | null>(null);
    const longPressTimer = useRef<number | null>(null);
    const longPressActivated = useRef(false);

    useEffect(() => {
        const unsub = audioEngine.subscribe(() => {
            setIsPlaying(audioEngine.state.isPlaying);
            setIsRecording(audioEngine.isRecording);
            setEditTool(audioEngine.state.editTool);
            setLoopEnabled(audioEngine.state.loopEnabled);
            setIsGuideOn(audioEngine.state.isGuideSoundEnabled);
            setIsBackingOn(audioEngine.state.isBackingSoundEnabled);
            setCurrentTrackIndex(audioEngine.state.selectedMidiTrackId ?? audioEngine.state.melodyTrackIndex);
            setMarkers([...audioEngine.state.markers]);
            setCountIn(audioEngine.state.countIn);

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

    const handleMarkerLongPress = (marker: Marker) => {
        longPressActivated.current = true;
        if (!markerLoopAnchor) {
            setMarkerLoopAnchor(marker.id);
            toast.info(`マーカー ${marker.id} をループ開始点に設定。別のマーカーを長押しで区間確定。`);
        } else {
            const anchor = markers.find(m => m.id === markerLoopAnchor);
            if (anchor) {
                const [start, end] = anchor.time <= marker.time
                    ? [anchor.time, marker.time]
                    : [marker.time, anchor.time];
                audioEngine.updateState({ loopEnabled: true, loopStart: start, loopEnd: end });
                toast.success(`ループ設定: ${markerLoopAnchor}〜${marker.id}`);
            }
            setMarkerLoopAnchor(null);
        }
    };

    const onMarkerPointerDown = (marker: Marker) => {
        longPressActivated.current = false;
        longPressTimer.current = window.setTimeout(() => handleMarkerLongPress(marker), 500);
    };

    const onMarkerPointerUp = () => {
        if (longPressTimer.current !== null) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
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
            className="fixed bottom-0 left-0 right-0 bg-neutral-900 border-t border-white/10 z-50 shadow-2xl"
            style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
            <div className="w-full overflow-x-auto no-scrollbar touch-pan-x">
              <div className="flex items-center justify-start gap-1.5 md:gap-4 px-2 md:px-4 py-2 md:py-4 min-w-max md:mx-auto">

                {/* Left: Playback & Recording */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => {
                            audioEngine.onSeek(0);
                            audioEngine.updateState({ playbackPosition: 0 });
                        }}
                        className={cn(
                            "w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all border shrink-0",
                            "bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                        )}
                        title="最初に戻る"
                    >
                        <SkipBack className="w-4 h-4 md:w-5 md:h-5 fill-current" />
                    </button>

                    <button
                        onClick={togglePlay}
                        className={cn(
                            "w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all shrink-0",
                            isPlaying
                                ? "bg-red-500/20 text-red-500 hover:bg-red-500/30"
                                : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                        )}
                        title={isPlaying ? "停止 (Space)" : "再生 (Space)"}
                    >
                        {isPlaying ? <Square className="w-4 h-4 md:w-5 md:h-5 fill-current" /> : <Play className="w-4 h-4 md:w-5 md:h-5 fill-current translate-x-0.5" />}
                    </button>

                    <button
                        onClick={toggleRecord}
                        className={cn(
                            "w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-all border shrink-0",
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
                        "p-1.5 rounded-lg border transition-all shrink-0",
                        isGuideOn
                            ? "bg-purple-500/20 border-purple-500/40 text-purple-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={isGuideOn ? "ガイド音ON" : "ガイド音OFF"}
                >
                    <Music2 className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                <button
                    onClick={() => audioEngine.updateState({ isBackingSoundEnabled: !isBackingOn })}
                    className={cn(
                        "p-1.5 rounded-lg border transition-all shrink-0",
                        isBackingOn
                            ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={isBackingOn ? "伴奏ON" : "伴奏OFF"}
                >
                    <Volume2 className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                {/* Settings — placed between backing and scale for quick access */}
                <button
                    onClick={onOpenSettings}
                    className="p-1.5 md:p-2 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all shrink-0"
                    title="設定"
                >
                    <Settings className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                {/* Tempo Control (Simple +/-) */}
                {/* Display Scale Control (visual zoom only) */}
                <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
                    <button
                        onClick={() => {
                            const current = audioEngine.state.pxPerSec || 130;
                            audioEngine.updateState({ pxPerSec: Math.max(20, current - 5) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="表示倍率ダウン"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <div className="px-1 text-xs font-mono text-white/70 min-w-[3em] text-center">
                        {Math.round((audioEngine.state.pxPerSec || 130) / 130 * 100)}%
                    </div>
                    <button
                        onClick={() => {
                            const current = audioEngine.state.pxPerSec || 130;
                            audioEngine.updateState({ pxPerSec: Math.min(400, current + 5) });
                        }}
                        className="p-1.5 md:p-2 hover:bg-white/10 rounded-md text-white/50 hover:text-white transition-colors"
                        title="表示倍率アップ"
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
                        <div>
                            {audioEngine.state.bpm}
                            {audioEngine.state.tempoMap && audioEngine.state.tempoMap.length > 1
                                && audioEngine.state.currentBpm
                                && audioEngine.state.currentBpm !== audioEngine.state.bpm && (
                                <span className="text-[10px] text-yellow-300 ml-0.5">→{audioEngine.state.currentBpm}</span>
                            )}
                        </div>
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

                {/* Count-in Toggle */}
                <button
                    onClick={() => audioEngine.updateState({ countIn: !countIn })}
                    className={cn(
                        "p-1.5 md:p-2 rounded-lg border transition-all shrink-0",
                        countIn
                            ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                            : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    )}
                    title={countIn ? "カウントインON（4拍）— クリックでOFF" : "カウントインOFF — クリックでON"}
                >
                    <Timer className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                {/* Add Marker Button */}
                <button
                    onClick={() => audioEngine.addMarker()}
                    disabled={markers.length >= 26}
                    className={cn(
                        "p-1.5 md:p-2 rounded-lg border transition-all shrink-0",
                        markers.length >= 26
                            ? "bg-white/5 border-white/10 text-white/20 cursor-not-allowed"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                    )}
                    title="現在位置にマーカーを追加"
                >
                    <Flag className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                {/* Center: Tools */}
                <div className="flex items-center bg-white/5 rounded-full p-0.5 gap-0.5 shrink-0">
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
                                "p-1.5 md:p-2 rounded-full transition-all relative group",
                                editTool === tool.id
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "text-white/50 hover:text-white hover:bg-white/10"
                            )}
                            title={tool.label}
                        >
                            <tool.icon className="w-4 h-4 md:w-5 md:h-5" />
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
                            className="p-1.5 md:p-2.5 rounded-lg border border-white/10 bg-white/5 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-all shrink-0"
                            title="スケール練習"
                        >
                            <Music className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                    )}

                    {onOpenPractice && (
                        <button
                            onClick={onOpenPractice}
                            className="p-1.5 md:p-2.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all shrink-0"
                            title="練習メニュー"
                        >
                            <Activity className="w-4 h-4 md:w-5 md:h-5" />
                        </button>
                    )}

                </div>
            </div>
            </div>{/* end scroll inner */}

            {/* Marker buttons row */}
            {markers.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 pb-1 overflow-x-auto no-scrollbar touch-pan-x">
                    {markers.map(marker => {
                        const isAnchor = markerLoopAnchor === marker.id;
                        return (
                            <button
                                key={marker.id}
                                onClick={() => {
                                    if (!longPressActivated.current) {
                                        audioEngine.updateState({ playbackPosition: marker.time });
                                        audioEngine.onSeek(marker.time);
                                    }
                                    longPressActivated.current = false;
                                }}
                                onPointerDown={() => onMarkerPointerDown(marker)}
                                onPointerUp={onMarkerPointerUp}
                                onPointerLeave={onMarkerPointerUp}
                                onContextMenu={e => { e.preventDefault(); audioEngine.removeMarker(marker.id); setMarkerLoopAnchor(null); }}
                                className={cn(
                                    "flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold transition-all shrink-0 select-none",
                                    isAnchor
                                        ? "bg-orange-500/30 border-orange-400 text-orange-300 ring-1 ring-orange-400"
                                        : "bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25"
                                )}
                                title={`マーカー ${marker.id}（クリック: シーク / 長押し: ループ端点 / 右クリック: 削除）`}
                            >
                                {marker.id}
                            </button>
                        );
                    })}
                </div>
            )}

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
