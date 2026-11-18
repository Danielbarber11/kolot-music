const FAVORITES_KEY_PREFIX = 'kolot_favorites_uid_';
export const FAVORITES_CHANGED_EVENT = 'kolot_favorites_changed';

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
  return { allowed: true, likedIds: saved };
}
