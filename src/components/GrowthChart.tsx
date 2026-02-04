import { useRef, useEffect } from 'react';
import type { HistoryRecord } from '../lib/HistoryManager';

interface GrowthChartProps {
    records: HistoryRecord[];
}

export function GrowthChart({ records }: GrowthChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;

        // Clear
        ctx.clearRect(0, 0, width, height);

        if (records.length < 2) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('データ不足のためグラフを表示できません', width / 2, height / 2);
            return;
        }

        // Prepare data (Oldest -> Newest)
        // We only show up to last 20 sessions for clarity
        const data = [...records].reverse().slice(-20);

        // Chart Area
        const padding = { top: 20, right: 20, bottom: 30, left: 40 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // Scales
        const getX = (i: number) => padding.left + (i / (data.length - 1)) * chartW;
        const getY = (score: number) => padding.top + chartH - (score / 100) * chartH;

        // Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (i / 4) * chartH;
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);

            // Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${100 - i * 25}`, padding.left - 5, y + 4);
        }
        ctx.stroke();

        // Line
        ctx.strokeStyle = '#3b82f6'; // Blue-500
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.forEach((r, i) => {
            const x = getX(i);
            const y = getY(r.score);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Gradient Fill
        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
        ctx.fillStyle = gradient;
        ctx.lineTo(getX(data.length - 1), height - padding.bottom);
        ctx.lineTo(getX(0), height - padding.bottom);
        ctx.fill();

        // Dots and Tooltip areas (just dots for now)
        data.forEach((r, i) => {
            const x = getX(i);
            const y = getY(r.score);

            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.stroke();
        });

        // X Axis Labels (Date)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.textAlign = 'center';
        // Show start and end date
        if (data.length > 0) {
            const startStr = new Date(data[0].date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
            ctx.fillText(startStr, padding.left, height - 10);

            const endStr = new Date(data[data.length - 1].date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
            ctx.fillText(endStr, width - padding.right, height - 10);
        }

    }, [records]);

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-48 bg-white/5 rounded-xl border border-white/10"
        />
    );
}
