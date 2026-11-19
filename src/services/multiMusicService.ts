import { JamendoTrack, Album, ArtistProfile, CURRENT_TERMS_VERSION } from '../types';
import { clearAllLocalDeviceStorage } from './localTrackStorage';
import {
  fetchTracksFromCloud,
  fetchBootstrapFromCloud,
  computeTrackBgColor,
  fetchArtistProfilesFromCloud,
  fetchArtistProfileByUidFromCloud,
  uploadArtistProfileToCloud,
  fetchAlbumsFromCloud,
} from './cloudStorageService';
import { getDeletedSongIds } from './deletedTracksService';

/**
 * 100% Cloud-Native Music Service (Cloudflare R2 Profiles & Storage)
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
let memorySessionProfiles: ArtistProfile[] = [];
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

export function updateMemoryTrack(updatedTrack: JamendoTrack): void {
  if (!isValidTrackWithOwner(updatedTrack)) return;
  const exists = memorySessionTracks.some((t) => t.id === updatedTrack.id);
  memorySessionTracks = exists
    ? memorySessionTracks.map((t) => (t.id === updatedTrack.id ? updatedTrack : t))
    : [updatedTrack, ...memorySessionTracks];
}

export function updateMemoryTracksArtistAvatar(
  artistUid: string,
  avatarUrl: string | undefined,
  artistNameHint?: string
): void {
  const cleanUid = (artistUid || '').replace(/^artist_/, '').toLowerCase().trim();
  const cleanName = (artistNameHint || '').toLowerCase().trim();
  memorySessionTracks = memorySessionTracks.map((t) => {
    const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    const tName = (t.artistName || '').toLowerCase().trim();
    const matches = (cleanUid && tUid === cleanUid) || (!tUid && cleanName && tName === cleanName);
    if (!matches) return t;
    return {
      ...t,
      artistAvatarUrl: avatarUrl || '',
      ...(artistNameHint ? { artistName: artistNameHint } : {}),
    };
  });
}

export function upsertMemoryArtistProfile(artist: ArtistProfile): void {
  if (!artist) return;
  const cleanKey = (artist.googleUid || artist.id || '').replace(/^artist_/, '').toLowerCase().trim();
  if (!cleanKey) return;
  const normalized: ArtistProfile = {
    ...artist,
    id: artist.googleUid || artist.id || cleanKey,
    googleUid: artist.googleUid || artist.id || cleanKey,
  };
  const idx = memorySessionProfiles.findIndex((p) => {
    const pKey = (p.googleUid || p.id || '').replace(/^artist_/, '').toLowerCase().trim();
    return pKey === cleanKey;
  });
  if (idx >= 0) {
    memorySessionProfiles = memorySessionProfiles.map((p, i) => (i === idx ? { ...p, ...normalized } : p));
  } else {
    memorySessionProfiles = [normalized, ...memorySessionProfiles];
  }
}

export function removeMemoryArtistProfile(uid: string): void {
  const cleanKey = (uid || '').replace(/^artist_/, '').toLowerCase().trim();
  if (!cleanKey) return;
  memorySessionProfiles = memorySessionProfiles.filter((p) => {
    const pKey = (p.googleUid || p.id || '').replace(/^artist_/, '').toLowerCase().trim();
    return pKey !== cleanKey;
  });
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
        subtitleSegmentsOrig: existing.subtitleSegmentsOrig?.length ? existing.subtitleSegmentsOrig : t.subtitleSegmentsOrig,
        lyrics: existing.lyrics || t.lyrics,
        lyricsHe: existing.lyricsHe || t.lyricsHe,
        lyricsEn: existing.lyricsEn || t.lyricsEn,
        lyricsOrig: existing.lyricsOrig || t.lyricsOrig,
        detectedLanguageCode: existing.detectedLanguageCode || t.detectedLanguageCode,
        detectedLanguageLabel: existing.detectedLanguageLabel || t.detectedLanguageLabel,
        hasWhisperSubtitles: !!(existing.hasWhisperSubtitles || t.hasWhisperSubtitles),
        playsCount: Math.max(existing.playsCount || 0, t.playsCount || 0),
        viewsCount: Math.max(existing.viewsCount || 0, t.viewsCount || 0),
      };
      trackMap.set(canonicalKey, merged);
    }
  }

  return sortTracksChronologically(Array.from(trackMap.values()));
}

export function incrementTrackViewInMemory(trackId: string): number {
  let nextViews = 1;
  memorySessionTracks = memorySessionTracks.map((t) => {
    if (t.id === trackId) {
      nextViews = (Number(t.viewsCount) || 0) + 1;
      return { ...t, viewsCount: nextViews };
    }
    return t;
  });
  return nextViews;
}

export function syncTrackViewFromServer(trackId: string, serverViewsCount: number): void {
  if (!trackId || !Number.isFinite(serverViewsCount) || serverViewsCount <= 0) return;
  memorySessionTracks = memorySessionTracks.map((t) =>
    t.id === trackId
      ? { ...t, viewsCount: Math.max(Number(t.viewsCount) || 0, serverViewsCount) }
      : t
  );
  try {
    const cached = getCachedCloudTracks();
    if (cached.some((t) => t.id === trackId)) {
      const updated = cached.map((t) =>
        t.id === trackId
          ? { ...t, viewsCount: Math.max(Number(t.viewsCount) || 0, serverViewsCount) }
          : t
      );
      saveCachedCloudTracks(updated);
    }
  } catch {}
}

export function syncTrackSubtitlesInMemory(updatedTrack: JamendoTrack): void {
  if (!updatedTrack?.id) return;
  const applySubs = (t: JamendoTrack): JamendoTrack => ({
    ...t,
    subtitleSegments: updatedTrack.subtitleSegments ?? t.subtitleSegments,
    subtitleSegmentsHe: updatedTrack.subtitleSegmentsHe ?? t.subtitleSegmentsHe,
    subtitleSegmentsEn: updatedTrack.subtitleSegmentsEn ?? t.subtitleSegmentsEn,
    subtitleSegmentsOrig: updatedTrack.subtitleSegmentsOrig ?? t.subtitleSegmentsOrig,
    lyrics: updatedTrack.lyrics ?? t.lyrics,
    lyricsHe: updatedTrack.lyricsHe ?? t.lyricsHe,
    lyricsEn: updatedTrack.lyricsEn ?? t.lyricsEn,
    lyricsOrig: updatedTrack.lyricsOrig ?? t.lyricsOrig,
    detectedLanguageCode: updatedTrack.detectedLanguageCode ?? t.detectedLanguageCode,
    detectedLanguageLabel: updatedTrack.detectedLanguageLabel ?? t.detectedLanguageLabel,
    hasWhisperSubtitles: !!(
      updatedTrack.subtitleSegments?.length ||
      updatedTrack.subtitleSegmentsHe?.length ||
      updatedTrack.subtitleSegmentsEn?.length ||
      updatedTrack.subtitleSegmentsOrig?.length
    ),
  });
  memorySessionTracks = memorySessionTracks.map((t) => (t.id === updatedTrack.id ? applySubs(t) : t));
  try {
    const cached = getCachedCloudTracks();
    if (cached.some((t) => t.id === updatedTrack.id)) {
      saveCachedCloudTracks(cached.map((t) => (t.id === updatedTrack.id ? applySubs(t) : t)));
    }
  } catch {}
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

export function getCachedArtistProfiles(): ArtistProfile[] {
  return memorySessionProfiles;
}

export async function fetchAllArtistProfiles(): Promise<ArtistProfile[]> {
  try {
    const cloudAccounts = await fetchArtistProfilesFromCloud().catch(() => []);
    const profileMap = new Map<string, ArtistProfile>();
    cloudAccounts.forEach((ca: any) => {
      const key = String(ca?.googleUid || ca?.id || '').replace(/^artist_/, '').trim();
      if (!key) return;
      profileMap.set(key, {
        ...ca,
        id: key,
        googleUid: key,
      });
    });

    const combined = Array.from(profileMap.values());
    memorySessionProfiles = combined;
    return combined;
  } catch {
    return memorySessionProfiles;
  }
}

export async function getArtistAccountByUid(uid: string): Promise<ArtistProfile | null> {
  const cleanUid = String(uid || '').replace(/^artist_/, '').trim();
  if (!cleanUid) return null;
  const profile = await fetchArtistProfileByUidFromCloud(cleanUid).catch(() => null);
  if (profile) {
    upsertMemoryArtistProfile(profile);
    return profile;
  }
  return (
    memorySessionProfiles.find(
      (p) => (p.googleUid || p.id || '').replace(/^artist_/, '').trim() === cleanUid
    ) || null
  );
}

export async function saveArtistAccountToR2(
  artist: ArtistProfile,
  avatarFile?: File | Blob,
  options?: { purgeOldAvatars?: boolean }
): Promise<{ success: boolean; profile?: ArtistProfile; error?: string }> {
  const res = await uploadArtistProfileToCloud(artist, avatarFile, options);
  if (res.success && res.profile) {
    upsertMemoryArtistProfile(res.profile);
    return { success: true, profile: res.profile };
  }
  return { success: false, error: res.error };
}

export async function checkTermsAcceptedInR2(uid: string): Promise<boolean> {
  if (!uid) return false;
  try {
    const account = await getArtistAccountByUid(uid);
    if (!account) return false;
    const acceptedVersion =
      typeof account.termsVersionAccepted === 'number'
        ? account.termsVersionAccepted
        : account.hasAcceptedTerms
          ? 1
          : 0;
    return !!account.hasAcceptedTerms && acceptedVersion >= CURRENT_TERMS_VERSION;
  } catch {
    return false;
  }
}

export async function saveTermsAcceptedToR2(uid: string, name: string, avatarUrl?: string): Promise<ArtistProfile | null> {
  if (!uid) return null;
  try {
    const existing = await getArtistAccountByUid(uid).catch(() => null);
    const payload: ArtistProfile = {
      ...(existing || {}),
      id: uid,
      googleUid: uid,
      name: existing?.name || name || 'אמן',
      avatarUrl: existing?.avatarUrl || avatarUrl || undefined,
      isConnected: true,
      hasAcceptedTerms: true,
      termsVersionAccepted: CURRENT_TERMS_VERSION,
      acceptedTermsAt: new Date().toISOString(),
      isPrivate: existing?.isPrivate ?? false,
      tracksCount: existing?.tracksCount ?? 0,
      joinedDate: existing?.joinedDate || new Date().getFullYear().toString(),
      providerPlatform: existing?.providerPlatform || 'Google Auth',
    };
    const saved = await saveArtistAccountToR2(payload);
    return saved.profile || payload;
  } catch (err) {
    console.warn('Failed to save terms acceptance to R2:', err);
    return null;
  }
}

let inFlightSongsPromise: Promise<JamendoTrack[]> | null = null;
const batchListeners = new Set<(tracks: JamendoTrack[]) => void>();

/**
 * Fetches all saved tracks live from Cloudflare R2 (100% Cloud-Native).
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
      const r2Tracks = await fetchTracksFromCloud().catch(() => []);
      mergeAndEmit(r2Tracks);
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

let bootstrapPromise: Promise<{ tracks: JamendoTrack[]; profiles: ArtistProfile[]; albums: Album[] }> | null = null;
let hasBootstrapped = false;

/**
 * Fast single-roundtrip bootstrap loading tracks + profiles + albums together from /api/bootstrap.
 * Populates all session caches cleanly before UI reveals so cards & profiles never pop in belatedly.
 */
