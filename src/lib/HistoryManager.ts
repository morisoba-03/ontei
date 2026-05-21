export interface HistoryRecord {
    id: string;
    date: string; // ISO string
    score: number;
    accuracy: number;
    songName: string; // "Unknown" or infer from file name if possible
    duration: number; // seconds
}

const STORAGE_KEY = 'ontei-practice-history';

class HistoryManager {
    private static instance: HistoryManager;

    private constructor() { }

    public static getInstance(): HistoryManager {
        if (!HistoryManager.instance) {
            HistoryManager.instance = new HistoryManager();
        }
        return HistoryManager.instance;
    }

    public getRecords(): HistoryRecord[] {
        try {
            const json = localStorage.getItem(STORAGE_KEY);
            if (!json) return [];
            return JSON.parse(json);
        } catch (e) {
            console.error('Failed to load history:', e);
            return [];
        }
    }

    public saveRecord(record: Omit<HistoryRecord, 'id' | 'date'>): HistoryRecord {
        const newRecord: HistoryRecord = {
            ...record,
            id: crypto.randomUUID(),
            date: new Date().toISOString()
        };

        const records = this.getRecords();
        records.unshift(newRecord); // Add to beginning

        // Limit to 100 records to prevent storage bloat
        if (records.length > 100) {
            records.length = 100;
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        } catch (e) {
            console.error('Failed to save history:', e);
        }

        return newRecord;
    }

    public clearHistory(): void {
        localStorage.removeItem(STORAGE_KEY);
    }

    public getSongNames(): string[] {
        const records = this.getRecords();
        const names = [...new Set(records.map(r => r.songName))];
        return names.sort();
    }

    public getStats(records?: HistoryRecord[]): { totalDuration: number; averageScore: number; bestScore: number; totalSessions: number } {
        const data = records ?? this.getRecords();
        if (data.length === 0) {
            return { totalDuration: 0, averageScore: 0, bestScore: 0, totalSessions: 0 };
        }

        const totalDuration = data.reduce((sum, r) => sum + r.duration, 0);
        const averageScore = data.reduce((sum, r) => sum + r.score, 0) / data.length;
        const bestScore = Math.max(...data.map(r => r.score));

        return {
            totalDuration,
            averageScore,
            bestScore,
            totalSessions: data.length
        };
    }
}

export const historyManager = HistoryManager.getInstance();
export type { HistoryRecord as HistoryRecordType };
