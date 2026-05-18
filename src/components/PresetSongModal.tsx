import { X, Music, Star, Zap, BookOpen, Loader2, Download, Upload, Trash2, FolderSync, AlertCircle, QrCode, ScanLine } from 'lucide-react';
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

export function PresetSongModal({ open, onClose }: PresetSongModalProps) {
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [userSongs, setUserSongs] = useState<PresetSong[]>([]);
    const [sharingQR, setSharingQR] = useState<PresetSong | null>(null);
    const [showScanner, setShowScanner] = useState(false);

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
        } catch {
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
        e.target.value = '';
    };

    const handleSelect = async (song: PresetSong) => {
        if (loadingId) return;
        setLoadingId(song.id);

        try {
            audioEngine.stopPractice();
            audioEngine.stopPlayback();

            if (song.midiUrl) {
                const candidates = await audioEngine.loadMidiFromUrl(song.midiUrl);
                if (candidates && candidates.length > 0) {
                    if (audioEngine.state.midiGhostNotes.length === 0) {
                        const track = candidates.find(t => t.noteCount > 0);
                        if (track) {
                            audioEngine.importMidiTrack(track.id, song.transpose || 0);
                            audioEngine.updateState({ guideOctaveOffset: 0, transposeOffset: 0 });
                        }
                    }
                }
            } else if (song.notes) {
                audioEngine.updateState({
                    midiGhostNotes: [...song.notes],
                    playbackPosition: 0,
                    scoreResult: null,
                    guideOctaveOffset: 0,
                    transposeOffset: 0
                });
            }

            let backingName: string | null = null;
            if (song.backingUrl) {
                const url = song.backingUrl;
                if (url.endsWith('.mid')) {
                    backingName = await audioEngine.loadBackingMidiFromUrl(url);
                }
            }

            if (song.bpm) {
                audioEngine.updateState({ bpm: song.bpm });
            }

            audioEngine.startPractice({ mode: 'Midi' });

            toast.success(backingName
                ? `「${song.name}」を読み込みました\n(伴奏: ${backingName})`
                : `「${song.name}」を読み込みました`
            );
            onClose();
        } catch (e) {
            console.error(e);
            toast.error("読み込みに失敗しました");
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

                {/* ブラウザ保存の注意 */}
                <div className="mx-3 mt-3 shrink-0 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300/80">
                        曲はこのブラウザにのみ保存されます。ブラウザのキャッシュ削除で消えるため、<strong>定期的にエクスポートしてバックアップ</strong>してください。
                    </p>
                </div>

                {/* Toolbar */}
                <div className="px-3 pt-2 pb-2 flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                        onClick={() => setShowScanner(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-xs text-blue-300 hover:text-blue-200 transition-all"
                        title="QRコードをスキャンして曲をインポート"
                    >
                        <ScanLine className="w-3.5 h-3.5" /> QRスキャン
                    </button>
                    <button
                        onClick={() => document.getElementById('user-lib-import')?.click()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/70 hover:text-white transition-all"
                        title="JSONファイルからインポート"
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

                {/* Song List */}
                <div className="px-3 pb-3 overflow-y-auto flex-1 space-y-2 min-h-0">
                    {userSongs.length === 0 ? (
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
                        userSongs.map(song => {
                            const diff = difficultyConfig[song.difficulty] || difficultyConfig.medium;
                            const DiffIcon = diff.icon;
                            const isLoading = loadingId === song.id;

                            return (
                                <div key={song.id} className="relative">
                                    <button
                                        onClick={() => handleSelect(song)}
                                        disabled={!!loadingId}
                                        className={cn(
                                            "w-full p-4 pr-14 rounded-xl border transition-all text-left",
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
                                                    <span className="font-medium text-white truncate max-w-[180px]">
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
                                                <div className="flex items-center gap-3 mt-1.5 text-xs text-white/40">
                                                    <span>♩ {song.bpm} BPM</span>
                                                    {song.notes && <span>• {song.notes.length}ノート</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </button>

                                    {/* QR共有・削除ボタン（常時表示） */}
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

            {/* QR Share / Scan sub-modals */}
            {sharingQR && <QRShareModal song={sharingQR} onClose={() => setSharingQR(null)} />}
            {showScanner && <QRScanModal onClose={() => setShowScanner(false)} onImported={handleQRImported} />}
        </div>
    );
}
