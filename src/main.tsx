import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSync } from './lib/driveSync'

// LINE のアプリ内ブラウザで開かれたら、外部ブラウザ（Chrome・Safari）で開き直す（1 回だけ）
// 参考: LINE は URL に openExternalBrowser=1 が付いていると外部ブラウザで開く
if (/\sLine\//i.test(navigator.userAgent) && !/[?&]openExternalBrowser=1/.test(location.search)) {
  const u = new URL(location.href)
  u.searchParams.set('openExternalBrowser', '1')
  location.replace(u.toString())
}

initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Global Error Handler for Startup
window.addEventListener('error', (e) => {
  const root = document.getElementById('root');
  if (root && root.innerHTML === '') {
    root.innerHTML = `<div style="padding: 20px; color: #f87171; background: #222; height: 100vh;">
            <h1>Startup Error</h1>
            <pre>${e.message}</pre>
            <p>Check console for more details.</p>
        </div>`;
  }
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 新しい Service Worker に切り替わったら 1 度だけ自動で再読み込みし、最新版を表示する
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
      registration.update().catch(() => {});
      console.log('SW registered: ', registration);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
