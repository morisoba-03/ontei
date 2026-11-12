// 画面下部などに出る短いお知らせ（トースト）の状態管理。表示は components/Toast.tsx
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
    action?: ToastAction;
}

// Global toast state and functions
let toastListeners: ((toasts: Toast[]) => void)[] = [];

/** ToastContainer が表示用に購読する */
export function subscribeToasts(fn: (toasts: Toast[]) => void): () => void {
    toastListeners.push(fn);
    return () => { toastListeners = toastListeners.filter(l => l !== fn); };
}

export function dismissToast(id: string) {
    toasts = toasts.filter(t => t.id !== id);
    notifyListeners();
}
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

