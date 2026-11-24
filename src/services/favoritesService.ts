import { getAuthHeaders } from './authService';

const FAVORITES_KEY_PREFIX = 'kolot_favorites_uid_';
export const FAVORITES_CHANGED_EVENT = 'kolot_favorites_changed';
export const MY_FAVORITE_COUNTS_CHANGED_EVENT = 'kolot_my_favorite_counts_changed';

const syncedFavoritesUids = new Set<string>();

function normalizeUid(uid?: string | null): string {
  if (!uid || typeof uid !== 'string') return '';
  return uid.replace(/^artist_/, '').trim();
}

export function getUserFavorites(uid?: string | null): string[] {
  const cleanUid = normalizeUid(uid);
  if (!cleanUid || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${FAVORITES_KEY_PREFIX}${cleanUid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveUserFavorites(uid: string | null | undefined, ids: string[]): string[] {
  const cleanUid = normalizeUid(uid);
  if (!cleanUid || typeof localStorage === 'undefined') return [];
  const uniqueIds = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim().length > 0)));
  try {
    localStorage.setItem(`${FAVORITES_KEY_PREFIX}${cleanUid}`, JSON.stringify(uniqueIds));
  } catch {}
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FAVORITES_CHANGED_EVENT, { detail: { uid: cleanUid, ids: uniqueIds } }));
    }
  } catch {}
  return uniqueIds;
}

async function persistFavoriteToggleToCloud(trackId: string, liked: boolean): Promise<void> {
  try {
    const res = await fetch('/api/storage/favorites/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({ trackId, liked }),
    });
    if (res.ok && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MY_FAVORITE_COUNTS_CHANGED_EVENT));
    }
  } catch {}
}

export async function syncUserFavoritesWithCloud(uid?: string | null, force = false): Promise<string[]> {
  const cleanUid = normalizeUid(uid);
  if (!cleanUid) return [];
  const localIds = getUserFavorites(cleanUid);
  if (!force && syncedFavoritesUids.has(cleanUid)) {
    return localIds;
  }
  syncedFavoritesUids.add(cleanUid);
  try {
    const res = await fetch('/api/storage/favorites/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({ trackIds: localIds }),
    });
    if (!res.ok) {
      syncedFavoritesUids.delete(cleanUid);
      return localIds;
    }
    const data = await res.json().catch(() => null);
    if (data?.success && Array.isArray(data.likedIds)) {
      const merged = saveUserFavorites(cleanUid, data.likedIds);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(MY_FAVORITE_COUNTS_CHANGED_EVENT));
      }
      return merged;
    }
  } catch {
    syncedFavoritesUids.delete(cleanUid);
  }
  return localIds;
}

export async function fetchMyTracksFavoriteCounts(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/storage/my-tracks-favorites', {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return {};
    const data = await res.json().catch(() => null);
    if (data?.success && data.counts && typeof data.counts === 'object') {
      const sanitized: Record<string, number> = {};
      for (const [key, value] of Object.entries(data.counts)) {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) {
          sanitized[key] = Math.floor(n);
        }
      }
      return sanitized;
    }
  } catch {}
  return {};
}

export function toggleUserFavorite(
  uid: string | null | undefined,
  trackId: string
): { allowed: boolean; likedIds: string[] } {
  const cleanUid = normalizeUid(uid);
  if (!cleanUid) {
    return { allowed: false, likedIds: [] };
  }
  const current = getUserFavorites(cleanUid);
  const exists = current.includes(trackId);
  const next = exists ? current.filter((id) => id !== trackId) : [trackId, ...current];
  const saved = saveUserFavorites(cleanUid, next);
  void persistFavoriteToggleToCloud(trackId, !exists);
  return { allowed: true, likedIds: saved };
}
