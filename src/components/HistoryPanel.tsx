import { useState } from 'react';
import { X, Clock, Trophy, Trash2, Calendar } from 'lucide-react';
import { historyManager } from '../lib/HistoryManager';
import type { HistoryRecord } from '../lib/HistoryManager';
import { GrowthChart } from './GrowthChart';
import { cn } from '../lib/utils';

export function HistoryPanel({ onClose }: { onClose: () => void }) {
    const [records, setRecords] = useState<HistoryRecord[]>(() => historyManager.getRecords());
    const [stats, setStats] = useState(() => historyManager.getStats());

    const loadData = () => {
        setRecords(historyManager.getRecords());
        setStats(historyManager.getStats());
    };



    const handleClear = () => {
        if (confirm('練習履歴をすべて削除しますか？')) {
            historyManager.clearHistory();
            loadData();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-2xl bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 bg-white/5">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                        <Clock className="text-blue-400" />
                        練習履歴・成長記録
                    </h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/60 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="overflow-y-auto p-6 space-y-8 custom-scrollbar">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-white/40 text-xs font-bold uppercase mb-1">練習回数</div>
                            <div className="text-2xl font-bold text-white">{stats.totalSessions} <span className="text-sm font-normal text-white/40">回</span></div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-white/40 text-xs font-bold uppercase mb-1">総練習時間</div>
                            <div className="text-2xl font-bold text-white">{(stats.totalDuration / 60).toFixed(1)} <span className="text-sm font-normal text-white/40">分</span></div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-white/40 text-xs font-bold uppercase mb-1">平均スコア</div>
                            <div className={cn("text-2xl font-bold", stats.averageScore >= 80 ? "text-green-400" : "text-yellow-400")}>
                                {stats.averageScore.toFixed(1)}
                            </div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                            <div className="text-white/40 text-xs font-bold uppercase mb-1">ベストスコア</div>
                            <div className="text-2xl font-bold text-purple-400 flex items-center gap-1">
                                {stats.bestScore > 0 && <Trophy size={16} />}
                                {stats.bestScore.toFixed(1)}
                            </div>
                        </div>
                    </div>

                    {/* Growth Chart */}
                    <div>
                        <h3 className="text-white/70 font-bold mb-3 flex items-center gap-2">
                            <span className="w-1 h-4 bg-blue-500 rounded-full" />
                            スコア推移
                        </h3>
                        <GrowthChart records={records} />
                    </div>

                    {/* Filters (Optional placeholder for now) */}
                    {/* Suggestion: Add filter by song later */}

                    {/* Records List */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-white/70 font-bold flex items-center gap-2">
                                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                                履歴一覧
                            </h3>
                            {records.length > 0 && (
                                <button onClick={handleClear} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-2 py-1 hover:bg-red-500/10 rounded transition-colors">
                                    <Trash2 size={12} />
                                    履歴削除
                                </button>
                            )}
                        </div>

                        <div className="space-y-2">
                            {records.length === 0 ? (
                                <div className="text-center py-8 text-white/30 border border-dashed border-white/10 rounded-xl">
                                    まだ履歴がありません。<br />練習して結果を表示するとここに記録されます。
                                </div>
                            ) : (
                                records.map(record => (
                                    <div key={record.id} className="bg-white/5 hover:bg-white/10 transition-colors p-3 rounded-xl border border-white/5 flex items-center justify-between group">
                                        <div className="flex items-center gap-4">
                                            <div className={cn(
                                                "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm",
                                                record.score >= 90 ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" :
                                                    record.score >= 80 ? "bg-green-500/20 text-green-300 border border-green-500/40" :
                                                        "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40"
                                            )}>
                                                {Math.round(record.score)}
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold text-white/90">{record.songName}</div>
                                                <div className="text-xs text-white/50 flex items-center gap-2">
                                                    <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(record.date).toLocaleString()}</span>
                                                    <span>•</span>
                                                    <span>{Math.floor(record.duration / 60)}分 {Math.floor(record.duration % 60)}秒</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs text-white/40 mb-0.5">精度</div>
                                            <div className="text-sm font-mono text-white/80">{record.accuracy.toFixed(1)}%</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
