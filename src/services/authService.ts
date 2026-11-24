import { ArtistProfile, JamendoTrack, TrackReport } from '../types';
import {
  uploadArtistProfileToCloud,
  fetchArtistProfileByUidFromCloud,
  fetchArtistProfilesFromCloud,
  syncArtistAvatarToTracksInR2,
} from './cloudStorageService';

export interface AuthUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  googleDisplayName?: string | null;
  photoURL?: string | null;
  googlePhotoUrl?: string | null;
  isAdmin?: boolean;
}

const SESSION_TOKEN_KEY = 'kolot_session_token';

let currentAuthUser: AuthUser | null = null;
let initialSessionResolved = false;
let initialSessionPromise: Promise<AuthUser | null> | null = null;
const authListeners = new Set<(user: AuthUser | null) => void>();

function readSessionToken(): string {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SESSION_TOKEN_KEY) || '' : '';
  } catch {
    return '';
  }
}

function writeSessionToken(token?: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (token && token.trim()) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token.trim());
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {}
}

export function getAuthHeaders(): Record<string, string> {
  const token = readSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function notifyAuthListeners(): void {
  authListeners.forEach((cb) => {
    try {
      cb(currentAuthUser);
    } catch {}
  });
}

function setCurrentUserInternal(user: AuthUser | null): AuthUser | null {
  currentAuthUser = user
    ? {
        uid: user.uid,
        email: user.email || undefined,
        displayName: user.displayName || undefined,
        googleDisplayName: user.googleDisplayName || user.displayName || undefined,
        photoURL: user.photoURL || undefined,
        googlePhotoUrl: user.googlePhotoUrl || undefined,
        isAdmin: !!user.isAdmin,
      }
    : null;
  notifyAuthListeners();
  return currentAuthUser;
}

export function getCurrentAuthUser(): AuthUser | null {
  return currentAuthUser;
}

export function updateCurrentAuthUserProfile(updates: {
  displayName?: string | null;
  photoURL?: string | null;
}): void {
  if (!currentAuthUser) return;
  currentAuthUser = {
    ...currentAuthUser,
    ...(updates.displayName !== undefined ? { displayName: updates.displayName || undefined } : {}),
    ...(updates.photoURL !== undefined ? { photoURL: updates.photoURL || undefined } : {}),
  };
  notifyAuthListeners();
}

export async function refreshCurrentAuthUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) {
      initialSessionResolved = true;
      return currentAuthUser;
    }
    const data = await res.json().catch(() => null);
    initialSessionResolved = true;
    if (data?.sessionToken) {
      writeSessionToken(data.sessionToken);
    }
    if (data?.user?.uid) {
      return setCurrentUserInternal(data.user);
    }
    if (currentAuthUser) {
      return setCurrentUserInternal(null);
    }
    return null;
  } catch {
    initialSessionResolved = true;
    return currentAuthUser;
  }
}

function ensureInitialSessionLoaded(): Promise<AuthUser | null> {
  if (initialSessionResolved) return Promise.resolve(currentAuthUser);
  if (!initialSessionPromise) {
    initialSessionPromise = refreshCurrentAuthUser().finally(() => {
      initialSessionPromise = null;
    });
  }
  return initialSessionPromise;
}

// Kick off session hydration immediately on load
void ensureInitialSessionLoaded();

export function onAuthUserChanged(callback: (user: AuthUser | null) => void): () => void {
  authListeners.add(callback);
  if (initialSessionResolved) {
    callback(currentAuthUser);
  } else {
    void ensureInitialSessionLoaded().then(() => {
      callback(currentAuthUser);
    });
  }
  return () => {
    authListeners.delete(callback);
  };
}

/**
 * Initiates Server-Side Google OAuth 2.0 via Cloudflare / Express environment credentials (Client_ID + Client_secret).
 * Never stores Client_secret or PII in the browser bundle.
 */
