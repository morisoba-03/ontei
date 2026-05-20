import { useState, useEffect, useRef } from 'react';
import { X, Upload, Download, FileMusic, FileAudio, FileJson, Library, Music2, Volume2, Loader2, ArrowLeftRight } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { storage } from '../lib/storage';
import { toast } from './Toast';
import { cn } from '../lib/utils';
import type { PresetSong } from '../lib/presetSongs';

interface ImportExportModalProps {
    open: boolean;
    onClose: () => void;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function ImportExportModal({ open, onClose }: ImportExportModalProps) {
    const [mode, setMode] = useState<'import' | 'export'>('import');
    const [audioTarget, setAudioTarget] = useState<'guide' | 'backing'>('guide');
    const [exportTitle, setExportTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [userSongs, setUserSongs] = useState<PresetSong[]>([]);

    const midiInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const jsonInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open && mode === 'export') {
            storage.loadUserPresets().then(setUserSongs);
        }
    }, [open, mode]);

    if (!open) return null;

    // --- Import handlers ---

    const handleMidiFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        audioEngine.loadMidiFile(file);
        toast.success(`MIDIファイルを読み込みました: ${file.name}`);
        e.target.value = '';
        onClose();
    };

    const handleAudioFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (audioTarget === 'guide') {
            audioEngine.loadAudioFile(file);
            toast.success(`ガイド音声を読み込みました: ${file.name}`);
        } else {
            audioEngine.importBackingFile(file);
            toast.success(`伴奏を読み込みました: ${file.name}`);
        }
        e.target.value = '';
        onClose();
    };

    const handleJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const text = await file.text();
            const json = JSON.parse(text);

            if (json.type === 'ontei-library' || Array.isArray(json)) {
                // Library import
                const songs: PresetSong[] = Array.isArray(json) ? json : json.songs;
                const midiDataMap: Record<string, string> = json.midiDataMap || {};

                const current = await storage.loadUserPresets();
                const currentMap = new Map(current.map(s => [s.id, s]));
                let added = 0, updated = 0;

                for (const item of songs) {
                    if (!item.name || !item.notes) continue;
                    currentMap.has(item.id) ? updated++ : added++;
                    let entry = { ...item };
                    if (midiDataMap[item.id]) {
                        try {
                            const binary = atob(midiDataMap[item.id]);
                            const buf = new ArrayBuffer(binary.length);
                            const view = new Uint8Array(buf);
                            for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
                            await storage.saveSongMidi(item.id, buf);
                            entry.hasMidiData = true;
                        } catch { /* skip MIDI for this song */ }
                    }
                    currentMap.set(item.id, entry);
                }

                await storage.saveUserPresets(Array.from(currentMap.values()));
                const midiCount = Object.keys(midiDataMap).length;
                toast.success(`${added}曲を追加、${updated}曲を更新${midiCount > 0 ? `（MIDI ${midiCount}件復元）` : ''}`);
            } else {
                // Single song export or legacy session JSON
                const ok = await audioEngine.importSession(file);
                if (ok) toast.success('データを読み込みました');
                else toast.error('読み込みに失敗しました');
            }
        } catch (err) {
            console.error(err);
            toast.error('ファイルの読み込みに失敗しました');
        } finally {
            setBusy(false);
            e.target.value = '';
            onClose();
        }
    };

    // --- Export handlers ---

    const handleExportSong = async () => {
        setBusy(true);
        try {
            let notes = [...audioEngine.state.midiGhostNotes];
            if (notes.length === 0 && audioEngine.state.currentTracks.length > 0) {
                const idx = audioEngine.state.melodyTrackIndex >= 0 ? audioEngine.state.melodyTrackIndex : 0;
                const track = audioEngine.state.currentTracks[idx];
                if (track?.notes.length > 0) {
                    notes = track.notes.map(n => ({ midi: n.midi, time: n.time, duration: n.duration, role: 'call' as const }));
                }
            }

            let midiData: string | null = null;
            const midiBuffer = await storage.loadMidi().catch(() => null);
            if (midiBuffer && midiBuffer.byteLength > 100) midiData = arrayBufferToBase64(midiBuffer);

            const exportData = {
                version: 2,
                type: 'ontei-song',
                exportedAt: new Date().toISOString(),
                song: {
                    name: exportTitle.trim() || '名称未設定',
                    bpm: audioEngine.state.bpm || 120,
                    notes,
                    settings: {
                        guideOctaveOffset: audioEngine.state.guideOctaveOffset,
                        transposeOffset: audioEngine.state.transposeOffset,
                        toleranceCents: audioEngine.state.toleranceCents,
                    },
                },
                midiData,
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (exportTitle.trim() || 'ontei').replace(/[<>:"/\\|?*]/g, '_');
            a.download = `${safeName}-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`書き出しました${midiData ? '（MIDIデータ含む）' : '（ノートのみ）'}`);
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('書き出しに失敗しました');
        } finally {
            setBusy(false);
        }
    };

    const handleExportLibrary = async () => {
        if (userSongs.length === 0) { toast.error('エクスポートする曲がありません'); return; }
        setBusy(true);
        try {
            const midiDataMap: Record<string, string> = {};
            for (const song of userSongs) {
                if (song.hasMidiData) {
                    const buf = await storage.loadSongMidi(song.id).catch(() => null);
                    if (buf && buf.byteLength > 100) midiDataMap[song.id] = arrayBufferToBase64(buf);
                }
            }

            const exportData = {
                version: 2,
                type: 'ontei-library',
                exportedAt: new Date().toISOString(),
                songs: userSongs,
                midiDataMap,
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ontei-library-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            const midiCount = Object.keys(midiDataMap).length;
            toast.success(`ライブラリ(${userSongs.length}曲、MIDI ${midiCount}件)をエクスポートしました`);
            onClose();
        } catch (e) {
            console.error(e);
            toast.error('エクスポートに失敗しました');
        } finally {
            setBusy(false);
        }
    };

    const noteCount = audioEngine.state.midiGhostNotes.length;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[90vh] shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <ArrowLeftRight className="w-5 h-5 text-blue-400" />
                        インポート・エクスポート
                    </h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/10 shrink-0">
                    <button
                        onClick={() => setMode('import')}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-1.5",
                            mode === 'import' ? "border-blue-500 text-blue-400 bg-white/5" : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <Upload className="w-4 h-4" />インポート
                    </button>
                    <button
                        onClick={() => { setMode('export'); storage.loadUserPresets().then(setUserSongs); }}
                        className={cn(
                            "flex-1 py-3 text-sm font-medium transition-colors border-b-2 flex items-center justify-center gap-1.5",
                            mode === 'export' ? "border-orange-500 text-orange-400 bg-white/5" : "border-transparent text-white/50 hover:text-white hover:bg-white/5"
                        )}
                    >
                        <Download className="w-4 h-4" />エクスポート
                    </button>
                </div>

                <div className="p-4 flex-1 overflow-y-auto overscroll-contain space-y-3">
                    {mode === 'import' ? (
                        <>
                            {/* MIDI */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                                        <FileMusic className="w-5 h-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">MIDIファイル</p>
                                        <p className="text-xs text-white/40">.mid / .midi → ガイドメロディとして読み込み</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => midiInputRef.current?.click()}
                                    disabled={busy}
                                    className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <Upload className="w-4 h-4" />ファイルを選択
                                </button>
                                <input ref={midiInputRef} type="file" accept=".mid,.midi" className="hidden" onChange={handleMidiFile} />
                            </div>

                            {/* Audio */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                                        <FileAudio className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">音声ファイル</p>
                                        <p className="text-xs text-white/40">.mp3 / .wav / .ogg / .m4a</p>
                                    </div>
                                </div>
                                {/* Guide / Backing toggle */}
                                <div className="flex bg-black/20 rounded-lg p-1 gap-1">
                                    <button
                                        onClick={() => setAudioTarget('guide')}
                                        className={cn(
                                            "flex-1 py-1.5 rounded-md text-xs transition-all flex items-center justify-center gap-1",
                                            audioTarget === 'guide' ? "bg-purple-600 text-white shadow-md" : "text-white/50 hover:text-white"
                                        )}
                                    >
                                        <Music2 className="w-3.5 h-3.5" />ガイドメロディ
                                    </button>
                                    <button
                                        onClick={() => setAudioTarget('backing')}
                                        className={cn(
                                            "flex-1 py-1.5 rounded-md text-xs transition-all flex items-center justify-center gap-1",
                                            audioTarget === 'backing' ? "bg-indigo-600 text-white shadow-md" : "text-white/50 hover:text-white"
                                        )}
                                    >
                                        <Volume2 className="w-3.5 h-3.5" />伴奏
                                    </button>
                                </div>
                                <button
                                    onClick={() => audioInputRef.current?.click()}
                                    disabled={busy}
                                    className={cn(
                                        "w-full py-2 rounded-lg text-sm transition-all flex items-center justify-center gap-2 border disabled:opacity-50",
                                        audioTarget === 'guide'
                                            ? "bg-purple-600/20 hover:bg-purple-600/30 border-purple-500/30 text-purple-300"
                                            : "bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/30 text-indigo-300"
                                    )}
                                >
                                    <Upload className="w-4 h-4" />
                                    {audioTarget === 'guide' ? 'ガイドとして' : '伴奏として'}ファイルを選択
                                </button>
                                <input ref={audioInputRef} type="file" accept=".mp3,.wav,.ogg,.m4a" className="hidden" onChange={handleAudioFile} />
                            </div>

                            {/* JSON */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                                        <FileJson className="w-5 h-5 text-green-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">JSONファイル</p>
                                        <p className="text-xs text-white/40">曲データ・ライブラリを自動判定して読み込み</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => jsonInputRef.current?.click()}
                                    disabled={busy}
                                    className="w-full py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 text-green-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                    ファイルを選択
                                </button>
                                <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleJsonFile} />
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Export current song */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                                        <FileJson className="w-5 h-5 text-orange-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">現在の曲をエクスポート</p>
                                        <p className="text-xs text-white/40">ノート・設定・MIDIを1ファイルに書き出し</p>
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    value={exportTitle}
                                    onChange={e => setExportTitle(e.target.value)}
                                    placeholder="ファイル名（任意）"
                                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-orange-500/50"
                                />
                                <div className="text-xs text-white/40 space-y-0.5 px-0.5">
                                    <p>• ノート {noteCount}個 / BPM {audioEngine.state.bpm}</p>
                                    <p>• 設定（移調 {audioEngine.state.transposeOffset > 0 ? '+' : ''}{audioEngine.state.transposeOffset}半音 / Oct {audioEngine.state.guideOctaveOffset > 0 ? '+' : ''}{audioEngine.state.guideOctaveOffset}）</p>
                                    <p>• MIDIバイナリ（読み込み済の場合）</p>
                                </div>
                                <button
                                    onClick={handleExportSong}
                                    disabled={busy}
                                    className="w-full py-2.5 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/30 text-orange-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    曲をエクスポート
                                </button>
                            </div>

                            {/* Export library */}
                            <div className="bg-white/5 rounded-xl border border-white/10 p-4 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-pink-500/10 flex items-center justify-center shrink-0">
                                        <Library className="w-5 h-5 text-pink-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-white">曲リストをまるごとエクスポート</p>
                                        <p className="text-xs text-white/40">全曲のMIDIデータを含むバックアップファイル</p>
                                    </div>
                                </div>
                                {userSongs.length > 0 ? (
                                    <p className="text-xs text-white/50 px-0.5">
                                        {userSongs.length}曲 / MIDI保存済: {userSongs.filter(s => s.hasMidiData).length}件
                                    </p>
                                ) : (
                                    <p className="text-xs text-white/30 px-0.5">曲リストに曲がありません</p>
                                )}
                                <button
                                    onClick={handleExportLibrary}
                                    disabled={busy || userSongs.length === 0}
                                    className="w-full py-2.5 bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/30 text-pink-300 rounded-lg text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    曲リストをエクスポート
                                </button>
                            </div>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-white/10 bg-zinc-800/30 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/5"
                    >
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}