export function fetchBootstrapData(force = false): Promise<{
  tracks: JamendoTrack[];
  profiles: ArtistProfile[];
  albums: Album[];
}> {
  if (!force && hasBootstrapped) {
    return Promise.resolve({
      tracks: getInstantSongPool(),
      profiles: getCachedArtistProfiles(),
      albums: getCachedAlbums(),
    });
  }
  if (!force && bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const boot = await fetchBootstrapFromCloud();
      if (boot) {
        const deletedIds = getDeletedSongIds();
        const cleanedTracks = deduplicateTracks(boot.tracks).filter(
          (t) => isValidTrackWithOwner(t) && !deletedIds.has(t.id)
        );
        saveCachedCloudTracks(cleanedTracks);

        const profileMap = new Map<string, ArtistProfile>();
        boot.profiles.forEach((ca: any) => {
          const key = String(ca?.googleUid || ca?.id || '').replace(/^artist_/, '').trim();
          if (!key) return;
          profileMap.set(key, { ...ca, id: key, googleUid: key });
        });
        memorySessionProfiles = Array.from(profileMap.values());
        saveCachedAlbums(boot.albums);
        hasBootstrapped = true;
        return {
          tracks: cleanedTracks,
          profiles: memorySessionProfiles,
          albums: memorySessionAlbums,
        };
      }

      // Fallback to parallel direct endpoints if /api/bootstrap was unavailable
      const [tracks, profiles, albums] = await Promise.all([
        fetchAllRealSongs(),
        fetchAllArtistProfiles(),
        fetchRealAlbums(),
      ]);
      hasBootstrapped = true;
      return { tracks, profiles, albums };
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

// Start eager prefetch immediately when module evaluates (overlaps with React/DOM init)
if (typeof window !== 'undefined') {
  void fetchBootstrapData();
}

let initPromise: Promise<any> | null = null;
export function initializeMultiMusicService(): Promise<any> {
  if (initPromise) return initPromise;
  initPromise = fetchBootstrapData();
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
