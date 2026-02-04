import { useState, useEffect } from 'react';
import { X, TrendingUp, Clock, Target, Flame, Calendar, BarChart3 } from 'lucide-react';
import { practiceStats, type PracticeStats } from '../lib/practiceStats';
import { cn } from '../lib/utils';

interface StatsDashboardProps {
    open: boolean;
    onClose: () => void;
}

export function StatsDashboard({ open, onClose }: StatsDashboardProps) {
    const [stats, setStats] = useState<PracticeStats | null>(null);

    useEffect(() => {
        if (open) {
            setStats(practiceStats.getStats());
        }
    }, [open]);

    if (!open || !stats) return null;

    const formatTime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}時間${mins}分`;
        return `${mins}分`;
    };

    const maxWeeklyTime = Math.max(...Object.values(stats.weeklyPracticeTime), 1);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-800/50 shrink-0">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-blue-400" />
                        練習統計
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto flex-1 space-y-4">
                    {stats.totalSessions === 0 ? (
                        <div className="text-center py-12 text-white/50">
                            <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p>まだ練習記録がありません</p>
                            <p className="text-sm mt-2">練習を始めると統計が表示されます</p>
                        </div>
                    ) : (
                        <>
                            {/* Summary Cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <StatCard
                                    icon={<Clock className="w-5 h-5" />}
                                    label="総練習時間"
                                    value={formatTime(stats.totalPracticeTime)}
                                    color="blue"
                                />
                                <StatCard
                                    icon={<Target className="w-5 h-5" />}
                                    label="平均スコア"
                                    value={`${stats.averageScore}点`}
                                    color="emerald"
                                />
                                <StatCard
                                    icon={<TrendingUp className="w-5 h-5" />}
                                    label="最高スコア"
                                    value={`${stats.bestScore}点`}
                                    color="yellow"
                                />
                                <StatCard
                                    icon={<Flame className="w-5 h-5" />}
                                    label="連続練習"
                                    value={`${stats.streakDays}日`}
                                    color="orange"
                                />
                            </div>

                            {/* Weekly Activity */}
                            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                <div className="flex items-center gap-2 mb-3">
                                    <Calendar className="w-4 h-4 text-white/50" />
                                    <span className="text-sm text-white/70">今週の練習</span>
                                    <span className="ml-auto text-xs text-white/40">{stats.sessionsThisWeek}回</span>
                                </div>
                                <div className="flex items-end gap-1 h-20">
                                    {Object.entries(stats.weeklyPracticeTime).map(([day, time]) => (
                                        <div key={day} className="flex-1 flex flex-col items-center gap-1">
                                            <div
                                                className={cn(
                                                    "w-full rounded-t transition-all",
                                                    time > 0 ? "bg-blue-500" : "bg-white/10"
                                                )}
                                                style={{ height: `${Math.max(4, (time / maxWeeklyTime) * 60)}px` }}
                                            />
                                            <span className="text-xs text-white/40">{day}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Score History */}
                            {stats.scoreHistory.length > 0 && (
                                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                    <div className="flex items-center gap-2 mb-3">
                                        <TrendingUp className="w-4 h-4 text-white/50" />
                                        <span className="text-sm text-white/70">スコア推移</span>
                                    </div>
                                    <div className="flex items-end gap-0.5 h-16">
                                        {stats.scoreHistory.map((entry, i) => (
                                            <div
                                                key={i}
                                                className={cn(
                                                    "flex-1 rounded-t transition-all min-w-[4px]",
                                                    entry.score >= 80 ? "bg-emerald-500" :
                                                        entry.score >= 60 ? "bg-yellow-500" :
                                                            "bg-red-500"
                                                )}
                                                style={{ height: `${(entry.score / 100) * 100}%` }}
                                                title={`${entry.date}: ${entry.score}点`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon, label, value, color }: {
    icon: React.ReactNode;
    label: string;
    value: string;
    color: 'blue' | 'emerald' | 'yellow' | 'orange';
}) {
    const colorClasses = {
        blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
        emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
        yellow: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
        orange: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
    };

    return (
        <div className={cn("rounded-xl p-3 border", colorClasses[color])}>
            <div className="flex items-center gap-2 mb-1">
                {icon}
                <span className="text-xs text-white/50">{label}</span>
            </div>
            <div className="text-xl font-bold text-white">{value}</div>
        </div>
    );
}