export function loginWithGoogle(): Promise<AuthUser | null> {
  const startUrl = `/api/auth/google/start?origin=${encodeURIComponent(window.location.origin)}`;
  const width = 520;
  const height = 650;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  // Open popup SYNCHRONOUSLY inside click handler before any await so Chrome/Safari/PWA never block it!
  const popup = window.open(
    startUrl,
    'kolot_google_oauth',
    `width=${width},height=${height},left=${left},top=${top},popup=yes`
  );

  if (!popup) {
    return Promise.reject(
      new Error('הדפדפן חסם את חלון ההתחברות הקופץ. אנא אשר חלונות קופצים בדפדפן ונסה שוב.')
    );
  }

  return new Promise<AuthUser | null>((resolve, reject) => {
    let settled = false;
    let pollTimer: number | null = null;
    let timeoutTimer: number | null = null;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
    };

    const handleMessage = (event: MessageEvent) => {
      if (settled) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'OAUTH_AUTH_SUCCESS' && data.user?.uid) {
        settled = true;
        cleanup();
        if (data.sessionToken) {
          writeSessionToken(data.sessionToken);
        }
        const authed = setCurrentUserInternal(data.user);
        try {
          if (!popup.closed) popup.close();
        } catch {}
        resolve(authed);
      } else if (data.type === 'OAUTH_AUTH_ERROR') {
        settled = true;
        cleanup();
        try {
          if (!popup.closed) popup.close();
        } catch {}
        reject(new Error(data.error || 'ההתחברות עם Google נכשלה'));
      }
    };

    window.addEventListener('message', handleMessage);

    pollTimer = window.setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        settled = true;
        cleanup();
        void refreshCurrentAuthUser()
          .then((u) => resolve(u))
          .catch(() => resolve(null));
      }
    }, 350);

    timeoutTimer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }, 180000);
  });
}

export async function logoutUser(): Promise<void> {
  writeSessionToken(null);
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
  } catch {}
  setCurrentUserInternal(null);
}

export async function deleteOwnAccountInCloud(): Promise<{ success: boolean; uid?: string; error?: string }> {
  try {
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `HTTP ${res.status}`,
      };
    }
    writeSessionToken(null);
    setCurrentUserInternal(null);
    return { success: true, uid: data.uid };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'שגיאת רשת במחיקת החשבון',
    };
  }
}

/**
 * Restores the user's authentic Google profile photo directly into Cloudflare R2 avatars/
 * and deletes any older avatar files for this artist.
 */
export async function restoreGoogleAvatarInCloud(
  options?: string | { name?: string; restoreName?: boolean }
): Promise<{
  success: boolean;
  avatarUrl?: string;
  displayName?: string;
  profile?: ArtistProfile;
  error?: string;
}> {
  const payload =
    typeof options === 'string'
      ? { name: options, restoreName: false }
      : {
          restoreName: options?.restoreName ?? true,
          ...(options?.name ? { name: options.name } : {}),
        };

  const res = await fetch('/api/auth/restore-google-avatar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    return {
      success: false,
      error: data?.error || 'שחזור השם והתמונה מחשבון Google נכשל',
    };
  }
  const restoredName = data.profile?.name || data.displayName;
  updateCurrentAuthUserProfile({
    ...(data.avatarUrl !== undefined ? { photoURL: data.avatarUrl } : {}),
    ...(restoredName ? { displayName: restoredName } : {}),
  });
  return {
    success: true,
    avatarUrl: data.avatarUrl,
    displayName: restoredName,
    profile: data.profile,
  };
}

/**
 * Upgrades Google avatar thumbnails (e.g. =s96-c) to crisp =s400-c when applicable.
 */
export function upgradeGooglePhotoQuality(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('googleusercontent.com')) {
    if (/=s\d+(-c)?$/.test(trimmed)) {
      return trimmed.replace(/=s\d+(-c)?$/, '=s400-c');
    }
    if (/=w\d+-h\d+/.test(trimmed)) {
      return trimmed.replace(/=w\d+-h\d+[^&]*/, '=s400-c');
    }
  }
  return trimmed;
}

export function getGoogleAccountPhotoUrl(user: AuthUser | null): string | undefined {
  if (!user) return undefined;
  if (user.googlePhotoUrl && user.googlePhotoUrl.trim()) {
    return upgradeGooglePhotoQuality(user.googlePhotoUrl);
  }
  if (user.photoURL && user.photoURL.trim()) {
    return upgradeGooglePhotoQuality(user.photoURL);
  }
  return undefined;
}

