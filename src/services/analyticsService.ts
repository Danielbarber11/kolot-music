import { getAuthHeaders } from './authService';

// Google Analytics 4 / Google Tag telemetry helper (G-QMQF4QL9XX & GTM-NHZTCVC7)

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const GA_MEASUREMENT_ID = 'G-QMQF4QL9XX';

let lastTrackedPath = '';
let lastTrackedAt = 0;

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
  const now = Date.now();
  if (pagePath === lastTrackedPath && now - lastTrackedAt < 400) {
    return;
  }
  lastTrackedPath = pagePath;
  lastTrackedAt = now;
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
}): void {
  trackEvent('play_song', {
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artistName,
    genre: track.genre || 'general',
  });
}

export function trackSearchQuery(query: string): void {
  const clean = (query || '').trim();
  if (!clean) return;
  trackEvent('search', { search_term: clean });
}

export interface SongGaViewsResponse {
  configured: boolean;
  viewsCount: number | null;
  updatedAt?: number;
}

const songGaViewsMemCache = new Map<string, { ts: number; data: SongGaViewsResponse }>();

export async function fetchSongGaViews(trackId: string): Promise<SongGaViewsResponse> {
  const cleanId = String(trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!cleanId) return { configured: false, viewsCount: null };

  const now = Date.now();
  const cached = songGaViewsMemCache.get(cleanId);
  if (cached && now - cached.ts < 30_000) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/analytics/song/${encodeURIComponent(cleanId)}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      return { configured: false, viewsCount: null };
    }
    const json = await res.json().catch(() => null);
    const data: SongGaViewsResponse = {
      configured: Boolean(json?.configured),
      viewsCount: typeof json?.viewsCount === 'number' ? json.viewsCount : null,
      updatedAt: typeof json?.updatedAt === 'number' ? json.updatedAt : undefined,
    };
    songGaViewsMemCache.set(cleanId, { ts: now, data });
    return data;
  } catch {
    return { configured: false, viewsCount: null };
  }
}

export interface AdminSongWindowRecord {
  id: string;
  title: string;
  mode: 'song' | 'artist' | 'genre' | 'all';
  targetValue: string;
  createdAt: string;
}

export interface AdminAnalyticsSongItem {
  id: string;
  name: string;
  artistName: string;
  genre: string;
  coverUrl?: string;
  uploadedByUid?: string;
  playsCount: number;
  gaViews: number | null;
}

export interface AdminAnalyticsProfileItem {
  uid: string;
  name: string;
  avatarUrl?: string;
  tracksCount: number;
  totalGaViews: number | null;
  isActive: boolean;
  isMultiTrack: boolean;
  isHidden: boolean;
  joinedDate?: string;
  updatedAt?: string;
}

export interface AdminAnalyticsNoProfileItem {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  lastSeenAt?: string;
}

export interface AdminAnalyticsDashboardData {
  success: boolean;
  ga: {
    configured: boolean;
    propertyId?: string;
    gaTotalUsers: number;
    gaActiveUsers: number;
    gaNewUsers: number;
    gaTotalPageViews: number;
    gaRealtimeActiveUsers: number;
    totalRowsScanned: number;
    updatedAt: number;
    error?: string;
  };
  usersSummary: {
    totalProfiles: number;
    activeProfiles: number;
    multiTrackProfiles: number;
    hiddenProfiles: number;
    signedInWithoutProfile: number;
    gaVisitorsWithoutProfile: number | null;
  };
  profilesList: AdminAnalyticsProfileItem[];
  signedInWithoutProfileList: AdminAnalyticsNoProfileItem[];
  songsList: AdminAnalyticsSongItem[];
  windows: AdminSongWindowRecord[];
}

export async function fetchAdminAnalyticsDashboard(forceRefresh = false): Promise<AdminAnalyticsDashboardData> {
  const url = forceRefresh ? '/api/admin/analytics-dashboard?refresh=1' : '/api/admin/analytics-dashboard';
  const res = await fetch(url, {
    headers: {
      ...getAuthHeaders(),
    },
    credentials: 'include',
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json as AdminAnalyticsDashboardData;
}

export async function saveAdminAnalyticsWindows(windows: AdminSongWindowRecord[]): Promise<AdminSongWindowRecord[]> {
  const res = await fetch('/api/admin/analytics-windows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify({ windows }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return Array.isArray(json.windows) ? json.windows : windows;
}

