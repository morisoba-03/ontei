/**
 * Google ドライブ同期（自分専用）
 *
 * 自分の Google ドライブの「アプリ専用の隠しフォルダ（appDataFolder）」に 1 ファイルだけ保存し、
 * PC とスマホの曲リスト・MIDI・ベスト記録をそろえる。ほかのドライブのファイルには一切触れない。
 * スコープ drive.appdata は Google の分類で「非機密（non-sensitive）」。
 *
 * ログインは Google Identity Services のトークン方式（ページ内だけで完結、サーバー不要）。
 * トークンの有効期限は約 1 時間。切れたら「同期」ボタンを 1 回タップして取り直す。
 */
import { storage, onStorageChange, type StoredSong } from './storage';
import { mergeSnapshots, sameSnapshot, emptySnapshot, type SyncSnapshot, type SyncSong } from './syncMerge';

/** Google Cloud で作った OAuth クライアント ID（設定画面で上書き可） */
export const DEFAULT_CLIENT_ID = '868392013433-42ebi3f0iha0erk976rhks9a2ikqqgnv.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'ontei-sync-v1.json';
const LS = {
    clientId: 'ontei-sync-client-id',
    enabled: 'ontei-sync-enabled',
    token: 'ontei-sync-token',
    last: 'ontei-sync-last',
    consented: 'ontei-sync-consented',
};

export type SyncPhase = 'off' | 'needs-login' | 'syncing' | 'ok' | 'error';
export interface SyncStatus { phase: SyncPhase; lastSync: number | null; message?: string }

const ls = {
    get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
    del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let status: SyncStatus = { phase: 'off', lastSync: Number(ls.get(LS.last)) || null };
const listeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: Partial<SyncStatus>) {
    status = { ...status, ...s };
    listeners.forEach(fn => fn(status));
}
export function getSyncStatus() { return status; }
export function subscribeSync(fn: (s: SyncStatus) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function getClientId(): string { return ls.get(LS.clientId) || DEFAULT_CLIENT_ID; }
export function setClientId(id: string) { if (id.trim()) ls.set(LS.clientId, id.trim()); else ls.del(LS.clientId); }
export function isSyncEnabled() { return ls.get(LS.enabled) === '1' && !!getClientId(); }

// ── トークン ──────────────────────────────────────────
function validToken(): string | null {
    try {
        const t = JSON.parse(ls.get(LS.token) || 'null');
        if (t && t.token && t.exp > Date.now() + 60_000) return t.token;
    } catch { /* ignore */ }
    return null;
}

interface GisTokenResponse { access_token?: string; expires_in?: number; error?: string }
interface GisTokenClient { requestAccessToken(o?: { prompt?: string }): void }
interface GisWindow { google?: { accounts: { oauth2: {
    initTokenClient(c: { client_id: string; scope: string; callback: (r: GisTokenResponse) => void; error_callback?: (e: { type: string }) => void }): GisTokenClient;
    revoke(token: string, cb?: () => void): void;
} } } }

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
    if ((window as GisWindow).google?.accounts?.oauth2) return Promise.resolve();
    if (!gisPromise) {
        gisPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = () => { gisPromise = null; reject(new Error('Googleのログイン部品を読み込めませんでした')); };
            document.head.appendChild(s);
        });
    }
    return gisPromise;
}

/** ボタンのタップから呼ぶこと（ポップアップのため） */
async function login(): Promise<string> {
    const clientId = getClientId();
    if (!clientId) throw new Error('クライアントIDが未設定です');
    await loadGis();
    const g = (window as GisWindow).google!.accounts.oauth2;
    return new Promise((resolve, reject) => {
        const client = g.initTokenClient({
            client_id: clientId,
            scope: SCOPE,
            callback: (r) => {
                if (r.error || !r.access_token) { reject(new Error(r.error || 'ログインできませんでした')); return; }
                ls.set(LS.token, JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }));
                ls.set(LS.consented, '1');
                resolve(r.access_token);
            },
            error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'ログインが中断されました' : 'ログインできませんでした')),
        });
        client.requestAccessToken({ prompt: ls.get(LS.consented) ? '' : 'consent' });
    });
}

// ── Drive REST ───────────────────────────────────────
async function api(token: string, url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) { ls.del(LS.token); throw new Error('ログインの有効期限が切れました'); }
    if (!res.ok) throw new Error(`Googleドライブの通信に失敗しました（${res.status}）`);
    return res;
}

