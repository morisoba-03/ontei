import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

// Global toast state and functions
let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

const notifyListeners = () => {
    toastListeners.forEach(listener => listener([...toasts]));
};

export const toast = {
    show: (message: string, type: ToastType = 'info') => {
        const id = crypto.randomUUID();
        toasts.push({ id, message, type });
        notifyListeners();

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
            toasts = toasts.filter(t => t.id !== id);
            notifyListeners();
        }, 3000);
    },
    success: (message: string) => toast.show(message, 'success'),
    error: (message: string) => toast.show(message, 'error'),
    warning: (message: string) => toast.show(message, 'warning'),
    info: (message: string) => toast.show(message, 'info'),
};

const iconMap = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
};

const colorMap = {
    success: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    error: 'bg-red-500/20 border-red-500/40 text-red-300',
    warning: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300',
    info: 'bg-blue-500/20 border-blue-500/40 text-blue-300',
};

export function ToastContainer() {
    const [currentToasts, setCurrentToasts] = useState<Toast[]>([]);

    useEffect(() => {
        const listener = (newToasts: Toast[]) => setCurrentToasts(newToasts);
        toastListeners.push(listener);
        return () => {
            toastListeners = toastListeners.filter(l => l !== listener);
        };
    }, []);

    const dismiss = useCallback((id: string) => {
        toasts = toasts.filter(t => t.id !== id);
        notifyListeners();
    }, []);

    if (currentToasts.length === 0) return null;

    return (
        <div className="fixed top-16 right-4 z-[300] flex flex-col gap-2 max-w-sm">
            {currentToasts.map(t => {
                const Icon = iconMap[t.type];
                return (
                    <div
                        key={t.id}
                        className={cn(
                            "flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg",
                            "animate-in slide-in-from-right duration-300",
                            colorMap[t.type]
                        )}
                    >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span className="text-sm font-medium flex-1">{t.message}</span>
                        <button
                            onClick={() => dismiss(t.id)}
                            className="p-1 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
