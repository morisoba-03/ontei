/**
 * サークル課題曲パック
 *
 * public/circle/pack.json に置く暗号化ファイルを、合言葉で復号して課題曲一覧を得る。
 * ファイル自体は公開の場所にあるが、中身（曲名・MIDI）は合言葉なしでは読めない。
 *   鍵: PBKDF2-SHA256（ランダムな salt, 反復回数はファイルに記録）→ AES-GCM 256bit
 * パックの作成は scripts/circle-pack.mjs（同じ形式）で行う。
 */

export interface CirclePackFile {
    v: 1;
    kdf: 'PBKDF2-SHA256';
    iter: number;
    salt: string; // base64
    iv: string;   // base64
    data: string; // base64（AES-GCM 暗号文）
}

export interface CircleSong {
    id: string;
    name: string;
    description?: string;
    bpm?: number;
    /** ガイドに使う MIDI トラック番号（省略時はノートのある最初のトラック） */
    track?: number;
    midi: string; // base64
}

export interface CirclePack {
    title: string;
    updatedAt: string;
    songs: CircleSong[];
}

const PASS_KEY = 'ontei-circle-pass';
const PACK_URL = './circle/pack.json';

export function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function deriveKey(pass: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFKC').trim()), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );
}

export async function decryptPack(file: CirclePackFile, pass: string): Promise<CirclePack> {
    const key = await deriveKey(pass, b64ToBytes(file.salt), file.iter);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(file.iv) as BufferSource },
        key,
        b64ToBytes(file.data) as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as CirclePack;
}

/** 課題曲パックを取得する。パックが無ければ null（＝課題曲欄を出さない） */
export async function fetchPackFile(): Promise<CirclePackFile | null> {
    try {
        const res = await fetch(PACK_URL, { cache: 'no-store' });
        if (!res.ok) return null;
        const json = await res.json();
        return json && json.v === 1 && json.data ? json as CirclePackFile : null;
    } catch {
        return null;
    }
}

export function loadSavedPass(): string | null {
    try { return localStorage.getItem(PASS_KEY); } catch { return null; }
}

export function savePass(pass: string) {
    try { localStorage.setItem(PASS_KEY, pass); } catch { /* ignore */ }
}

export function clearPass() {
    try { localStorage.removeItem(PASS_KEY); } catch { /* ignore */ }
}

export function songMidiBuffer(song: CircleSong): ArrayBuffer {
    const bytes = b64ToBytes(song.midi);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
