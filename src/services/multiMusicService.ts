import { JamendoTrack, Album } from '../types';
import { 
  getArtistTracksFromFirebase, 
  deleteArtistTrackFromFirebase, 
  getArtistAccountsFromFirebase, 
  saveArtistAccountToFirebase 
} from './firebaseService';
import { 
  loadTracksFromIndexedDB, 
  getCachedAudioBlob,
  removeTrackFromStorage,
} from './localTrackStorage';
import { 
  fetchTracksFromCloud, 
  computeTrackBgColor,
  uploadTrackToCloud,
  urlToBlob,
  fetchArtistProfilesFromCloud,
  fetchAlbumsFromCloud
} from './cloudStorageService';
import { getDeletedSongIds } from './deletedTracksService';

/**
 * Cloud-Backed Music Service (Cloudflare R2)
 * Tracks are loaded dynamically from R2 / Firebase.
 */
export const VERIFIED_REAL_TRACKS: JamendoTrack[] = [];

export const ALL_MUSIC_GENRES = [
  'Pop',
  'Rock',
  'Electronic',
  'Chill',
  'Acoustic',
  'Classical',
  'Jazz',
  'Blues',
  'Cinematic',
];

const CLOUD_TRACKS_CACHE_KEY = 'kolot_cloud_tracks_cache';

/**
 * Strict validator: Every track MUST have an authentic user ID (uploadedByUid or uploadedByEmail).
 */
export function isValidTrackWithOwner(track: JamendoTrack | null | undefined): boolean {
  if (!track || !track.id || !track.name) return false;
  const hasUserUid = typeof track.uploadedByUid === 'string' && track.uploadedByUid.trim().length > 0;
  const hasUserEmail = typeof track.uploadedByEmail === 'string' && track.uploadedByEmail.trim().length > 0;
  return hasUserUid || hasUserEmail;
}

export function getCachedCloudTracks(): JamendoTrack[] {
  try {
    const saved = localStorage.getItem(CLOUD_TRACKS_CACHE_KEY);
    if (saved) {
      const parsed: JamendoTrack[] = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const deletedSet = getDeletedSongIds();
        return parsed.filter((t) => {
          if (!isValidTrackWithOwner(t)) return false;
          const normArtist = (t.artistName || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const normName = (t.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
          return !deletedSet.has(t.id) && !deletedSet.has(`del_${normArtist}::${normName}`);
        });
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached cloud tracks:', e);
  }
  return [];
}

export function saveCachedCloudTracks(tracks: JamendoTrack[]): void {
  try {
    if (Array.isArray(tracks)) {
      const validOnly = tracks.filter(isValidTrackWithOwner);
      localStorage.setItem(CLOUD_TRACKS_CACHE_KEY, JSON.stringify(validOnly));
    }
  } catch (e) {
    console.warn('Failed to save cloud tracks cache:', e);
  }
}

/**
 * Startup sanitation: Purges any legacy unassigned tracks from local client storage immediately
 */
export function purgeOrphanedTracksFromLocalStorage(): void {
  try {
    const keys = [CLOUD_TRACKS_CACHE_KEY, 'kolot_uploaded_tracks'];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isValidTrackWithOwner);
          if (valid.length !== parsed.length) {
            localStorage.setItem(key, JSON.stringify(valid));
          }
        }
      }
    }
  } catch {}
}

purgeOrphanedTracksFromLocalStorage();

/**
 * Helper to extract numeric timestamp from track for strict newest-to-oldest sorting
 */
export function getTrackTimestamp(t: JamendoTrack): number {
  if (t.id && t.id.startsWith('artist_track_')) {
    const ts = parseInt(t.id.replace('artist_track_', ''), 10);
    if (!isNaN(ts)) return ts;
  }
  if (t.publishedDate) {
    const parsedDate = Date.parse(t.publishedDate);
    if (!isNaN(parsedDate)) return parsedDate;
    const year = parseInt(t.publishedDate, 10);
    if (!isNaN(year) && year > 1900 && year < 2100) return new Date(year, 0, 1).getTime();
  }
  return 0;
}

export function sortTracksChronologically(tracks: JamendoTrack[]): JamendoTrack[] {
  return [...tracks].sort((a, b) => getTrackTimestamp(b) - getTrackTimestamp(a));
}

/**
 * Intelligent helper to score cover art quality
 */
function getCoverQualityScore(url?: string): number {
  if (!url || typeof url !== 'string') return 0;
  const trimmed = url.trim();
  if (!trimmed) return 0;
  if (trimmed.startsWith('data:image/')) return 3;
  if (trimmed.includes('r2.cloudflarestorage.com') || trimmed.includes('firestore')) return 4;
  if (trimmed.startsWith('blob:')) return 2;
  return 2;
}

