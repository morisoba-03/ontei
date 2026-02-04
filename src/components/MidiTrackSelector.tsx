import { X, Music } from 'lucide-react';

export interface MidiTrackInfo {
    id: number;
    name: string;
    instrument: string;
    noteCount: number;
    channel: number;
}

interface MidiTrackSelectorProps {
    tracks: MidiTrackInfo[];
    onSelect: (trackId: number) => void;
    onCancel: () => void;
    open: boolean;
}

export function MidiTrackSelector({ tracks, onSelect, onCancel, open }: MidiTrackSelectorProps) {
    if (!open) return null;

    // Filter out empty tracks or make them less visible? 
    // For now, let's just show all tracks that have notes, assuming the parent filters them or we show them as disabled.
    // Actually the parent should filter.

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Music className="w-5 h-5 text-emerald-400" />
                        Select MIDI Track to Practice
                    </h2>
                    <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-2 flex-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {tracks.length === 0 ? (
                        <div className="p-12 text-center text-white/50 flex flex-col items-center gap-2">
                            <Music className="w-12 h-12 opacity-20" />
                            <p>No playable tracks found in this MIDI file.</p>
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            {tracks.map((track) => (
                                <button
                                    key={track.id}
                                    onClick={() => onSelect(track.id)}
                                    className="flex items-center gap-4 p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all group text-left border border-white/5 hover:border-emerald-500/30"
                                >
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-mono text-sm shrink-0">
                                        {track.id + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium truncate text-lg">{track.name || `Track ${track.id + 1}`}</div>
                                        <div className="text-white/50 text-sm flex items-center gap-3">
                                            <span className="flex items-center gap-1">
                                                {track.instrument}
                                            </span>
                                            <span className="w-1 h-1 rounded-full bg-white/20"></span>
                                            <span>{track.noteCount} notes</span>
                                        </div>
                                    </div>
                                    <div className="text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-semibold whitespace-nowrap px-2">
                                        Select
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-zinc-800/30 text-xs text-center text-white/40">
                    Importing a track will set it as the Guide (Call) for practice.
                </div>
            </div>
        </div>
    );
}
