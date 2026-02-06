import { X, Music, Star, Zap, BookOpen, Loader2, Download, Upload, Trash2, FolderSync } from 'lucide-react';
import { presetSongs, type PresetSong } from '../lib/presetSongs';
import { audioEngine } from '../lib/AudioEngine';
import { storage } from '../lib/storage';
import { cn } from '../lib/utils';
import { toast } from './Toast';
import { useState, useEffect } from 'react';

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
    const [userSongs, setUserSongs] = useState<PresetSong[]>([]);
    const [tab, setTab] = useState<'preset' | 'user'>('preset');

    useEffect(() => {
        if (open) {
            loadUserDocs();
        }
    }, [open]);

    const loadUserDocs = async () => {
        const presets = await storage.loadUserPresets();
        setUserSongs(presets);
    };

    const handleDeleteUserSong = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('本当にこの曲を削除しますか？')) return;

        try {
            const newPresets = userSongs.filter(s => s.id !== id);
            await storage.saveUserPresets(newPresets);
            setUserSongs(newPresets);
            toast.success('削除しました');
        } catch (e) {
            toast.error('削除に失敗しました');
        }
    };

    const handleExportLibrary = () => {
        if (userSongs.length === 0) {
            toast.error('エクスポートする曲がありません');
            return;
        }
        const json = JSON.stringify(userSongs, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ontei-library-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`ライブラリ(${userSongs.length}曲)をエクスポートしました`);
    };

    const handleImportLibrary = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const content = ev.target?.result as string;
                const json = JSON.parse(content);

                if (!Array.isArray(json)) throw new Error('Invalid format');

                const current = await storage.loadUserPresets();
                const currentMap = new Map(current.map(s => [s.id, s]));

                let addedCount = 0;
                let updatedCount = 0;

                for (const item of json) {
                    if (!item.name || !item.notes) continue;

                    // Simple ID conflict resolution: overwrite if same ID
                    if (currentMap.has(item.id)) {
                        updatedCount++;
                    } else {
                        addedCount++;
                    }
                    currentMap.set(item.id, item);
                }

                const newPresets = Array.from(currentMap.values());
                await storage.saveUserPresets(newPresets);
                setUserSongs(newPresets);
                toast.success(`${addedCount}曲を追加、${updatedCount}曲を更新しました`);
            } catch (err) {
                console.error(err);
                toast.error('読み込みに失敗しました。正しいJSONファイルか確認してください。');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    };

    const handleSelect = async (song: PresetSong) => {
        if (loadingId) return;
        setLoadingId(song.id);

        try {
            audioEngine.stopPractice();
            audioEngine.stopPlayback();

            // Load Main Melody
            if (song.midiUrl) {
                // External MIDI File logic (mostly for built-in presets)
                const candidates = await audioEngine.loadMidiFromUrl(song.midiUrl);
                if (candidates && candidates.length > 0) {
                    if (audioEngine.state.midiGhostNotes.length === 0) {
                        const track = candidates.find(t => t.noteCount > 0);
                        if (track) {
                            audioEngine.importMidiTrack(track.id, song.transpose || 0);
                            audioEngine.updateState({
                                guideOctaveOffset: 0,
                                transposeOffset: 0
                            });
                        }
                    }
                }
            } else if (song.notes) {
                // Internal Pattern / User Preset
                audioEngine.updateState({
                    midiGhostNotes: [...song.notes],
                    playbackPosition: 0,
                    scoreResult: null,
                    guideOctaveOffset: 0,
                    transposeOffset: 0
                });
            }

            // Load Backing
            if (song.backingUrl) {
                if (song.backingUrl.endsWith('.mid')) {
                    await audioEngine.loadBackingMidiFromUrl(song.backingUrl);
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

    if (!open) return null;

    const displaySongs = tab === 'preset' ? presetSongs : userSongs;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-pink-400" />
                        練習曲ライブラリ
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10 shrink-0">
                    <button
                        onClick={() => setTab('preset')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2",
                            tab === 'preset'
                                ? "border-pink-500 text-pink-400 bg-white/5"
                                : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        プリセット曲
                    </button>
                    <button
                        onClick={() => setTab('user')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2",
                            tab === 'user'
                                ? "border-blue-500 text-blue-400 bg-white/5"
                                : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        ユーザー曲
                        {userSongs.length > 0 && <span className="ml-2 bg-white/10 px-1.5 py-0.5 rounded-full text-xs">{userSongs.length}</span>}
                    </button>
                </div>

                {/* Import/Export Toolbar (User Tab Only) */}
                {tab === 'user' && (
                    <div className="p-2 border-b border-white/10 bg-zinc-800/30 flex items-center justify-between gap-2 shrink-0">
                        <div className="flex gap-2">
                            <button
                                onClick={() => document.getElementById('user-lib-import')?.click()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white transition-all"
                                title="JSONファイルを読み込む"
                            >
                                <Upload className="w-3.5 h-3.5" /> インポート
                            </button>
                            <input
                                id="user-lib-import"
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={handleImportLibrary}
                            />

                            <button
                                onClick={handleExportLibrary}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white transition-all"
                                title="すべてのユーザー曲をJSONとして保存"
                            >
                                <Download className="w-3.5 h-3.5" /> エクスポート
                            </button>
                        </div>
                        <div className="text-[10px] text-white/30 mr-1">
                            バックアップ推奨
                        </div>
                    </div>
                )}

                {/* Song List */}
                <div className="p-3 overflow-y-auto flex-1 space-y-2 min-h-0">
                    {displaySongs.length === 0 ? (
                        <div className="text-center py-10 text-white/30">
                            {tab === 'user' ? (
                                <div className="flex flex-col items-center gap-2">
                                    <FolderSync className="w-8 h-8 opacity-50" />
                                    <p>曲が保存されていません</p>
                                    <p className="text-xs">作成した曲を「SAVE &gt; ライブラリに追加」<br />またはインポートしてください</p>
                                </div>
                            ) : (
                                <p>プリセットがありません</p>
                            )}
                        </div>
                    ) : (
                        displaySongs.map(song => {
                            const diff = difficultyConfig[song.difficulty] || difficultyConfig.medium;
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
                                        <div className="w-10 h-10 rounded-lg bg-current/10 flex items-center justify-center shrink-0">
                                            {isLoading ? (
                                                <Loader2 className="w-5 h-5 text-current animate-spin" />
                                            ) : (
                                                <Music className={cn("w-5 h-5", tab === 'user' ? 'text-blue-400' : 'text-pink-400')} />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-white group-hover:text-blue-300 transition-colors truncate block max-w-[200px]">
                                                    {song.name}
                                                </span>
                                                <span className={cn(
                                                    "text-xs px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0",
                                                    diff.color
                                                )}>
                                                    <DiffIcon className="w-3 h-3" />
                                                    {diff.label}
                                                </span>
                                            </div>
                                            <p className="text-sm text-white/50 mt-0.5 truncate">{song.description}</p>
                                            <div className="flex items-center gap-3 mt-2 text-xs text-white/40">
                                                <span>♩ {song.bpm} BPM</span>
                                                {song.notes && (
                                                    <span>• {song.notes.length}ノート</span>
                                                )}
                                                {/* Date if available (for future) */}
                                            </div>
                                        </div>

                                        {/* Delete Button (User tab only) */}
                                        {tab === 'user' && !isLoading && (
                                            <div
                                                onClick={(e) => handleDeleteUserSong(e, song.id)}
                                                className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/20 text-white/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-white/10 bg-zinc-800/30 shrink-0">
                    <p className="text-xs text-white/40 text-center">
                        {tab === 'user'
                            ? "バックアップとしてエクスポートしておくことを推奨します"
                            : "曲を選択すると練習を開始できます"}
                    </p>
                </div>
            </div>
        </div>
    );
}