/**
 * Deduplicates tracks by ID and normalized Artist + Title
 */
export function deduplicateTracks(tracks: JamendoTrack[]): JamendoTrack[] {
  const deletedSet = getDeletedSongIds();
  const trackMap = new Map<string, JamendoTrack>();
  const idToCanonicalKey = new Map<string, string>();
  const titleArtistToCanonicalKey = new Map<string, string>();

  const normalize = (str?: string) => (str || '').trim().toLowerCase().replace(/\s+/g, ' ');

  for (const t of tracks) {
    const normArtist = normalize(t.artistName || 'אמן לא ידוע');
    const normName = normalize(t.name);
    const titleArtistKey = `${normArtist}::${normName}`;

    if (t.id && deletedSet.has(t.id)) continue;
    if (!t.audioUrl || typeof t.audioUrl !== 'string' || !t.audioUrl.trim()) continue;

    const rawIdKey = t.id ? t.id.trim() : titleArtistKey;
    const canonicalKey = idToCanonicalKey.get(rawIdKey) || titleArtistToCanonicalKey.get(titleArtistKey);

    if (!canonicalKey) {
      const key = rawIdKey;
      trackMap.set(key, { ...t });
      idToCanonicalKey.set(rawIdKey, key);
      titleArtistToCanonicalKey.set(titleArtistKey, key);
    } else {
      const existing = trackMap.get(canonicalKey)!;
      const existingCoverScore = getCoverQualityScore(existing.coverUrl);
      const newCoverScore = getCoverQualityScore(t.coverUrl);
      const bestCover = newCoverScore > existingCoverScore ? t.coverUrl : existing.coverUrl;

      const merged: JamendoTrack = {
        ...existing,
        ...t,
        id: existing.id || t.id,
        artistName: (existing.artistName && existing.artistName !== 'אמן לא ידוע') ? existing.artistName : (t.artistName || 'אמן לא ידוע'),
        coverUrl: bestCover || '',
        bgColor: existing.bgColor || t.bgColor || computeTrackBgColor(existing),
        playsCount: Math.max(existing.playsCount || 0, t.playsCount || 0),
      };
      trackMap.set(canonicalKey, merged);
    }
  }

  return sortTracksChronologically(Array.from(trackMap.values()));
}

export function getSavedRepoTracks(): JamendoTrack[] {
  try {
    const savedLocal = localStorage.getItem('kolot_uploaded_tracks');
    if (savedLocal) {
      const parsed: JamendoTrack[] = JSON.parse(savedLocal);
      if (Array.isArray(parsed)) {
        const deletedSet = getDeletedSongIds();
        return parsed.filter((t) => {
          if (!t || !t.id || !t.name) return false;
          return !deletedSet.has(t.id);
        });
      }
    }
  } catch {}
  return [];
}

export async function resumePendingUploads(): Promise<void> {
  try {
    const pendingJson = localStorage.getItem('kolot_pending_uploads');
    if (!pendingJson) return;
    
    const pendingIds: string[] = JSON.parse(pendingJson);
    if (!Array.isArray(pendingIds) || pendingIds.length === 0) return;

    const allCached = await loadTracksFromIndexedDB();
    
    for (const id of pendingIds) {
      const track = allCached.find(t => t.id === id);
      if (!track) continue;

      const audioBlob = await getCachedAudioBlob(id);
      const coverBlob = (track.coverUrl && track.coverUrl.startsWith('data:')) ? await urlToBlob(track.coverUrl) : null;
      
      const res = await uploadTrackToCloud(track, audioBlob || undefined, coverBlob || undefined);
      if (res.success) {
        const currentPending = JSON.parse(localStorage.getItem('kolot_pending_uploads') || '[]');
        const updated = currentPending.filter((pid: string) => pid !== id);
        localStorage.setItem('kolot_pending_uploads', JSON.stringify(updated));
      }
    }
  } catch {}
}

export async function getInstantSongPoolAsync(): Promise<JamendoTrack[]> {
  const deletedIds = getDeletedSongIds();
  const cachedCloud = getCachedCloudTracks().filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const indexedDBTracks = (await loadTracksFromIndexedDB()).filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const verified = VERIFIED_REAL_TRACKS.filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const combined = [...cachedCloud, ...indexedDBTracks, ...verified];
  return deduplicateTracks(combined).filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
}

export function getInstantSongPool(): JamendoTrack[] {
  const deletedIds = getDeletedSongIds();
  const cachedCloud = getCachedCloudTracks().filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const verified = VERIFIED_REAL_TRACKS.filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const combined = [...cachedCloud, ...verified];
  return deduplicateTracks(combined).filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
}

