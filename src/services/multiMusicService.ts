import { JamendoTrack, Album } from '../types';
import {
  getArtistTracksFromFirebase,
  getArtistAccountsFromFirebase,
  saveArtistAccountToFirebase,
} from './firebaseService';
import { clearAllLocalDeviceStorage } from './localTrackStorage';
import {
  fetchTracksFromCloud,
  computeTrackBgColor,
  fetchArtistProfilesFromCloud,
  fetchAlbumsFromCloud,
} from './cloudStorageService';
import { getDeletedSongIds } from './deletedTracksService';

/**
 * 100% Cloud-Native Music Service (Cloudflare R2 + Firebase Firestore)
 * Zero local storage persistence for tracks, albums, or profiles.
 */
export const VERIFIED_REAL_TRACKS: JamendoTrack[] = [];

export const ALL_MUSIC_GENRES = [
  'Mizrahi',
  'Pop',
  'Hip Hop',
  'Rock',
  'Electronic',
  'Chill',
  'Acoustic',
  'Classical',
  'Jazz',
  'Blues',
  'Cinematic',
];

// Session-only in-memory state (never persisted to localStorage or IndexedDB)
let memorySessionTracks: JamendoTrack[] = [];
let memorySessionProfiles: any[] = [];
let memorySessionAlbums: Album[] = [];

/**
 * Strict validator: Every track MUST have an authentic ID, Name, and non-local Audio URL.
 */
export function isValidTrackWithOwner(track: JamendoTrack | null | undefined): boolean {
  if (!track || !track.id || typeof track.id !== 'string') return false;
  if (!track.name || typeof track.name !== 'string' || !track.name.trim()) return false;
  if (!track.audioUrl || typeof track.audioUrl !== 'string' || !track.audioUrl.trim()) return false;
  if (track.audioUrl.startsWith('blob:') || track.audioUrl.startsWith('/uploads/')) return false;
  return true;
}

