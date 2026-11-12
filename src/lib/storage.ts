import type { PresetSong } from './presetSongs';

/** IndexedDB に保存する曲（同期用に updatedAt を持つ） */
export type StoredSong = PresetSong & { updatedAt?: number; createdAt?: number };


const DB_NAME = 'ontei_db';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let _db: IDBDatabase | null = null;

function getDb(): Promise<IDBDatabase> {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => {
            _db = request.result;
            _db.onclose = () => { _db = null; };
            _db.onerror = () => { _db = null; };
            resolve(_db);
        };
        request.onerror = () => reject(request.error);
    });
}

// 曲や練習記録が変わったことを同期処理へ知らせる（driveSync が購読）
type ChangeListener = () => void;
const changeListeners: ChangeListener[] = [];
export function onStorageChange(fn: ChangeListener) { changeListeners.push(fn); }
function notifyChange() { for (const fn of changeListeners) { try { fn(); } catch { /* ignore */ } } }

export const storage = {
    async hasStoredMidi(): Promise<boolean> {
        try {
            const data = await this._get('lastMidi');
            return data instanceof ArrayBuffer && data.byteLength > 100;
        } catch {
            return false;
        }
    },

    async saveMidi(data: ArrayBuffer) {
        return this._put('lastMidi', data);
    },

    async loadMidi(): Promise<ArrayBuffer | null> {
        const result = await this._get<ArrayBuffer>('lastMidi');
        return result ?? null;
    },

    async saveBacking(data: ArrayBuffer) {
        return this._put('lastBacking', data);
    },

    async loadBacking(): Promise<ArrayBuffer | null> {
        const result = await this._get<ArrayBuffer>('lastBacking');
        return result ?? null;
    },

    /**
     * 曲リストを保存する。同期のため、変わった曲には updatedAt を付け、消えた曲は削除記録（tombstone）に残す。
     * fromSync=true は同期処理からの書き込み（印を付け直さない・同期を再予約しない）。
     */
    async saveUserPresets(presets: StoredSong[], opts: { fromSync?: boolean } = {}) {
        if (!opts.fromSync) {
            const now = Date.now();
            const old: StoredSong[] = (await this._get<StoredSong[]>('user_presets')) || [];
            const oldMap = new Map(old.map(s => [s.id, s]));
            const strip = (s: StoredSong) => { const { updatedAt: _u, ...rest } = s || {}; void _u; return JSON.stringify(rest); };
            presets = presets.map(s => {
                const prev = oldMap.get(s.id);
                if (!prev || strip(prev) !== strip(s)) return { ...s, updatedAt: now };
                return { ...s, updatedAt: s.updatedAt ?? prev.updatedAt ?? s.createdAt ?? 0 };
            });
            const keep = new Set(presets.map(s => s.id));
            const removed = old.filter(s => !keep.has(s.id));
            if (removed.length) {
                const tomb: Record<string, number> = (await this._get<Record<string, number>>('sync_tombstones')) || {};
                for (const s of removed) tomb[s.id] = now;
                await this._put('sync_tombstones', tomb);
            }
        }
        await this._put('user_presets', presets);
        if (!opts.fromSync) notifyChange();
    },

    async loadTombstones(): Promise<Record<string, number>> {
        return (await this._get<Record<string, number>>('sync_tombstones')) || {};
    },

    async saveTombstones(t: Record<string, number>) {
        return this._put('sync_tombstones', t);
    },

    /** 保存されているベスト記録のシグネチャ一覧 */
    async listBestRunSigs(): Promise<string[]> {
        const keys = await this._keys();
        return keys.filter(k => k.startsWith('best_')).map(k => k.slice(5));
    },

    async loadUserPresets(): Promise<StoredSong[]> {
        return (await this._get<StoredSong[]>('user_presets')) || [];
    },

    // A案: Per-song MIDI binary storage
    async saveSongMidi(id: string, data: ArrayBuffer) {
        return this._put(`song_midi_${id}`, data);
    },

    async loadSongMidi(id: string): Promise<ArrayBuffer | null> {
        const result = await this._get<ArrayBuffer>(`song_midi_${id}`);
        return result instanceof ArrayBuffer ? result : null;
    },

    async deleteSongMidi(id: string) {
        return this._delete(`song_midi_${id}`);
    },

    // 曲ごとのベスト記録（スコア + ピッチ軌跡ゴースト）。キーは曲のシグネチャ。
    async saveBestRun(sig: string, data: { score: number; ghost: unknown[] }, opts: { fromSync?: boolean } = {}) {
        await this._put(`best_${sig}`, data);
        if (!opts.fromSync) notifyChange();
    },

    async loadBestRun(sig: string): Promise<{ score: number; ghost: unknown[] } | null> {
        const result = await this._get<{ score: number; ghost: unknown[] }>(`best_${sig}`);
        return result && typeof result.score === 'number' ? result : null;
    },

    async _keys(): Promise<string[]> {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAllKeys();
            req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
            req.onerror = () => reject(req.error);
        });
    },

    async _put(key: string, value: unknown) {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _get<T = unknown>(key: string): Promise<T | undefined> {
        const db = await getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(key);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => reject(getReq.error);
        });
    },

    async _delete(key: string) {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};
