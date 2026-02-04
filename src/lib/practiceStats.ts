// Practice Statistics Storage and Analytics

export interface PracticeSession {
    id: string;
    date: string; // ISO date string
    duration: number; // seconds
    score: number; // 0-100
    pitchAccuracy: number; // 0-100
    rhythmAccuracy: number; // 0-100
    notesHit: number;
    notesTotal: number;
    songName?: string;
}

export interface PracticeStats {
    totalSessions: number;
    totalPracticeTime: number; // seconds
    averageScore: number;
    bestScore: number;
    streakDays: number;
    lastPracticeDate: string;
    sessionsThisWeek: number;
    scoreHistory: { date: string; score: number }[];
    weeklyPracticeTime: { [day: string]: number }; // Mon, Tue, etc.
}

const STORAGE_KEY = 'ontei-practice-history';

export const practiceStats = {
    getSessions(): PracticeSession[] {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    },

    saveSession(session: Omit<PracticeSession, 'id' | 'date'>): void {
        const sessions = this.getSessions();
        const newSession: PracticeSession = {
            ...session,
            id: crypto.randomUUID(),
            date: new Date().toISOString()
        };
        sessions.push(newSession);

        // Keep last 100 sessions
        const trimmed = sessions.slice(-100);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    },

    getStats(): PracticeStats {
        const sessions = this.getSessions();

        if (sessions.length === 0) {
            return {
                totalSessions: 0,
                totalPracticeTime: 0,
                averageScore: 0,
                bestScore: 0,
                streakDays: 0,
                lastPracticeDate: '',
                sessionsThisWeek: 0,
                scoreHistory: [],
                weeklyPracticeTime: {}
            };
        }

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Calculate streak
        let streakDays = 0;
        const uniqueDays = new Set(sessions.map(s => s.date.slice(0, 10)));
        const sortedDays = Array.from(uniqueDays).sort().reverse();

        for (let i = 0; i < sortedDays.length; i++) {
            const expectedDate = new Date(now);
            expectedDate.setDate(expectedDate.getDate() - i);
            const expectedStr = expectedDate.toISOString().slice(0, 10);

            if (sortedDays.includes(expectedStr)) {
                streakDays++;
            } else if (i > 0) {
                break;
            }
        }

        // Weekly practice time by day
        const weeklyPracticeTime: { [day: string]: number } = {};
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dayKey = dayNames[d.getDay()];
            const dateStr = d.toISOString().slice(0, 10);

            const dayTotal = sessions
                .filter(s => s.date.slice(0, 10) === dateStr)
                .reduce((sum, s) => sum + s.duration, 0);

            weeklyPracticeTime[dayKey] = (weeklyPracticeTime[dayKey] || 0) + dayTotal;
        }

        // Score history (last 30 sessions)
        const scoreHistory = sessions.slice(-30).map(s => ({
            date: s.date.slice(0, 10),
            score: s.score
        }));

        // Sessions this week
        const sessionsThisWeek = sessions.filter(s =>
            new Date(s.date) >= weekAgo
        ).length;

        return {
            totalSessions: sessions.length,
            totalPracticeTime: sessions.reduce((sum, s) => sum + s.duration, 0),
            averageScore: Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length),
            bestScore: Math.max(...sessions.map(s => s.score)),
            streakDays,
            lastPracticeDate: sessions[sessions.length - 1]?.date || '',
            sessionsThisWeek,
            scoreHistory,
            weeklyPracticeTime
        };
    },

    clearAll(): void {
        localStorage.removeItem(STORAGE_KEY);
    }
};