export function getCachedCloudTracks(): JamendoTrack[] {
  const deletedSet = getDeletedSongIds();
  return memorySessionTracks.filter((t) => {
    if (!isValidTrackWithOwner(t)) return false;
    const normArtist = (t.artistName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const normName = (t.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return !deletedSet.has(t.id) && !deletedSet.has(`del_${normArtist}::${normName}`);
  });
}

export function saveCachedCloudTracks(tracks: JamendoTrack[]): void {
  if (Array.isArray(tracks)) {
    memorySessionTracks = tracks.filter(isValidTrackWithOwner);
  }
}

/**
 * Startup sanitation: Clears legacy localStorage / IndexedDB track caches so the app uses 100% live cloud data.
 */
export function purgeOrphanedTracksFromLocalStorage(): void {
  clearAllLocalDeviceStorage().catch(() => {});
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

function getCoverQualityScore(url?: string): number {
  if (!url || typeof url !== 'string') return 0;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('/uploads/')) return 0;
  if (trimmed.includes('/api/storage/raw/') || trimmed.includes('r2.cloudflarestorage.com')) return 5;
  if (trimmed.startsWith('https://')) return 4;
  if (trimmed.startsWith('data:image/')) return 2;
  return 1;
}

function getAudioQualityScore(url?: string): number {
  if (!url || typeof url !== 'string') return 0;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('/uploads/')) return 0;
  if (trimmed.includes('/api/storage/raw/') || trimmed.includes('r2.cloudflarestorage.com')) return 5;
  if (trimmed.startsWith('https://')) return 4;
  return 1;
}

/**
 * Deduplicates tracks by ID and normalized Artist + Title, preferring Cloudflare R2 URLs.
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
    if (!isValidTrackWithOwner(t)) continue;

    const rawIdKey = t.id ? t.id.trim() : titleArtistKey;
    const canonicalKey = idToCanonicalKey.get(rawIdKey) || titleArtistToCanonicalKey.get(titleArtistKey);

    if (!canonicalKey) {
      const key = rawIdKey;
      trackMap.set(key, { ...t });
      idToCanonicalKey.set(rawIdKey, key);
      titleArtistToCanonicalKey.set(titleArtistKey, key);
    } else {
      const existing = trackMap.get(canonicalKey)!;
      const bestCover =
        getCoverQualityScore(t.coverUrl) > getCoverQualityScore(existing.coverUrl)
          ? t.coverUrl
          : existing.coverUrl;
      const bestAudio =
        getAudioQualityScore(t.audioUrl) > getAudioQualityScore(existing.audioUrl)
          ? t.audioUrl
          : existing.audioUrl;

      const merged: JamendoTrack = {
        ...existing,
        ...t,
        id: existing.id || t.id,
        artistName:
          existing.artistName && existing.artistName !== 'אמן לא ידוע'
            ? existing.artistName
            : t.artistName || 'אמן לא ידוע',
        audioUrl: bestAudio,
        coverUrl: bestCover || '',
        bgColor: existing.bgColor || t.bgColor || computeTrackBgColor(existing),
        artistAvatarUrl: existing.artistAvatarUrl || t.artistAvatarUrl,
        uploadedByUid: existing.uploadedByUid || t.uploadedByUid,
        uploadedByEmail: existing.uploadedByEmail || t.uploadedByEmail,
        subtitleSegments: existing.subtitleSegments?.length ? existing.subtitleSegments : t.subtitleSegments,
        subtitleSegmentsHe: existing.subtitleSegmentsHe?.length ? existing.subtitleSegmentsHe : t.subtitleSegmentsHe,
        subtitleSegmentsEn: existing.subtitleSegmentsEn?.length ? existing.subtitleSegmentsEn : t.subtitleSegmentsEn,
        lyrics: existing.lyrics || t.lyrics,
        lyricsHe: existing.lyricsHe || t.lyricsHe,
        lyricsEn: existing.lyricsEn || t.lyricsEn,
        hasWhisperSubtitles: !!(existing.hasWhisperSubtitles || t.hasWhisperSubtitles),
        playsCount: Math.max(existing.playsCount || 0, t.playsCount || 0),
      };
      trackMap.set(canonicalKey, merged);
    }
  }

  return sortTracksChronologically(Array.from(trackMap.values()));
}

export function getSavedRepoTracks(): JamendoTrack[] {
  return getCachedCloudTracks();
}

export async function resumePendingUploads(): Promise<void> {
  // No local pending queue — uploads commit directly to Cloudflare R2
}

export async function getInstantSongPoolAsync(): Promise<JamendoTrack[]> {
  return getInstantSongPool();
}

export function getInstantSongPool(): JamendoTrack[] {
  const deletedIds = getDeletedSongIds();
  return deduplicateTracks(memorySessionTracks).filter(
    (t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id)
  );
}

export function getCachedArtistProfiles(): any[] {
  return memorySessionProfiles;
}

export async function fetchAllArtistProfiles(): Promise<any[]> {
  try {
    const [fbAccounts, cloudAccounts] = await Promise.all([
      getArtistAccountsFromFirebase().catch(() => []),
      fetchArtistProfilesFromCloud().catch(() => []),
    ]);

    const profileMap = new Map<string, any>();
    fbAccounts.forEach((a) => {
      const key = (a.googleUid || a.id || '').replace(/^artist_/, '');
      if (key) profileMap.set(key, a);
    });
    cloudAccounts.forEach((ca) => {
      const key = (ca?.googleUid || ca?.id || '').replace(/^artist_/, '');
      if (!key) return;
      const existing = profileMap.get(key);
      profileMap.set(key, existing ? { ...existing, ...ca, bio: ca.bio || existing.bio, avatarUrl: ca.avatarUrl || existing.avatarUrl } : ca);
    });

    const combined = Array.from(profileMap.values());
    memorySessionProfiles = combined;
    return combined;
  } catch {
    return memorySessionProfiles;
  }
}

export async function checkTermsAcceptedInFirestore(uid: string): Promise<boolean> {
  try {
    const fbAccounts = await getArtistAccountsFromFirebase();
    const account = fbAccounts.find((a) => a.id === uid || a.googleUid === uid);
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

let inFlightSongsPromise: Promise<JamendoTrack[]> | null = null;
const batchListeners = new Set<(tracks: JamendoTrack[]) => void>();

/**
 * Fetches all saved tracks live from Cloudflare R2 & Firebase Firestore (100% Cloud-Native)
 * and streams the fastest source immediately (< 1s) without blocking on the slower one.
 */
export async function fetchAllRealSongs(
  onProgress?: (count: number) => void,
  onBatch?: (tracks: JamendoTrack[]) => void
): Promise<JamendoTrack[]> {
  if (onBatch) batchListeners.add(onBatch);

  if (inFlightSongsPromise) {
    const result = await inFlightSongsPromise;
    if (onBatch) batchListeners.delete(onBatch);
    if (onProgress) onProgress(result.length);
    return result;
  }

  let latestMerged: JamendoTrack[] = [...memorySessionTracks];
  const mergeAndEmit = (incoming: JamendoTrack[]) => {
    if (!incoming || incoming.length === 0) return;
    const deletedIds = getDeletedSongIds();
    latestMerged = deduplicateTracks([...latestMerged, ...incoming]).filter(
      (t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id)
    );
    saveCachedCloudTracks(latestMerged);
    if (onProgress) onProgress(latestMerged.length);
    batchListeners.forEach((cb) => {
      try {
        cb(latestMerged);
      } catch {}
    });
  };

  inFlightSongsPromise = (async () => {
    try {
      await Promise.allSettled([
        getArtistTracksFromFirebase().then((fb) => {
          mergeAndEmit(fb);
          return fb;
        }),
        fetchTracksFromCloud().then((r2) => {
          mergeAndEmit(r2);
          return r2;
        }),
      ]);
      if (onProgress) onProgress(latestMerged.length);
      return latestMerged;
    } finally {
      inFlightSongsPromise = null;
      if (onBatch) batchListeners.delete(onBatch);
    }
  })();

  return inFlightSongsPromise;
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

  initPromise = Promise.allSettled([
    fetchAllRealSongs(),
    fetchAllArtistProfiles(),
    fetchRealAlbums(),
  ]);

  return initPromise;
}

export function getCachedAlbums(): Album[] {
  return memorySessionAlbums;
}

export function saveCachedAlbums(albums: Album[]): void {
  if (Array.isArray(albums)) {
    memorySessionAlbums = albums;
  }
}

export async function fetchRealAlbums(): Promise<Album[]> {
  try {
    const cloudAlbums = await fetchAlbumsFromCloud();
    saveCachedAlbums(cloudAlbums);
    return cloudAlbums;
  } catch {
    return memorySessionAlbums;
  }
}
