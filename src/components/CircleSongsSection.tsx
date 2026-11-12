import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Music, Users, LogOut } from 'lucide-react';
import { audioEngine } from '../lib/AudioEngine';
import { toast } from './Toast';
import {
    fetchPackFile, decryptPack, loadSavedPass, savePass, clearPass, songMidiBuffer,
    type CirclePack, type CirclePackFile, type CircleSong,
} from '../lib/circlePack';

/**
 * 曲リスト内の「サークル課題曲」欄。
 * 課題曲パック（public/circle/pack.json）があるときだけ表示し、合言葉で復号した曲を一覧にする。
 * 合言葉はこの端末に記憶する（次回から入力不要）。個人の曲リストとは完全に別。
 */
export function CircleSongsSection({ onLoaded }: { onLoaded: () => void }) {
    const [file, setFile] = useState<CirclePackFile | null | undefined>(undefined);
    const [pack, setPack] = useState<CirclePack | null>(null);
    const [pass, setPass] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [loadingId, setLoadingId] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            const f = await fetchPackFile();
            if (!alive) return;
            setFile(f);
            const saved = loadSavedPass();
            if (f && saved) {
                try {
                    const p = await decryptPack(f, saved);
                    if (alive) setPack(p);
                } catch {
                    clearPass(); // 合言葉が変わった
                }
            }
        })();
        return () => { alive = false; };
    }, []);

    if (!file) return null; // パックが無い（または読み込み中）

    const unlock = async () => {
        if (!pass.trim() || busy) return;
        setBusy(true);
        setError('');
        try {
            const p = await decryptPack(file, pass);
            savePass(pass);
            setPack(p);
            setPass('');
        } catch {
            setError('合言葉が違います');
        } finally {
            setBusy(false);
        }
    };

    const select = async (song: CircleSong) => {
        if (loadingId) return;
        setLoadingId(song.id);
        try {
            audioEngine.stopPractice();
            audioEngine.stopPlayback();
            const candidates = audioEngine.loadMidiFromBuffer(songMidiBuffer(song));
            if (!candidates || candidates.length === 0) throw new Error('no tracks');
            const track = (song.track !== undefined && candidates.find(t => t.id === song.track && t.noteCount > 0))
                || candidates.find(t => t.noteCount > 0);
            if (!track) throw new Error('no notes');
            audioEngine.importMidiTrack(track.id, 0);
            if (song.bpm) audioEngine.updateState({ bpm: song.bpm });
            audioEngine.updateState({ markers: [], loopEnabled: false, transposeOffset: 0 });
            audioEngine.startPractice({ mode: 'Midi' });
            toast.success(`課題曲「${song.name}」を読み込みました`);
            onLoaded();
        } catch (e) {
            console.error(e);
            toast.error('読み込みに失敗しました');
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                <Users className="w-4 h-4" />
                {pack ? pack.title : 'サークル課題曲'}
                {pack && (
                    <button
                        onClick={() => { clearPass(); setPack(null); }}
                        className="ml-auto p-1 rounded text-white/30 hover:text-white/70"
                        title="この端末の合言葉を消す"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {!pack ? (
                <div className="space-y-2">
                    <p className="text-xs text-white/50">サークルのメンバーは、合言葉を入れると課題曲が表示されます（この端末に記憶されます）。</p>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
                        <input
                            type="password"
                            value={pass}
                            onChange={(e) => setPass(e.target.value)}
                            placeholder="合言葉"
                            autoComplete="off"
                            className="flex-1 min-w-0 bg-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-emerald-400/50"
                        />
                        <button
                            type="submit"
                            disabled={busy || !pass.trim()}
                            className="px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm disabled:opacity-40 flex items-center gap-1"
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                            開く
                        </button>
                    </form>
                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
            ) : pack.songs.length === 0 ? (
                <p className="text-xs text-white/40">課題曲はまだありません</p>
            ) : (
                <div className="space-y-1.5">
                    {pack.songs.map(song => (
                        <button
                            key={song.id}
                            onClick={() => select(song)}
                            disabled={!!loadingId}
                            className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-left disabled:opacity-50"
                        >
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                {loadingId === song.id
                                    ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                                    : <Music className="w-4 h-4 text-emerald-400" />}
                            </div>
                            <div className="min-w-0">
                                <div className="text-sm text-white truncate">{song.name}</div>
                                {song.description && <div className="text-xs text-white/40 truncate">{song.description}</div>}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
