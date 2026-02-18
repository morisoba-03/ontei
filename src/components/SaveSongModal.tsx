import { useState } from 'react';
import { X, Save, Download, FileJson, Library } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { storage } from '../lib/storage';
import { toast } from './Toast';
import { cn } from '../lib/utils';
import type { PresetSong } from '../lib/presetSongs';

interface SaveSongModalProps {
    open: boolean;
    onClose: () => void;
}

export function SaveSongModal({ open, onClose }: SaveSongModalProps) {
    const [mode, setMode] = useState<'file' | 'library'>('library');
    const [title, setTitle] = useState('');
    const [difficulty, setDifficulty] = useState<PresetSong['difficulty']>('medium');
    const [description, setDescription] = useState('');

    if (!open) return null;

    const handleSaveToFile = () => {
        const sessionData = audioEngine.exportSession();
        const blob = new Blob([sessionData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ontei-session-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('プロジェクトファイルを保存しました');
        onClose();
    };

    const handleAddToLibrary = async () => {
        if (!title.trim()) {
            toast.error('タイトルを入力してください');
            return;
        }

        // Get notes from current state
        let notes = [...audioEngine.state.midiGhostNotes];

        // If no ghost notes, try to get from melodic tracks
        if (notes.length === 0 && audioEngine.state.currentTracks.length > 0) {
            const trackIndex = audioEngine.state.melodyTrackIndex >= 0
                ? audioEngine.state.melodyTrackIndex
                : 0;
            const track = audioEngine.state.currentTracks[trackIndex];

            if (track && track.notes.length > 0) {
                notes = track.notes.map(n => ({
                    midi: n.midi,
                    time: n.time,
                    duration: n.duration,
                    role: 'call' as const
                }));
            }
        }

        if (notes.length === 0) {
            toast.error('保存するノートデータがありません');
            return;
        }

        const newSong: PresetSong = {
            id: 'user-' + Date.now(),
            name: title,
            description: description || 'User preset',
            difficulty,
            bpm: audioEngine.state.bpm || 120,
            notes: notes,
            // User presets typically store logic notes directly
        };

        try {
            const current = await storage.loadUserPresets();
            await storage.saveUserPresets([...current, newSong]);
            toast.success('練習曲ライブラリに追加しました');
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('保存に失敗しました');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Save className="w-5 h-5 text-green-400" />
                        保存オプション
                    </h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex border-b border-white/10">
                    <button
                        onClick={() => setMode('library')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2",
                            mode === 'library'
                                ? "border-blue-500 text-blue-400 bg-white/5"
                                : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        ライブラリに追加
                    </button>
                    <button
                        onClick={() => setMode('file')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2",
                            mode === 'file'
                                ? "border-green-500 text-green-400 bg-white/5"
                                : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        ファイルとして保存
                    </button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto overscroll-contain">
                    {mode === 'library' ? (
                        <div className="space-y-4">
                            <p className="text-sm text-white/60">
                                ローカルの練習曲ライブラリに追加します。後でいつでも呼び出せます。
                            </p>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-white/70">タイトル</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder="曲名を入力..."
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                    autoFocus
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-white/70">難易度</label>
                                    <select
                                        value={difficulty}
                                        onChange={e => setDifficulty(e.target.value as any)}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500/50"
                                    >
                                        <option value="easy">初級</option>
                                        <option value="medium">中級</option>
                                        <option value="hard">上級</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-white/70">メモ</label>
                                    <input
                                        type="text"
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="任意..."
                                        className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={handleAddToLibrary}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-2"
                            >
                                <Library className="w-5 h-5" />
                                ライブラリに追加
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6 text-center py-4">
                            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                                <FileJson className="w-8 h-8 text-green-400" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-lg font-medium text-white">プロジェクトファイル (.json)</h3>
                                <p className="text-sm text-white/50">
                                    現在の編集状態、設定、ノーツなどをすべて含むファイルをダウンロードします。
                                    他の端末で作業を継続する場合などに使えます。
                                </p>
                            </div>
                            <button
                                onClick={handleSaveToFile}
                                className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium shadow-lg shadow-green-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                            >
                                <Download className="w-5 h-5" />
                                ダウンロード
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-zinc-800/30 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/5"
                    >
                        キャンセル
                    </button>
                </div>
            </div>
        </div>
    );
}
