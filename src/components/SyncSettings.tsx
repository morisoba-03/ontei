import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import {
    getSyncStatus, subscribeSync, syncNow, connectSync, disconnectSync, preloadSync,
    getClientId, setClientId, isSyncEnabled, type SyncStatus,
} from '../lib/driveSync';
import { toast } from '../lib/toast';

function formatSyncTime(ts: number | null): string {
    if (!ts) return '未同期';
    const d = new Date(ts);
    const today = new Date();
    const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return d.toDateString() === today.toDateString() ? `今日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function useSyncStatus(): SyncStatus {
    const [s, setS] = useState(getSyncStatus());
    useEffect(() => subscribeSync(setS), []);
    return s;
}

/** 曲リストの見出しに置く小さな同期ボタン（同期を使っているときだけ表示） */
export function SyncButton() {
    const s = useSyncStatus();
    const enabled = isSyncEnabled();
    useEffect(() => { if (enabled) preloadSync(); }, [enabled]);
    if (!enabled) return null;
    const busy = s.phase === 'syncing';
    return (
        <button
            onClick={() => syncNow(true).catch((e: Error) => toast.error(e.message))}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300 text-xs disabled:opacity-60"
            title="Googleドライブと同期"
        >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {s.phase === 'needs-login' ? '同期する' : busy ? '同期中' : formatSyncTime(s.lastSync)}
        </button>
    );
}

/** 設定画面の「PCとスマホの同期」欄 */
export function SyncSettings() {
    const s = useSyncStatus();
    const [clientId, setCid] = useState(getClientId());
    const [showId, setShowId] = useState(!getClientId());
    const enabled = isSyncEnabled();
    useEffect(() => { preloadSync(); }, [clientId]);

    const connect = async () => {
        try {
            await connectSync();
            toast.success('Googleドライブと同期しました');
        } catch (e) {
            toast.error((e as Error).message);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-[11px] text-white/40 leading-relaxed">
                自分のGoogleドライブの「アプリ専用の隠しフォルダ」に、曲リスト・MIDI・ベスト記録を保存して、PCとスマホでそろえます。ドライブのほかのファイルには触れません。
            </p>

            <div className="flex items-center gap-2 text-sm">
                {enabled ? <Cloud className="w-4 h-4 text-sky-400" /> : <CloudOff className="w-4 h-4 text-white/30" />}
                <span className="text-white/70">
                    {!enabled ? '未接続'
                        : s.phase === 'syncing' ? '同期中…'
                        : s.phase === 'needs-login' ? 'ログインの有効期限切れ（下のボタンで同期）'
                        : s.phase === 'error' ? `エラー: ${s.message ?? ''}`
                        : `最終同期: ${formatSyncTime(s.lastSync)}`}
                </span>
            </div>

            {enabled ? (
                <div className="flex gap-2">
                    <button
                        onClick={() => syncNow(true).catch((e: Error) => toast.error(e.message))}
                        disabled={s.phase === 'syncing'}
                        className="flex-1 py-2 rounded-md bg-sky-500/20 text-sky-300 text-xs font-bold disabled:opacity-50"
                    >今すぐ同期</button>
                    <button
                        onClick={() => { if (confirm('この端末の同期を解除しますか？（曲は消えません）')) disconnectSync(); }}
                        className="px-3 py-2 rounded-md bg-white/5 text-white/50 text-xs"
                    >解除</button>
                </div>
            ) : (
                <button
                    onClick={connect}
                    disabled={!clientId}
                    className="w-full py-2 rounded-md bg-sky-500/20 text-sky-300 text-xs font-bold disabled:opacity-40"
                >Googleでログインして同期を始める</button>
            )}

            <div className="pt-1">
                <button onClick={() => setShowId(v => !v)} className="text-[10px] text-white/30 hover:text-white/60">
                    {showId ? '▾' : '▸'} OAuthクライアントID（管理者向け）
                </button>
                {showId && (
                    <input
                        value={clientId}
                        onChange={(e) => setCid(e.target.value)}
                        onBlur={() => setClientId(clientId)}
                        placeholder="xxxxxxxx.apps.googleusercontent.com"
                        className="mt-1 w-full bg-white/10 rounded-md px-2 py-1.5 text-[11px] font-mono text-white placeholder:text-white/20"
                    />
                )}
            </div>
        </div>
    );
}
