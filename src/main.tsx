import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeMultiMusicService } from './services/multiMusicService';

import { ErrorBoundary } from './components/ErrorBoundary.tsx';

// Start fetching data immediately in the background
initializeMultiMusicService().catch(() => {});

// Register service worker for PWA support
if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'development') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
