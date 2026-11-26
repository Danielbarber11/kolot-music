import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeMultiMusicService } from './services/multiMusicService';

import { ErrorBoundary } from './components/ErrorBoundary.tsx';

if (typeof document !== 'undefined') {
  document.title = 'Kolot Music';
}

// Recover automatically if an older cached tab references stale hashed JS/CSS chunks after a Cloudflare deploy
async function triggerCleanChunkRecoveryReload() {
  try {
    const now = Date.now();
    const lastReload = parseInt(sessionStorage.getItem('kolot_chunk_reload_ts') || '0', 10);
    if (now - lastReload < 15000) return;
    sessionStorage.setItem('kolot_chunk_reload_ts', String(now));

    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
      }
      if ('caches' in window) {
        const names = await caches.keys().catch(() => []);
        await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
      }
    }
  } catch {
    // Non-fatal
  }
  window.location.reload();
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void triggerCleanChunkRecoveryReload();
});

window.addEventListener(
  'error',
  (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
      if (src.includes('/assets/')) {
        void triggerCleanChunkRecoveryReload();
      }
    }
  },
  true
);

// Start fetching data immediately in parallel with initial bundle evaluation
initializeMultiMusicService().catch(() => {});

// Register service worker v6 and check for updates immediately
if (
  'serviceWorker' in navigator &&
  (import.meta.env.PROD || window.location.protocol === 'https:')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn('SW registration failed:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
