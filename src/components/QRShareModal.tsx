import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { strToU8, deflateSync } from 'fflate';
import type { PresetSong } from '../lib/presetSongs';

interface Props {
    song: PresetSong;
    onClose: () => void;
}

const CHUNK_SIZE = 500;

function buildChunks(song: PresetSong, sessionId: string): string[] {
    const json = JSON.stringify(song);
    const compressed = deflateSync(strToU8(json));
    let binary = '';
    for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
    const base64 = btoa(binary);

    const dataChunks: string[] = [];
    for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
        dataChunks.push(base64.slice(i, i + CHUNK_SIZE));
    }

    return dataChunks.map((d, i) =>
        JSON.stringify({ i, n: dataChunks.length, id: sessionId, d })
    );
}

export function QRShareModal({ song, onClose }: Props) {
    const [qrChunks, setQrChunks] = useState<string[]>([]);
    const [current, setCurrent] = useState(0);
    const [sessionId] = useState(() => Math.random().toString(36).slice(2, 8));
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        setQrChunks(buildChunks(song, sessionId));
        setCurrent(0);
    }, [song, sessionId]);

    useEffect(() => {
        if (!qrChunks[current] || !canvasRef.current) return;
        QRCode.toCanvas(canvasRef.current, qrChunks[current], {
            width: 260,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
        });
    }, [qrChunks, current]);

    const total = qrChunks.length;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                        <QrCode className="w-5 h-5 text-purple-400" />
                        QRコード共有
                    </h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-xs text-white/50 text-center">「{song.name}」をスマホでスキャン</p>

                    {/* QR Code */}
                    <div className="flex justify-center">
                        <div className="bg-white rounded-xl p-3">
                            <canvas ref={canvasRef} />
                        </div>
                    </div>

                    {/* Progress */}
                    <div className="text-center space-y-2">
                        <p className="text-white text-lg font-bold">
                            {current + 1} <span className="text-white/40 text-base font-normal">/ {total}</span>
                        </p>
                        {/* Dot indicators */}
                        <div className="flex justify-center gap-1.5">
                            {qrChunks.map((_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setCurrent(i)}
                                    className={`w-2.5 h-2.5 rounded-full transition-all ${i === current
                                        ? 'bg-purple-400 scale-125'
                                        : 'bg-white/20 hover:bg-white/40'
                                        }`}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Navigation */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => setCurrent(i => Math.max(0, i - 1))}
                            disabled={current === 0}
                            className="flex-1 py-2.5 flex items-center justify-center gap-1 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            <ChevronLeft className="w-5 h-5" /> 前へ
                        </button>
                        <button
                            onClick={() => setCurrent(i => Math.min(total - 1, i + 1))}
                            disabled={current === total - 1}
                            className="flex-1 py-2.5 flex items-center justify-center gap-1 rounded-xl bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            次へ <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <p className="text-xs text-white/30 text-center">スマホ側で「QRスキャン」を使ってください</p>
                </div>
            </div>
        </div>
    );
}
