
const DB_NAME = 'ontei_db';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export const storage = {
    async init() {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
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

    async _put(key: string, value: any) {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async _get(key: string): Promise<any | undefined> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onsuccess = () => {
                const db = request.result;
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const getReq = store.get(key);
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => reject(getReq.error);
            };
            request.onerror = () => reject(request.error);
        });
    }
};