async function findFile(token: string): Promise<string | null> {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await api(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    const j = await res.json();
    return j.files?.[0]?.id ?? null;
}

async function download(token: string, id: string): Promise<SyncSnapshot> {
    const res = await api(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    const j = await res.json();
    return j && j.v === 1 ? { ...emptySnapshot(), ...j } : emptySnapshot();
}

async function upload(token: string, id: string | null, snap: SyncSnapshot) {
    const body = JSON.stringify(snap);
    if (id) {
        await api(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
        });
        return;
    }
    const boundary = 'ontei' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
    });
}

// ── ローカル ⇔ スナップショット ────────────────────────
function bufToB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
function b64ToBuf(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

async function localSnapshot(): Promise<SyncSnapshot> {
    const songs = (await storage.loadUserPresets()) as unknown as SyncSong[];
    const midi: Record<string, string> = {};
    for (const s of songs) {
        if (!s.hasMidiData) continue;
        const buf = await storage.loadSongMidi(s.id);
        if (buf) midi[s.id] = bufToB64(buf);
    }
    const best: SyncSnapshot['best'] = {};
    for (const sig of await storage.listBestRunSigs()) {
        const r = await storage.loadBestRun(sig);
        if (r) best[sig] = r;
    }
    const oct = await storage.loadSongOctaves();
    return { v: 1, savedAt: Date.now(), songs, tombstones: await storage.loadTombstones(), midi, best, oct };
}

async function applyLocal(before: SyncSnapshot, merged: SyncSnapshot) {
    for (const [id, m] of Object.entries(merged.midi)) {
        if (before.midi[id] !== m) await storage.saveSongMidi(id, b64ToBuf(m));
    }
    const alive = new Set(merged.songs.map(s => s.id));
    for (const s of before.songs) if (!alive.has(s.id)) await storage.deleteSongMidi(s.id).catch(() => {});
    for (const [sig, r] of Object.entries(merged.best)) {
        if (!before.best[sig] || before.best[sig].score !== r.score) await storage.saveBestRun(sig, r, { fromSync: true });
    }
    if (merged.oct) await storage.saveSongOctaves(merged.oct, { fromSync: true });
    await storage.saveTombstones(merged.tombstones);
    await storage.saveUserPresets(merged.songs as unknown as StoredSong[], { fromSync: true });
    window.dispatchEvent(new Event('ontei-library-updated'));
}

// ── 同期本体 ─────────────────────────────────────────
let running: Promise<void> | null = null;

/** interactive=true はボタンのタップから（必要ならログイン画面を出す） */
export function syncNow(interactive = false): Promise<void> {
    if (running) return running;
    running = (async () => {
        if (!getClientId()) { setStatus({ phase: 'off' }); return; }
        let token = validToken();
        if (!token) {
            if (!interactive) { setStatus({ phase: 'needs-login' }); return; }
            token = await login();
            ls.set(LS.enabled, '1');
        }
        setStatus({ phase: 'syncing', message: undefined });
        const id = await findFile(token);
        const remote = id ? await download(token, id) : emptySnapshot();
        const local = await localSnapshot();
        const merged = mergeSnapshots(local, remote);
        if (!sameSnapshot(merged, local)) await applyLocal(local, merged);
        if (!id || !sameSnapshot(merged, remote)) await upload(token, id, merged);
        const now = Date.now();
        ls.set(LS.last, String(now));
        setStatus({ phase: 'ok', lastSync: now });
    })().catch((e: Error) => {
        setStatus({ phase: validToken() ? 'error' : 'needs-login', message: e.message });
        if (interactive) throw e;
    }).finally(() => { running = null; });
    return running;
}

export function disconnectSync() {
    const t = validToken();
    ls.del(LS.enabled); ls.del(LS.token); ls.del(LS.consented);
    if (t) loadGis().then(() => (window as GisWindow).google?.accounts.oauth2.revoke(t)).catch(() => {});
    setStatus({ phase: 'off' });
}

// ── 自動同期 ─────────────────────────────────────────
let timer: number | undefined;
function scheduleSync() {
    if (!isSyncEnabled()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { syncNow(false); }, 3000);
}

let hooked = false;
function hookAuto() {
    if (hooked) return;
    hooked = true;
    onStorageChange(scheduleSync);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isSyncEnabled()) syncNow(false);
    });
}

/** アプリ起動時に 1 回呼ぶ */
export function initSync() {
    if (!isSyncEnabled()) { setStatus({ phase: 'off' }); return; }
    hookAuto();
    syncNow(false);
}

/** 設定画面で接続したとき（タップから） */
export async function connectSync() {
    ls.set(LS.enabled, '1');
    hookAuto();
    await syncNow(true);
}

/** ログイン部品を先に読み込んでおく（タップ直後にポップアップを出すため） */
export function preloadSync() {
    if (getClientId()) loadGis().catch(() => {});
}
