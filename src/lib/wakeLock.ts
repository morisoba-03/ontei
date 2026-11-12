/**
 * 再生中は画面が自動で消えないようにする（Screen Wake Lock API）。
 * 対応していないブラウザでは何もしない。アプリ切り替えで解除されたら、戻ったときに取り直す。
 */
type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', fn: () => void): void };
type WakeLockNav = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire() {
    const nav = navigator as WakeLockNav;
    if (!nav.wakeLock || sentinel || document.visibilityState !== 'visible') return;
    try {
        sentinel = await nav.wakeLock.request('screen');
        sentinel.addEventListener('release', () => { sentinel = null; });
    } catch {
        sentinel = null; // 省電力モードなどで拒否されたときは諦める
    }
}

export function setKeepAwake(on: boolean) {
    wanted = on;
    if (on) {
        acquire();
    } else if (sentinel) {
        const s = sentinel;
        sentinel = null;
        s.release().catch(() => {});
    }
}

document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') acquire();
});
