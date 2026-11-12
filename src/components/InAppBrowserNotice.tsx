import { useState } from 'react';
import { X } from 'lucide-react';

/** LINE などアプリ内ブラウザで開かれたとき、マイクが使えない可能性があるので外部ブラウザへの切り替えを案内する */
function isInAppBrowser(): boolean {
    const ua = navigator.userAgent;
    return /\sLine\//i.test(ua) || /FBAN|FBAV|Instagram/i.test(ua);
}

export function InAppBrowserNotice() {
    const [open, setOpen] = useState(isInAppBrowser);
    if (!open) return null;
    return (
        <div className="absolute top-2 left-2 right-2 z-40 rounded-xl border border-amber-400/40 bg-amber-950/90 p-3 text-sm text-amber-100 shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute top-2 right-2 p-1 text-amber-200/60" aria-label="閉じる">
                <X className="w-4 h-4" />
            </button>
            <p className="font-bold mb-1">ブラウザで開き直してください</p>
            <p className="text-xs leading-relaxed text-amber-100/80 pr-4">
                LINEの中では、マイクがうまく使えないことがあります。
                画面右上の「︙」または「共有」から「ブラウザで開く」を選んでください。
            </p>
        </div>
    );
}
