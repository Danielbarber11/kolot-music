// Google Analytics 4 / Google Tag telemetry helper (G-QMQF4QL9XX & GTM-NHZTCVC7)

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const GA_MEASUREMENT_ID = 'G-QMQF4QL9XX';

function callGtag(...args: any[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.gtag === 'function') {
      window.gtag(...args);
    } else {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(args);
    }
  } catch {}
}

export function trackPageView(pagePath: string, pageTitle?: string): void {
  callGtag('event', 'page_view', {
    send_to: GA_MEASUREMENT_ID,
    page_path: pagePath,
    page_location: typeof window !== 'undefined' ? window.location.href : undefined,
    page_title: pageTitle || (typeof document !== 'undefined' ? document.title : 'Kolot Music'),
  });
}

export function trackEvent(eventName: string, params?: Record<string, any>): void {
  callGtag('event', eventName, {
    send_to: GA_MEASUREMENT_ID,
    ...(params || {}),
  });
}

export function trackSongPlay(track: {
  id: string;
  name: string;
  artistName: string;
  genre?: string;
  viewsCount?: number;
}): void {
  trackEvent('play_song', {
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artistName,
    genre: track.genre || 'general',
    ...(typeof track.viewsCount === 'number' && Number.isFinite(track.viewsCount)
      ? { views_count: track.viewsCount }
      : {}),
  });
}

export function trackSearchQuery(query: string): void {
  const clean = (query || '').trim();
  if (!clean) return;
  trackEvent('search', { search_term: clean });
}
