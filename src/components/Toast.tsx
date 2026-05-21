import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface Toast {
    id: string;
    message: string;
    type: ToastType;
    action?: ToastAction;
}

// Global toast state and functions
let toastListeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

const notifyListeners = () => {
    toastListeners.forEach(listener => listener([...toasts]));
};

export const toast = {
    show: (message: string, type: ToastType = 'info', options?: { action?: ToastAction; duration?: number }) => {
        const id = crypto.randomUUID();
        toasts.push({ id, message, type, action: options?.action });
        notifyListeners();

        const duration = options?.duration ?? (options?.action ? 8000 : 3000);
        setTimeout(() => {
            toasts = toasts.filter(t => t.id !== id);
            notifyListeners();
        }, duration);
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

const actionColorMap = {
    success: 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-200',
    error: 'bg-red-500/30 hover:bg-red-500/50 text-red-200',
    warning: 'bg-yellow-500/30 hover:bg-yellow-500/50 text-yellow-200',
    info: 'bg-blue-500/30 hover:bg-blue-500/50 text-blue-200',
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
                            "flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-md shadow-lg",
                            "animate-in slide-in-from-right duration-300",
                            colorMap[t.type]
                        )}
                    >
                        <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">{t.message}</span>
                            {t.action && (
                                <button
                                    onClick={() => { t.action!.onClick(); dismiss(t.id); }}
                                    className={cn(
                                        "mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                                        actionColorMap[t.type]
                                    )}
                                >
                                    {t.action.label}
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => dismiss(t.id)}
                            className="p-1 hover:bg-white/10 rounded-full transition-colors shrink-0"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
