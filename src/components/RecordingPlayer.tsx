import { useRef, useState, useEffect } from 'react';
import { Play, Pause, X, Download, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface RecordingPlayerProps {
    audioBlob: Blob;
    onClose: () => void;
}

export function RecordingPlayer({ audioBlob, onClose }: RecordingPlayerProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const audioUrlRef = useRef<string | null>(null);
    const [visualizerData, setVisualizerData] = useState<number[]>(new Array(30).fill(20));

    useEffect(() => {
        if (!isPlaying) return;
        const interval = setInterval(() => {
            setVisualizerData(Array.from({ length: 30 }, () => Math.random() * 80 + 10));
        }, 50);
        return () => clearInterval(interval);
    }, [isPlaying]);

    useEffect(() => {
        // Create URL from Blob
        const url = URL.createObjectURL(audioBlob);
        audioUrlRef.current = url;
        if (audioRef.current) {
            audioRef.current.src = url;
        }

        return () => {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
        };
    }, [audioBlob]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value);
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleDownload = () => {
        if (!audioUrlRef.current) return;
        const a = document.createElement('a');
        a.href = audioUrlRef.current;
        a.download = `ontei-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
        a.click();
    };

    const formatTime = (seconds: number) => {
        if (!isFinite(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col gap-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-6 bg-red-500 rounded-full animate-pulse" />
                        録音プレビュー
                    </h3>
                    <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Audio Element (Hidden) */}

                <audio
                    ref={audioRef}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={() => setIsPlaying(false)}
                />

                {/* Visualizer / Waveform Placeholder */}
                <div className="h-24 bg-black/40 rounded-xl border border-white/5 flex items-center justify-center relative overflow-hidden group">
                    {/* Bars Animation (Fake) */}
                    <div className="flex items-center gap-1 h-full w-full justify-center px-4">
                        {Array.from({ length: 30 }).map((_, i) => (
                            <div
                                key={i}
                                className={cn(
                                    "w-1 bg-white/20 rounded-full transition-all duration-100",
                                    isPlaying ? "animate-pulse" : ""
                                )}
                                style={{
                                    height: `${isPlaying ? visualizerData[i] : 20}%`,
                                    transition: 'height 0.05s ease'
                                }}
                            />
                        ))}
                    </div>
                </div>

                {/* Timeline */}
                <div className="space-y-2">
                    <div className="flex justify-between text-xs text-white/50 font-mono">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max={duration || 100}
                        value={currentTime}
                        onChange={handleSeek}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500"
                    />
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-6">
                    <button
                        onClick={onClose}
                        className="p-3 rounded-full bg-white/5 text-white/40 hover:bg-red-500/10 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                        title="削除して閉じる"
                    >
                        <Trash2 size={20} />
                    </button>

                    <button
                        onClick={togglePlay}
                        className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/20 hover:scale-105 hover:bg-red-400 transition-all"
                    >
                        {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
                    </button>

                    <button
                        onClick={handleDownload}
                        className="p-3 rounded-full bg-white/5 text-blue-300 hover:bg-blue-500/10 transition-all border border-blue-500/20"
                        title="ダウンロード"
                    >
                        <Download size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
