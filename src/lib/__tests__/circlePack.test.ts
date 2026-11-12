import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptPack, b64ToBytes } from '../circlePack';

// MThd ヘッダだけの最小 MIDI（スクリプトの形式チェック用）
const MINI_MIDI = Buffer.from('4d546864000000060000000101e04d54726b0000000400ff2f00', 'hex');

function makePack(args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    const mid = join(dir, '曲.mid');
    writeFileSync(mid, MINI_MIDI);
    const out = join(dir, 'pack.json');
    execFileSync('node', ['scripts/circle-pack.mjs', ...args, '--out', out, mid], { stdio: 'pipe' });
    return JSON.parse(readFileSync(out, 'utf8'));
}

describe('課題曲パック', () => {
    it('合言葉ありのパックは正しい合言葉でだけ開ける', async () => {
        const file = makePack(['--pass', 'すばる', '--iter', '1000']);
        const pack = await decryptPack(file, 'すばる');
        expect(pack.songs[0].name).toBe('曲');
        expect(Buffer.from(b64ToBytes(pack.songs[0].midi)).subarray(0, 4).toString()).toBe('MThd');
        await expect(decryptPack(file, 'ちがう')).rejects.toThrow();
    });

    it('合言葉なしのパックは平文で読める', () => {
        const file = makePack(['--no-pass']);
        expect(file.plain).toBe(true);
        expect(file.songs[0].name).toBe('曲');
    });

    it('公開中の課題曲パックが壊れていない', () => {
        const p = 'public/circle/pack.json';
        if (!existsSync(p)) return;
        const file = JSON.parse(readFileSync(p, 'utf8'));
        expect(file.v).toBe(1);
        const songs = file.plain ? file.songs : [];
        for (const s of songs) expect(Buffer.from(b64ToBytes(s.midi)).subarray(0, 4).toString()).toBe('MThd');
    });
});