export function getEffectiveUserAvatar(
  user: AuthUser | null,
  profile?: ArtistProfile | null
): string | undefined {
  if (profile?.avatarUrl && profile.avatarUrl.trim()) {
    return upgradeGooglePhotoQuality(profile.avatarUrl);
  }
  if (user?.photoURL && user.photoURL.trim()) {
    return upgradeGooglePhotoQuality(user.photoURL);
  }
  return getGoogleAccountPhotoUrl(user);
}

export function getEffectiveArtistAvatarForTrack(
  track: JamendoTrack,
  artists: ArtistProfile[] = []
): string | undefined {
  const uid = (track.uploadedByUid || '').replace(/^artist_/, '').trim();
  const normName = (track.artistName || '').toLowerCase().trim();

  const matchedArtist =
    (uid
      ? artists.find(
          (a) =>
            a.id === uid ||
            a.id === `artist_${uid}` ||
            a.googleUid === uid ||
            a.id.replace(/^artist_/, '') === uid
        )
      : undefined) ||
    (normName ? artists.find((a) => (a.name || '').toLowerCase().trim() === normName) : undefined);

  if (matchedArtist?.avatarUrl && matchedArtist.avatarUrl.trim()) {
    return upgradeGooglePhotoQuality(matchedArtist.avatarUrl);
  }
  if (track.artistAvatarUrl && track.artistAvatarUrl.trim()) {
    return upgradeGooglePhotoQuality(track.artistAvatarUrl);
  }
  return undefined;
}

// -------------------------------------------------------------
// ARTIST ACCOUNTS & R2 HELPERS
// -------------------------------------------------------------

export async function getArtistAccountByGoogleUid(googleUid: string): Promise<ArtistProfile | null> {
  if (!googleUid) return null;
  return fetchArtistProfileByUidFromCloud(googleUid);
}

export async function getArtistAccountsFromCloud(): Promise<ArtistProfile[]> {
  return fetchArtistProfilesFromCloud();
}

export async function saveArtistAccountInCloud(artist: ArtistProfile): Promise<boolean> {
  const res = await uploadArtistProfileToCloud(artist);
  return res.success;
}

export async function syncArtistAvatarToTracks(
  artistUid: string,
  _artistEmail: string | undefined,
  avatarUrl: string | undefined,
  tracks: JamendoTrack[],
  artistNameHint?: string
): Promise<JamendoTrack[]> {
  return syncArtistAvatarToTracksInR2(artistUid, avatarUrl, tracks, artistNameHint);
}

// -------------------------------------------------------------
// TRACK REPORTS OPERATIONS (100% Cloudflare R2)
// -------------------------------------------------------------

export async function saveTrackReportToR2(report: TrackReport): Promise<boolean> {
  try {
    const res = await fetch('/api/storage/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify(report),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getTrackReportsFromR2(): Promise<TrackReport[]> {
  try {
    const res = await fetch('/api/storage/reports', {
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.reports) ? data.reports : [];
  } catch {
    return [];
  }
}

export async function dismissTrackReportInR2(reportId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/storage/reports/${encodeURIComponent(reportId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteArtistAccountInAdmin(uid: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/admin/delete-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({ uid }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'שגיאת רשת במחיקת החשבון' };
  }
}

export interface ContactMessageRecord {
  id: string;
  to: string;
  category?: string;
  categoryLabel?: string;
  senderEmail: string;
  senderName?: string;
  senderAvatarUrl?: string;
  isSignedIn?: boolean;
  reporterEmail?: string;
  uploaderEmail?: string;
  trackId?: string;
  trackName?: string;
  artistName?: string;
  legalDocumentKey?: string;
  legalDocumentName?: string;
  subject: string;
  message: string;
  createdAt: string;
  status?: string;
}

export async function getContactMessagesInAdmin(): Promise<ContactMessageRecord[]> {
  try {
    const res = await fetch('/api/admin/contact-messages', {
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.messages) ? data.messages : [];
  } catch {
    return [];
  }
}

export async function dismissContactMessageInAdmin(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/admin/contact-messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

