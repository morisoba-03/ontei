import { X, Music, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

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
    selectedId?: number;
}

export function MidiTrackSelector({ tracks, onSelect, onCancel, open, selectedId }: MidiTrackSelectorProps) {
    if (!open) return null;

    const playable = tracks.filter(t => t.noteCount > 0);
    const empty = tracks.filter(t => t.noteCount === 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <Music className="w-5 h-5 text-emerald-400" />
                        練習するトラックを選択
                    </h2>
                    <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-3 flex-1">
                    {playable.length === 0 ? (
                        <div className="p-12 text-center text-white/50 flex flex-col items-center gap-2">
                            <Music className="w-12 h-12 opacity-20" />
                            <p>ノートが含まれるトラックが見つかりません</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {playable.map((track) => {
                                const isCurrent = track.id === selectedId;
                                return (
                                    <button
                                        key={track.id}
                                        onClick={() => onSelect(track.id)}
                                        className={cn(
                                            "w-full flex items-center gap-4 p-4 rounded-xl transition-all text-left border",
                                            isCurrent
                                                ? "bg-emerald-500/15 border-emerald-500/40 ring-1 ring-emerald-500/30"
                                                : "bg-white/5 hover:bg-white/10 border-white/10 hover:border-emerald-500/30"
                                        )}
                                    >
                                        <div className={cn(
                                            "w-10 h-10 rounded-full flex items-center justify-center font-mono text-sm shrink-0",
                                            isCurrent ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/60"
                                        )}>
                                            {track.id + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className={cn("font-medium truncate", isCurrent ? "text-emerald-300" : "text-white")}>
                                                {track.name || `Track ${track.id + 1}`}
                                            </div>
                                            <div className="text-white/50 text-sm flex items-center gap-2 mt-0.5">
                                                <span>{track.instrument || '不明'}</span>
                                                <span className="w-1 h-1 rounded-full bg-white/20" />
                                                <span>{track.noteCount}ノート</span>
                                                {track.channel !== undefined && (
                                                    <>
                                                        <span className="w-1 h-1 rounded-full bg-white/20" />
                                                        <span>Ch.{track.channel + 1}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {isCurrent ? (
                                            <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium shrink-0">
                                                <CheckCircle2 className="w-4 h-4" />
                                                現在選択中
                                            </div>
                                        ) : (
                                            <div className="text-white/30 group-hover:text-emerald-400 text-xs font-medium shrink-0 opacity-0 group-hover:opacity-100">
                                                選択
                                            </div>
                                        )}
                                    </button>
                                );
                            })}

                            {empty.length > 0 && (
                                <div className="mt-3 pt-3 border-t border-white/5">
                                    <p className="text-xs text-white/30 px-1 mb-2">空のトラック（選択不可）</p>
                                    {empty.map(track => (
                                        <div key={track.id} className="flex items-center gap-4 p-3 rounded-lg opacity-30">
                                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center font-mono text-xs text-white/40 shrink-0">
                                                {track.id + 1}
                                            </div>
                                            <div className="text-white/40 text-sm">{track.name || `Track ${track.id + 1}`}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-white/10 bg-zinc-800/30 text-xs text-center text-white/40">
                    選択したトラックがガイドメロディになります
                </div>
            </div>
        </div>
    );
}
