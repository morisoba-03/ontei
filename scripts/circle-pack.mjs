#!/usr/bin/env node
/**
 * サークル課題曲パックを作る（合言葉で暗号化）
 *
 * 使い方:
 *   node scripts/circle-pack.mjs --pass "合言葉" --title "2026年冬の課題曲" 曲A.mid 曲B.mid ...
 *   node scripts/circle-pack.mjs --pass "合言葉" --manifest songs.json
 *
 * songs.json の形式（任意。曲名・説明・BPM・ガイドのトラック番号を指定したいとき）:
 *   { "title": "...", "songs": [ { "file": "a.mid", "name": "曲名", "description": "...", "bpm": 90, "track": 1 } ] }
 *
 * 出力: public/circle/pack.json（--out で変更可）
 * 合言葉を変えるときは、同じ MIDI でこのスクリプトをもう一度実行するだけでよい。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve, extname } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

const args = process.argv.slice(2);
const opt = { out: 'public/circle/pack.json', iter: 210000 };
const files = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pass') opt.pass = args[++i];
    else if (a === '--title') opt.title = args[++i];
    else if (a === '--manifest') opt.manifest = args[++i];
    else if (a === '--out') opt.out = args[++i];
    else if (a === '--iter') opt.iter = parseInt(args[++i], 10);
    else files.push(a);
}
if (!opt.pass) { console.error('--pass "合言葉" を指定してください'); process.exit(1); }

let entries = [];
let title = opt.title || 'サークル課題曲';
if (opt.manifest) {
    const m = JSON.parse(readFileSync(opt.manifest, 'utf8'));
    title = opt.title || m.title || title;
    const base = dirname(resolve(opt.manifest));
    entries = m.songs.map(s => ({ ...s, file: resolve(base, s.file) }));
} else {
    entries = files.map(f => ({ file: f, name: basename(f, extname(f)) }));
}
if (entries.length === 0) { console.error('MIDI ファイルを指定してください'); process.exit(1); }

const songs = entries.map((e, i) => {
    const buf = readFileSync(e.file);
    if (buf.subarray(0, 4).toString('latin1') !== 'MThd') throw new Error(`MIDI ではありません: ${e.file}`);
    return {
        id: `circle-${i + 1}`,
        name: e.name || basename(e.file, extname(e.file)),
        ...(e.description ? { description: e.description } : {}),
        ...(e.bpm ? { bpm: e.bpm } : {}),
        ...(e.track !== undefined ? { track: e.track } : {}),
        midi: buf.toString('base64'),
    };
});

const plain = new TextEncoder().encode(JSON.stringify({ title, updatedAt: new Date().toISOString(), songs }));
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(opt.pass.normalize('NFKC').trim()), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: opt.iter },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
const b64 = u => Buffer.from(u).toString('base64');

mkdirSync(dirname(opt.out), { recursive: true });
writeFileSync(opt.out, JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: opt.iter, salt: b64(salt), iv: b64(iv), data: b64(data) }));
console.log(`${opt.out} に ${songs.length} 曲を書き出しました（${title}）`);
for (const s of songs) console.log(` - ${s.name}`);
