import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera, CheckCircle2 } from 'lucide-react';
import jsQR from 'jsqr';
import { strFromU8, inflateSync } from 'fflate';
import type { PresetSong } from '../lib/presetSongs';

interface Props {
    onClose: () => void;
    onImported: (song: PresetSong) => void;
}

interface QRChunk {
    i: number;
    n: number;
    id: string;
    d: string;
}

export function QRScanModal({ onClose, onImported }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);
    const chunksRef = useRef<Map<string, Map<number, string>>>(new Map());
    const doneRef = useRef(false);

    const [status, setStatus] = useState<{ got: number; total: number } | null>(null);
    const [done, setDone] = useState(false);
    const [cameraError, setCameraError] = useState(false);

    const stopCamera = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        if (videoRef.current?.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        }
    }, []);

    const processFrame = useCallback(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) {
            rafRef.current = requestAnimationFrame(processFrame);
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height);

        if (result && !doneRef.current) {
            try {
                const chunk: QRChunk = JSON.parse(result.data);
                if (typeof chunk.i === 'number' && chunk.n && chunk.id && chunk.d) {
                    if (!chunksRef.current.has(chunk.id)) {
                        chunksRef.current.set(chunk.id, new Map());
                    }
                    const session = chunksRef.current.get(chunk.id)!;
                    session.set(chunk.i, chunk.d);
                    setStatus({ got: session.size, total: chunk.n });

                    if (session.size === chunk.n) {
                        doneRef.current = true;
                        let base64 = '';
                        for (let i = 0; i < chunk.n; i++) base64 += session.get(i) ?? '';
                        const binary = atob(base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                        const json = strFromU8(inflateSync(bytes));
                        const song: PresetSong = JSON.parse(json);
                        song.id = 'user-' + Date.now();
                        stopCamera();
                        setDone(true);
                        onImported(song);
                        return;
                    }
                }
            } catch { /* ignore non-matching QR codes */ }
        }

        rafRef.current = requestAnimationFrame(processFrame);
    }, [stopCamera, onImported]);

    useEffect(() => {
        const start = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
            } catch {
                setCameraError(true);
            }
        };
        start();
        return () => stopCamera();
    }, [stopCamera]);

    useEffect(() => {
        rafRef.current = requestAnimationFrame(processFrame);
        return () => cancelAnimationFrame(rafRef.current);
    }, [processFrame]);

    const handleClose = () => { stopCamera(); onClose(); };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                        <Camera className="w-5 h-5 text-blue-400" />
                        QRスキャン
                    </h2>
                    <button onClick={handleClose} className="p-1.5 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {done ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <CheckCircle2 className="w-16 h-16 text-green-400" />
                            <p className="text-white font-semibold text-lg">インポート完了！</p>
                            <button
                                onClick={handleClose}
                                className="mt-2 px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
                            >
                                閉じる
                            </button>
                        </div>
                    ) : cameraError ? (
                        <div className="py-8 text-center space-y-2">
                            <p className="text-red-400 font-medium">カメラにアクセスできません</p>
                            <p className="text-xs text-white/40">ブラウザの設定でカメラを許可してください</p>
                        </div>
                    ) : (
                        <>
                            {/* Camera view */}
                            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="w-52 h-52 border-2 border-white/70 rounded-2xl shadow-lg" />
                                </div>
                            </div>
                            <canvas ref={canvasRef} className="hidden" />

                            {/* Scan progress */}
                            {status ? (
                                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 space-y-2">
                                    <p className="text-green-400 text-sm text-center font-medium">
                                        {status.got} / {status.total} 枚スキャン済み
                                    </p>
                                    <div className="flex gap-1">
                                        {Array.from({ length: status.total }).map((_, i) => (
                                            <div
                                                key={i}
                                                className={`h-2 rounded-full flex-1 transition-colors ${i < status.got ? 'bg-green-400' : 'bg-white/20'}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-white/40 text-center">
                                    PCに表示されたQRコードにカメラを向けてください
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
