import { X, Music, Star, Zap, BookOpen, Loader2, Trash2, FolderSync, AlertCircle, QrCode, ScanLine, Clock, BarChart2, SortAsc } from 'lucide-react';
import { type PresetSong } from '../lib/presetSongs';
import { QRShareModal } from './QRShareModal';
import { QRScanModal } from './QRScanModal';
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

type SortKey = 'recent' | 'name' | 'plays';

function formatRelativeTime(ts?: number): string {
    if (!ts) return '未練習';
    const diff = Date.now() - ts;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return '今日';
    if (days === 1) return '昨日';
    if (days < 7) return `${days}日前`;
    if (days < 30) return `${Math.floor(days / 7)}週間前`;
    return `${Math.floor(days / 30)}ヶ月前`;
}

export function PresetSongModal({ open, onClose }: PresetSongModalProps) {
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [userSongs, setUserSongs] = useState<PresetSong[]>([]);
    const [sharingQR, setSharingQR] = useState<PresetSong | null>(null);
    const [showScanner, setShowScanner] = useState(false);
    const [sortBy, setSortBy] = useState<SortKey>('recent');

    useEffect(() => {
        if (open) loadUserDocs();
    }, [open]);

    const loadUserDocs = async () => {
        const presets = await storage.loadUserPresets();
        setUserSongs(presets);
    };

    const sortedSongs = [...userSongs].sort((a, b) => {
        if (sortBy === 'recent') return (b.lastPlayed || b.createdAt || 0) - (a.lastPlayed || a.createdAt || 0);
        if (sortBy === 'name') return a.name.localeCompare(b.name, 'ja');
        if (sortBy === 'plays') return (b.playCount || 0) - (a.playCount || 0);
        return 0;
    });

    const handleDeleteUserSong = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('本当にこの曲を削除しますか？')) return;

        try {
            const newPresets = userSongs.filter(s => s.id !== id);
            await storage.saveUserPresets(newPresets);
            // Clean up MIDI binary if present
            await storage.deleteSongMidi(id).catch(() => {});
            setUserSongs(newPresets);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };



    const handleSelect = async (song: PresetSong) => {
        if (loadingId) return;
        setLoadingId(song.id);

        try {
            audioEngine.stopPractice();
            audioEngine.stopPlayback();

            // --- Load note data ---
            if (song.hasMidiData) {
                // A案: Load from stored MIDI binary
                const midiBuffer = await storage.loadSongMidi(song.id);
                if (midiBuffer) {
                    const candidates = audioEngine.loadMidiFromBuffer(midiBuffer);
                    if (candidates && candidates.length > 0) {
                        const track = candidates.find(t => t.noteCount > 0);
                        if (track) audioEngine.importMidiTrack(track.id, 0);
                    }
                } else if (song.notes) {
                    // Fallback to stored notes (binary may have been cleared)
                    audioEngine.updateState({
                        midiGhostNotes: [...song.notes],
                        playbackPosition: 0,
                        scoreResult: null,
                    });
                }
            } else if (song.midiUrl) {
                const candidates = await audioEngine.loadMidiFromUrl(song.midiUrl);
                if (candidates && candidates.length > 0) {
                    if (audioEngine.state.midiGhostNotes.length === 0) {
                        const track = candidates.find(t => t.noteCount > 0);
                        if (track) audioEngine.importMidiTrack(track.id, song.transpose || 0);
                    }
                }
            } else if (song.notes) {
                audioEngine.updateState({
                    midiGhostNotes: [...song.notes],
                    playbackPosition: 0,
                    scoreResult: null,
                });
            }

            // Backing track
            if (song.backingUrl) {
                const url = song.backingUrl;
                if (url.endsWith('.mid')) {
                    await audioEngine.loadBackingMidiFromUrl(url);
                }
            }

            // BPM (only if not embedded in MIDI binary)
            if (song.bpm && !song.hasMidiData) {
                audioEngine.updateState({ bpm: song.bpm });
            }

            // B案: Restore per-song settings + markers
            audioEngine.updateState({
                guideOctaveOffset: song.settings?.guideOctaveOffset ?? 0,
                transposeOffset: song.settings?.transposeOffset ?? 0,
                ...(song.settings?.toleranceCents !== undefined
                    ? { toleranceCents: song.settings.toleranceCents }
                    : {}),
                markers: song.markers ?? [],
            });

            // C案: Update practice metadata
            const now = Date.now();
            const updatedSongs = userSongs.map(s =>
                s.id === song.id
                    ? { ...s, lastPlayed: now, playCount: (s.playCount || 0) + 1 }
                    : s
            );
            await storage.saveUserPresets(updatedSongs);
            setUserSongs(updatedSongs);

            audioEngine.startPractice({ mode: 'Midi' });
            toast.success(`「${song.name}」を読み込みました`);
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('読み込みに失敗しました');
        } finally {
            setLoadingId(null);
        }
    };

    const handleQRImported = async (song: PresetSong) => {
        const current = await storage.loadUserPresets();
        const updated = [...current, song];
        await storage.saveUserPresets(updated);
        setUserSongs(updated);
        toast.success(`「${song.name}」をインポートしました`);
        setShowScanner(false);
    };

    if (!open) return null;

    const sortLabels: Record<SortKey, string> = {
        recent: '最近練習',
        name: '名前順',
        plays: '練習回数',
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-pink-400" />
                        練習曲ライブラリ
                        {userSongs.length > 0 && (
                            <span className="ml-1 bg-white/10 px-2 py-0.5 rounded-full text-xs text-white/60">
                                {userSongs.length}曲
                            </span>
                        )}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Warning */}
                <div className="mx-3 mt-3 shrink-0 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300/80">
                        データはこのブラウザにのみ保存されます。<strong>定期的にエクスポート</strong>してバックアップしてください。
                    </p>
                </div>

                {/* Toolbar */}
                <div className="px-3 pt-2 pb-2 flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                        onClick={() => setShowScanner(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-xs text-blue-300 hover:text-blue-200 transition-all"
                    >
                        <ScanLine className="w-3.5 h-3.5" /> QRスキャン
                    </button>

                    {/* Sort selector */}
                    {userSongs.length > 1 && (
                        <div className="ml-auto flex items-center gap-1 text-xs text-white/40">
                            <SortAsc className="w-3 h-3" />
                            {(['recent', 'name', 'plays'] as SortKey[]).map(key => (
                                <button
                                    key={key}
                                    onClick={() => setSortBy(key)}
                                    className={cn(
                                        "px-2 py-1 rounded transition-all",
                                        sortBy === key ? "bg-white/15 text-white/80" : "hover:bg-white/10 text-white/40"
                                    )}
                                >
                                    {sortLabels[key]}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Song List */}
                <div className="px-3 pb-3 overflow-y-auto flex-1 space-y-2 min-h-0">
                    {sortedSongs.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-white/30">
                            <FolderSync className="w-10 h-10 opacity-40" />
                            <p className="text-sm">曲が保存されていません</p>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/50 space-y-1.5 text-left w-full">
                                <p className="font-semibold text-white/60 mb-2">曲の追加方法</p>
                                <p>① MIDIファイルまたはガイド音声を読み込む</p>
                                <p>② 上部の「<strong className="text-white/70">保存</strong>」ボタンをタップ</p>
                                <p>③「<strong className="text-white/70">ライブラリに追加</strong>」を選ぶ</p>
                            </div>
                        </div>
                    ) : (
                        sortedSongs.map(song => {
                            const diff = difficultyConfig[song.difficulty] || difficultyConfig.medium;
                            const DiffIcon = diff.icon;
                            const isLoading = loadingId === song.id;

                            return (
                                <div key={song.id} className="relative">
                                    <button
                                        onClick={() => handleSelect(song)}
                                        disabled={!!loadingId}
                                        className={cn(
                                            "w-full p-4 pr-16 rounded-xl border transition-all text-left",
                                            isLoading ? "bg-white/10 border-white/20" : "bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20",
                                            loadingId && !isLoading && "opacity-50"
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                                                {isLoading
                                                    ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                                                    : <Music className="w-5 h-5 text-blue-400" />
                                                }
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-medium text-white truncate max-w-[160px]">
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
                                                {song.description && song.description !== 'User preset' && (
                                                    <p className="text-sm text-white/50 mt-0.5 truncate">{song.description}</p>
                                                )}
                                                {/* C案: metadata row */}
                                                <div className="flex items-center gap-2.5 mt-1.5 text-xs text-white/35 flex-wrap">
                                                    <span>♩ {song.bpm} BPM</span>
                                                    {song.notes && <span>• {song.notes.length}ノート</span>}
                                                    {song.hasMidiData && (
                                                        <span className="text-blue-400/70">• MIDI保存済</span>
                                                    )}
                                                    {song.lastPlayed ? (
                                                        <span className="flex items-center gap-0.5">
                                                            <Clock className="w-2.5 h-2.5" />
                                                            {formatRelativeTime(song.lastPlayed)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-white/20">• 未練習</span>
                                                    )}
                                                    {(song.playCount || 0) > 0 && (
                                                        <span className="flex items-center gap-0.5">
                                                            <BarChart2 className="w-2.5 h-2.5" />
                                                            {song.playCount}回
                                                        </span>
                                                    )}
                                                </div>
                                                {/* B案: saved settings hint */}
                                                {song.settings && (song.settings.guideOctaveOffset !== 0 || song.settings.transposeOffset !== 0) && (
                                                    <div className="mt-1 text-[10px] text-cyan-400/60">
                                                        設定: Oct{song.settings.guideOctaveOffset! > 0 ? '+' : ''}{song.settings.guideOctaveOffset ?? 0}
                                                        {song.settings.transposeOffset ? ` / 移調${song.settings.transposeOffset > 0 ? '+' : ''}${song.settings.transposeOffset}半音` : ''}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </button>

                                    {!isLoading && (
                                        <div className="absolute top-1/2 -translate-y-1/2 right-2 flex flex-col gap-1">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setSharingQR(song); }}
                                                className="p-2 rounded-full hover:bg-purple-500/20 text-white/30 hover:text-purple-400 transition-colors"
                                                title="QRコードで共有"
                                            >
                                                <QrCode className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteUserSong(e, song.id)}
                                                className="p-2 rounded-full hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-zinc-800/30 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/5"
                    >
                        閉じる
                    </button>
                </div>
            </div>

            {sharingQR && <QRShareModal song={sharingQR} onClose={() => setSharingQR(null)} />}
            {showScanner && <QRScanModal onClose={() => setShowScanner(false)} onImported={handleQRImported} />}
        </div>
    );
}
