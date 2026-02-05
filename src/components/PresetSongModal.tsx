import { X, Music, Star, Zap, BookOpen, Loader2 } from 'lucide-react';
import { presetSongs, type PresetSong } from '../lib/presetSongs';
import { audioEngine } from '../lib/AudioEngine';
import { cn } from '../lib/utils';
import { toast } from './Toast';
import { useState } from 'react';

interface PresetSongModalProps {
    open: boolean;
    onClose: () => void;
}

const difficultyConfig = {
    easy: { label: '初級', color: 'text-emerald-400 bg-emerald-500/20', icon: Star },
    medium: { label: '中級', color: 'text-yellow-400 bg-yellow-500/20', icon: Zap },
    hard: { label: '上級', color: 'text-red-400 bg-red-500/20', icon: Zap },
};

export function PresetSongModal({ open, onClose }: PresetSongModalProps) {
    const [loadingId, setLoadingId] = useState<string | null>(null);

    if (!open) return null;

    const handleSelect = async (song: PresetSong) => {
        if (loadingId) return;
        setLoadingId(song.id);

        try {
            audioEngine.stopPractice(); // Clear previous state
            audioEngine.stopPlayback();

            // Load Main Melody
            if (song.midiUrl) {
                // External MIDI File
                const candidates = await audioEngine.loadMidiFromUrl(song.midiUrl);

                // Auto-select the first playable track if not already done by loadMidiFromBuffer logic
                if (candidates && candidates.length > 0) {
                    // Check if a track was auto-imported (midiGhostNotes populated)
                    // Because loadMidiFromBuffer calls importMidiTrack if single track.
                    // But if multiple tracks, it sets midiTrackCandidates.
                    // For Ghibli "Flute" parts, it's usually 1 track.
                    if (audioEngine.state.midiGhostNotes.length === 0) {
                        // Find first track with notes
                        const track = candidates.find(t => t.noteCount > 0);
                        if (track) {
                            audioEngine.importMidiTrack(track.id);
                        }
                    }
                }
            } else if (song.notes) {
                // Internal Pattern
                audioEngine.updateState({
                    midiGhostNotes: [...song.notes],
                    playbackPosition: 0,
                    scoreResult: null
                });
            }

            // Load Backing if exists
            if (song.backingUrl) {
                if (song.backingUrl.endsWith('.mid')) {
                    await audioEngine.loadBackingMidiFromUrl(song.backingUrl);
                } else {
                    // Assume Audio
                    // AudioEngine currently handles File object for audio backing...
                    // Need fetch -> Blob -> File workaround or extend importBacking
                    // For now, only MIDI backing is supported via URL in this update.
                }
            }

            // Set BPM
            if (song.bpm) {
                audioEngine.updateState({ bpm: song.bpm });
            }

            // Enter Practice Mode
            audioEngine.startPractice({ mode: 'Midi' });

            toast.success(`「${song.name}」を読み込みました`);
            onClose();
        } catch (e) {
            console.error(e);
            toast.error("読み込みに失敗しました");
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-purple-400" />
                        練習曲ライブラリ
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Song List */}
                <div className="p-3 overflow-y-auto flex-1 space-y-2">
                    {presetSongs.map(song => {
                        const diff = difficultyConfig[song.difficulty];
                        const DiffIcon = diff.icon;
                        const isLoading = loadingId === song.id;

                        return (
                            <button
                                key={song.id}
                                onClick={() => handleSelect(song)}
                                disabled={!!loadingId}
                                className={cn(
                                    "w-full p-4 rounded-xl border transition-all text-left group relative overflow-hidden",
                                    isLoading ? "bg-white/10 border-white/20" : "bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20",
                                    loadingId && !isLoading && "opacity-50"
                                )}
                            >
                                <div className="flex items-start gap-3 relative z-10">
                                    <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                                        {isLoading ? (
                                            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                                        ) : (
                                            <Music className="w-5 h-5 text-purple-400" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-white group-hover:text-purple-300 transition-colors">
                                                {song.name}
                                            </span>
                                            <span className={cn(
                                                "text-xs px-2 py-0.5 rounded-full flex items-center gap-1",
                                                diff.color
                                            )}>
                                                <DiffIcon className="w-3 h-3" />
                                                {diff.label}
                                            </span>
                                        </div>
                                        <p className="text-sm text-white/50 mt-0.5">{song.description}</p>
                                        <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
                                            <span>♩ {song.bpm} BPM</span>
                                            {song.notes ? (
                                                <span>• {song.notes.length}ノート</span>
                                            ) : (
                                                <span>• MIDI</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-white/10 bg-zinc-800/30 shrink-0">
                    <p className="text-xs text-white/40 text-center">
                        曲を選択すると練習を開始できます
                    </p>
                </div>
            </div>
        </div>
    );
}