const CLOUD_PROFILES_CACHE_KEY = 'kolot_cloud_profiles_cache';

export async function fetchAllArtistProfiles(): Promise<any[]> {
  try {
    const fbAccounts = await getArtistAccountsFromFirebase();
    const cloudAccounts = await fetchArtistProfilesFromCloud();
    
    const combined = [...fbAccounts];
    cloudAccounts.forEach(ca => {
      if (!combined.some(a => a.id === ca.id)) {
        combined.push(ca);
      }
    });

    if (combined.length > 0) {
      localStorage.setItem(CLOUD_PROFILES_CACHE_KEY, JSON.stringify(combined));
      return combined;
    }
  } catch {}
  
  try {
    const cached = localStorage.getItem(CLOUD_PROFILES_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}
  
  return [];
}

export async function checkTermsAcceptedInFirestore(uid: string): Promise<boolean> {
  try {
    const fbAccounts = await getArtistAccountsFromFirebase();
    const account = fbAccounts.find(a => a.id === uid || a.googleUid === uid);
    return !!account?.hasAcceptedTerms;
  } catch {
    return false;
  }
}

export async function saveTermsAcceptedToFirestore(uid: string, name: string): Promise<void> {
  try {
    await saveArtistAccountToFirebase({
      id: uid,
      name: name,
      isConnected: true,
      hasAcceptedTerms: true,
      acceptedTermsAt: new Date().toISOString(),
      isPrivate: true,
      tracksCount: 0,
      joinedDate: new Date().getFullYear().toString(),
      providerPlatform: 'Google Auth',
    } as any);
  } catch (err) {
    console.warn('Failed to save terms acceptance to Firestore:', err);
  }
}

/**
 * Fetches all saved tracks from Cloud Storage primarily.
 */
export async function fetchAllRealSongs(
  onProgress?: (count: number) => void,
  onBatch?: (tracks: JamendoTrack[]) => void
): Promise<JamendoTrack[]> {
  resumePendingUploads().catch(() => {});

  let cloudTracks: JamendoTrack[] = [];
  try {
    cloudTracks = await fetchTracksFromCloud();
  } catch {}

  const validCloudTracks = cloudTracks.filter(isValidTrackWithOwner);

  try {
    const activeCloudIds = new Set(validCloudTracks.map((t) => t.id));
    const indexedDBTracks = await loadTracksFromIndexedDB();
    for (const t of indexedDBTracks) {
      if (!activeCloudIds.has(t.id)) {
        await removeTrackFromStorage(t.id);
      }
    }
    saveCachedCloudTracks(validCloudTracks);
  } catch {}

  const deletedIds = getDeletedSongIds();
  const verified = VERIFIED_REAL_TRACKS.filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  const combined = deduplicateTracks([...validCloudTracks, ...verified]).filter((t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id));
  if (onProgress) onProgress(combined.length);
  if (onBatch) onBatch(combined);

  return combined;
}

export async function fetchLiveAudioFromArchive(_genreQuery?: string, _page?: number): Promise<JamendoTrack[]> {
  return [];
}

export async function searchModern21stCenturyTracks(_query?: string, _limit?: number): Promise<JamendoTrack[]> {
  return [];
}

export async function fetchModernTrendingHits(): Promise<JamendoTrack[]> {
  return [];
}

export function getTotalSongCount(): number {
  return getInstantSongPool().length;
}

let initPromise: Promise<any> | null = null;
export function initializeMultiMusicService(): Promise<any> {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    const songsPromise = fetchAllRealSongs();
    const profilesPromise = fetchAllArtistProfiles();
    const albumsPromise = fetchRealAlbums();
    return Promise.allSettled([songsPromise, profilesPromise, albumsPromise]);
  })();
  
  return initPromise;
}

const USER_ALBUMS_CACHE_KEY = 'kolot_user_albums';

export function getCachedAlbums(): Album[] {
  try {
    const raw = localStorage.getItem(USER_ALBUMS_CACHE_KEY);
    if (raw) {
      const parsed: Album[] = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveCachedAlbums(albums: Album[]): void {
  try {
    localStorage.setItem(USER_ALBUMS_CACHE_KEY, JSON.stringify(albums));
  } catch {}
}

export async function fetchRealAlbums(): Promise<Album[]> {
  try {
    const cloudAlbums = await fetchAlbumsFromCloud();
    const cached = getCachedAlbums();
    const combined = [...cloudAlbums];
    cached.forEach(a => {
      if (!combined.some(ca => ca.id === a.id)) {
        combined.push(a);
      }
    });
    saveCachedAlbums(combined);
    return combined;
  } catch {
    return getCachedAlbums();
  }
}
