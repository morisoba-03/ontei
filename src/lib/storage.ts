
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
        const result = await this._get('lastMidi');
        return result ?? null;
    },

    async saveBacking(data: ArrayBuffer) {
        return this._put('lastBacking', data);
    },

    async loadBacking(): Promise<ArrayBuffer | null> {
        const result = await this._get('lastBacking');
        return result ?? null;
    },

    async saveUserPresets(presets: any[]) {
        return this._put('user_presets', presets);
    },

    async loadUserPresets(): Promise<any[]> {
        return (await this._get('user_presets')) || [];
    },

    // A案: Per-song MIDI binary storage
    async saveSongMidi(id: string, data: ArrayBuffer) {
        return this._put(`song_midi_${id}`, data);
    },

    async loadSongMidi(id: string): Promise<ArrayBuffer | null> {
        const result = await this._get(`song_midi_${id}`);
        return result instanceof ArrayBuffer ? result : null;
    },

    async deleteSongMidi(id: string) {
        return this._delete(`song_midi_${id}`);
    },

    async _put(key: string, value: any) {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _get(key: string): Promise<any | undefined> {
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
