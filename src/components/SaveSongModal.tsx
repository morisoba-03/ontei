import { useState, useEffect } from 'react';
import { X, Save, Download, Library, Database, Plus, RefreshCcw } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { storage } from '../lib/storage';
import { toast } from './Toast';
import { cn } from '../lib/utils';
import type { PresetSong } from '../lib/presetSongs';

interface SaveSongModalProps {
    open: boolean;
    onClose: () => void;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function SaveSongModal({ open, onClose }: SaveSongModalProps) {
    const [mode, setMode] = useState<'library' | 'export'>('library');
    const [saveType, setSaveType] = useState<'new' | 'overwrite'>('new');
    const [title, setTitle] = useState('');
    const [difficulty, setDifficulty] = useState<PresetSong['difficulty']>('medium');
    const [description, setDescription] = useState('');
    const [saving, setSaving] = useState(false);
    const [existingSongs, setExistingSongs] = useState<PresetSong[]>([]);
    const [selectedOverwriteId, setSelectedOverwriteId] = useState<string>('');

    useEffect(() => {
        if (!open) return;
        storage.loadUserPresets().then(songs => {
            setExistingSongs(songs);
            if (songs.length > 0 && !selectedOverwriteId) {
                setSelectedOverwriteId(songs[0].id);
            }
        });
    }, [open]);

    if (!open) return null;

    const getNotes = () => {
        let notes = [...audioEngine.state.midiGhostNotes];
        if (notes.length === 0 && audioEngine.state.currentTracks.length > 0) {
            const trackIndex = audioEngine.state.melodyTrackIndex >= 0 ? audioEngine.state.melodyTrackIndex : 0;
            const track = audioEngine.state.currentTracks[trackIndex];
            if (track?.notes.length > 0) {
                notes = track.notes.map(n => ({ midi: n.midi, time: n.time, duration: n.duration, role: 'call' as const }));
            }
        }
        return notes;
    };

    const getCurrentSettings = () => ({
        guideOctaveOffset: audioEngine.state.guideOctaveOffset,
        transposeOffset: audioEngine.state.transposeOffset,
        toleranceCents: audioEngine.state.toleranceCents,
    });

    const handleSaveToLibrary = async () => {
        const notes = getNotes();
        if (notes.length === 0) { toast.error('保存するノートデータがありません'); return; }
        if (saveType === 'new' && !title.trim()) { toast.error('タイトルを入力してください'); return; }
        if (saveType === 'overwrite' && !selectedOverwriteId) { toast.error('上書きする曲を選択してください'); return; }

        setSaving(true);
        try {
            const songId = saveType === 'new' ? 'user-' + Date.now() : selectedOverwriteId;
            let hasMidiData = false;
            try {
                const midiBuffer = await storage.loadMidi();
                if (midiBuffer && midiBuffer.byteLength > 100) {
                    await storage.saveSongMidi(songId, midiBuffer);
                    hasMidiData = true;
                }
            } catch (e) {
                console.warn('[SaveSong] Could not save MIDI binary:', e);
            }

            const settings = getCurrentSettings();
            const current = await storage.loadUserPresets();

            if (saveType === 'new') {
                const newSong: PresetSong = {
                    id: songId,
                    name: title.trim(),
                    description: description.trim() || 'User preset',
                    difficulty,
                    bpm: audioEngine.state.bpm || 120,
                    notes,
                    hasMidiData,
                    settings,
                    createdAt: Date.now(),
                    playCount: 0,
                };
                await storage.saveUserPresets([...current, newSong]);
                toast.success(`「${title}」をライブラリに追加しました${hasMidiData ? '（MIDI保存済）' : ''}`);
            } else {
                const target = current.find(s => s.id === selectedOverwriteId);
                const updated = current.map(s => s.id === selectedOverwriteId
                    ? { ...s, notes, hasMidiData, settings, bpm: audioEngine.state.bpm || s.bpm }
                    : s);
                await storage.saveUserPresets(updated);
                toast.success(`「${target?.name}」を上書き保存しました${hasMidiData ? '（MIDI更新済）' : ''}`);
            }
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const handleExport = async () => {
        setSaving(true);
        try {
            const notes = getNotes();
            const settings = getCurrentSettings();

            let midiData: string | null = null;
            try {
                const midiBuffer = await storage.loadMidi();
                if (midiBuffer && midiBuffer.byteLength > 100) {
                    midiData = arrayBufferToBase64(midiBuffer);
                }
            } catch (e) {
                console.warn('[Export] Could not encode MIDI:', e);
            }

            const exportData = {
                version: 2,
                type: 'ontei-song',
                exportedAt: new Date().toISOString(),
                song: {
                    name: title.trim() || '名称未設定',
                    bpm: audioEngine.state.bpm || 120,
                    notes,
                    settings,
                },
                midiData,
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (title.trim() || 'ontei').replace(/[^\w぀-鿿]/g, '_');
            a.download = `${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`書き出しました${midiData ? '（MIDIデータ含む）' : '（ノートのみ）'}`);
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('書き出しに失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const noteCount = audioEngine.state.midiGhostNotes.length;
    const s = getCurrentSettings();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Save className="w-5 h-5 text-green-400" />
                        保存・書き出し
                    </h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10 shrink-0">
                    <button
                        onClick={() => setMode('library')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-1.5",
                            mode === 'library' ? "border-blue-500 text-blue-400 bg-white/5" : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <Library className="w-4 h-4" />
                        ライブラリに保存
                    </button>
                    <button
                        onClick={() => setMode('export')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-1.5",
                            mode === 'export' ? "border-orange-500 text-orange-400 bg-white/5" : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <Download className="w-4 h-4" />
                        ファイルに書き出し
                    </button>
                </div>

                <div className="p-5 flex-1 overflow-y-auto overscroll-contain">
                    {mode === 'library' ? (
                        <div className="space-y-4">
                            <p className="text-xs text-white/50">このブラウザの練習曲ライブラリに保存します。</p>

                            {/* New / Overwrite toggle */}
                            <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                                <button
                                    onClick={() => setSaveType('new')}
                                    className={cn(
                                        "flex-1 py-2 rounded-md text-sm transition-all flex items-center justify-center gap-1.5",
                                        saveType === 'new' ? "bg-blue-600 text-white shadow-md" : "text-white/50 hover:text-white"
                                    )}
                                >
                                    <Plus className="w-4 h-4" />新規保存
                                </button>
                                <button
                                    onClick={() => setSaveType('overwrite')}
                                    disabled={existingSongs.length === 0}
                                    className={cn(
                                        "flex-1 py-2 rounded-md text-sm transition-all flex items-center justify-center gap-1.5",
                                        saveType === 'overwrite' ? "bg-amber-600 text-white shadow-md"
                                            : existingSongs.length === 0 ? "text-white/20 cursor-not-allowed"
                                                : "text-white/50 hover:text-white"
                                    )}
                                >
                                    <RefreshCcw className="w-4 h-4" />上書き保存
                                </button>
                            </div>

                            {saveType === 'new' ? (
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-white/70">タイトル</label>
                                        <input
                                            type="text"
                                            value={title}
                                            onChange={e => setTitle(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveToLibrary()}
                                            placeholder="曲名を入力..."
                                            className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-white/70">難易度</label>
                                            <select
                                                value={difficulty}
                                                onChange={e => setDifficulty(e.target.value as PresetSong['difficulty'])}
                                                className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500/50"
                                            >
                                                <option value="easy">初級</option>
                                                <option value="medium">中級</option>
                                                <option value="hard">上級</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
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
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-white/70">上書きする曲を選択</label>
                                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                                        {existingSongs.map(song => (
                                            <button
                                                key={song.id}
                                                onClick={() => setSelectedOverwriteId(song.id)}
                                                className={cn(
                                                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-all border",
                                                    selectedOverwriteId === song.id
                                                        ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                                                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                                                )}
                                            >
                                                <span className="font-medium">{song.name}</span>
                                                {song.hasMidiData && <span className="ml-2 text-xs text-blue-400/70">MIDI保存済</span>}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-xs text-amber-400/60">⚠️ ノートデータとMIDIが現在の内容で置き換えられます</p>
                                </div>
                            )}

                            {/* Preview */}
                            <div className="bg-white/5 rounded-lg p-3 space-y-1 text-xs text-white/50">
                                <p className="font-medium text-white/70">保存される内容：</p>
                                <p>• ノート {noteCount}個</p>
                                <p>• 設定（Oct {s.guideOctaveOffset > 0 ? '+' : ''}{s.guideOctaveOffset} / 移調 {s.transposeOffset > 0 ? '+' : ''}{s.transposeOffset}半音）</p>
                                <p className="text-blue-400/70">• MIDIバイナリ（読み込み済の場合）</p>
                            </div>

                            <button
                                onClick={handleSaveToLibrary}
                                disabled={saving}
                                className={cn(
                                    "w-full py-3 text-white rounded-xl font-medium shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2",
                                    saveType === 'new'
                                        ? "bg-blue-600 hover:bg-blue-500 shadow-blue-500/20 disabled:bg-blue-600/50"
                                        : "bg-amber-600 hover:bg-amber-500 shadow-amber-500/20 disabled:bg-amber-600/50"
                                )}
                            >
                                {saving ? <><Database className="w-5 h-5 animate-pulse" />保存中...</>
                                    : saveType === 'new' ? <><Plus className="w-5 h-5" />ライブラリに新規追加</>
                                        : <><RefreshCcw className="w-5 h-5" />選択した曲を上書き</>}
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-sm text-white/60">現在の曲データをファイルとして書き出します。</p>
                            <div className="text-xs text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5 space-y-1">
                                <p>✓ MIDIデータが読み込まれている場合はファイルに含まれます</p>
                                <p>✓ 移調・オクターブ・許容誤差の設定も含まれます</p>
                                <p>✓「読込」ボタンから完全に復元できます</p>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-white/70">ファイル名（任意）</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder="例: 喜びの歌"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2.5 text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 transition-all"
                                    autoFocus={mode === 'export'}
                                />
                            </div>

                            <div className="bg-white/5 rounded-lg p-3 space-y-1 text-xs text-white/50">
                                <p className="font-medium text-white/70">書き出し内容：</p>
                                <p>• ノート {noteCount}個</p>
                                <p>• テンポ / テンポマップ</p>
                                <p>• 設定（Oct {s.guideOctaveOffset > 0 ? '+' : ''}{s.guideOctaveOffset} / 移調 {s.transposeOffset > 0 ? '+' : ''}{s.transposeOffset}半音 / 許容 ±{s.toleranceCents}cent）</p>
                                <p className="text-blue-400/70">• MIDIバイナリ Base64（読み込み済の場合）</p>
                            </div>

                            <button
                                onClick={handleExport}
                                disabled={saving}
                                className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-orange-600/50 text-white rounded-xl font-medium shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                            >
                                {saving ? <><Database className="w-5 h-5 animate-pulse" />準備中...</>
                                    : <><Download className="w-5 h-5" />ファイルに書き出す</>}
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
