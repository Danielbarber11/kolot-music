import { JamendoTrack } from '../types';
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
  persistTrackToStorage
} from './localTrackStorage';
import { 
  fetchTracksFromGitHubRepo, 
  computeTrackBgColor,
  uploadTrackToGitHubRepo,
  uploadArtistProfileToGitHub,
  fetchArtistProfilesFromGitHub,
  urlToBlob
} from './githubStorageService';
import { getDeletedSongIds, markSongAsDeleted } from './deletedTracksService';

/**
 * Clean Storage-Only Music Service
 * All unsaved/preset demo songs have been removed as requested.
 * Only tracks that are saved/uploaded into the storage repository are loaded and displayed.
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

export function getCachedCloudTracks(): JamendoTrack[] {
  try {
    const saved = localStorage.getItem(CLOUD_TRACKS_CACHE_KEY);
    if (saved) {
      const parsed: JamendoTrack[] = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const deletedSet = getDeletedSongIds();
        return parsed.filter((t) => {
          if (!t || !t.id || !t.name) return false;
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
    if (Array.isArray(tracks) && tracks.length > 0) {
      localStorage.setItem(CLOUD_TRACKS_CACHE_KEY, JSON.stringify(tracks));
    }
  } catch (e) {
    console.warn('Failed to save cloud tracks cache:', e);
  }
}

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
  if (trimmed.includes('jsdelivr.net') || trimmed.includes('githubusercontent.com') || trimmed.includes('firestore')) return 4;
  if (trimmed.startsWith('blob:')) return 2;
  if (trimmed.includes('unsplash.com') || trimmed.includes('placeholder')) return 1;
  return 2;
}

/**
 * Deduplicates tracks by ID and normalized Artist + Title, intelligently merging updated metadata
 * (preferring authentic cover art, streaming audio URLs, complete lyrics, and higher play counts).
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
    if (deletedSet.has(`del_${titleArtistKey}`)) continue;
    if (!t.audioUrl || typeof t.audioUrl !== 'string' || !t.audioUrl.trim()) continue;

    const rawIdKey = t.id ? t.id.trim() : titleArtistKey;

    // Find if track already exists by ID or by Title+Artist combination
    const canonicalKey = idToCanonicalKey.get(rawIdKey) || titleArtistToCanonicalKey.get(titleArtistKey);

    if (!canonicalKey) {
      // First time encountering this song
      const key = rawIdKey;
      trackMap.set(key, { ...t });
      idToCanonicalKey.set(rawIdKey, key);
      titleArtistToCanonicalKey.set(titleArtistKey, key);
    } else {
      const existing = trackMap.get(canonicalKey)!;

      // Determine best cover art
      const existingCoverScore = getCoverQualityScore(existing.coverUrl);
      const newCoverScore = getCoverQualityScore(t.coverUrl);
      const bestCover = newCoverScore > existingCoverScore ? t.coverUrl : existing.coverUrl;

      // Determine best audio URL (prefer CDN / HTTPS over temporary blob)
      let bestAudio = existing.audioUrl;
      if (t.audioUrl && !t.audioUrl.startsWith('blob:') && existing.audioUrl?.startsWith('blob:')) {
        bestAudio = t.audioUrl;
      } else if (!bestAudio && t.audioUrl) {
        bestAudio = t.audioUrl;
      }

      // Determine best artist name
      const bestArtist = (existing.artistName && existing.artistName !== 'אמן לא ידוע')
        ? existing.artistName
        : (t.artistName && t.artistName !== 'אמן לא ידוע' ? t.artistName : existing.artistName || 'אמן לא ידוע');

      // Determine best avatar URL
      const bestAvatar = (existing.artistAvatarUrl && existing.artistAvatarUrl.trim().length > 0)
        ? existing.artistAvatarUrl
        : (t.artistAvatarUrl || bestCover);

      // Merge into canonical track
      const merged: JamendoTrack = {
        ...existing,
        ...t,
        id: existing.id || t.id,
        name: existing.name || t.name,
        artistName: bestArtist,
        coverUrl: bestCover || '',
        audioUrl: bestAudio,
        artistAvatarUrl: bestAvatar || '',
        bgColor: existing.bgColor || t.bgColor || computeTrackBgColor(existing),
        lyrics: (existing.lyrics && existing.lyrics.trim().length > 0) ? existing.lyrics : t.lyrics,
        hasAutoLyrics: existing.hasAutoLyrics ?? t.hasAutoLyrics ?? true,
        genre: existing.genre || t.genre || 'Pop',
        playsCount: Math.max(existing.playsCount || 0, t.playsCount || 0),
        uploadedByUid: existing.uploadedByUid || t.uploadedByUid,
      };

      trackMap.set(canonicalKey, merged);
      if (t.id) {
        idToCanonicalKey.set(t.id.trim(), canonicalKey);
      }
    }
  }

  return sortTracksChronologically(Array.from(trackMap.values()));
}

/**
 * Retrieve saved tracks stored locally in storage
 */
export function getSavedRepoTracks(): JamendoTrack[] {
  try {
    const savedLocal = localStorage.getItem('kolot_uploaded_tracks');
    if (savedLocal) {
      const parsed: JamendoTrack[] = JSON.parse(savedLocal);
      if (Array.isArray(parsed)) {
        const deletedSet = getDeletedSongIds();
        return parsed.filter((t) => {
          if (!t || !t.id || !t.name) return false;
          const normArtist = (t.artistName || '').trim().toLowerCase().replace(/\s+/g, ' ');
          const normName = (t.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
          return !deletedSet.has(t.id) && !deletedSet.has(`del_${normArtist}::${normName}`);
        });
      }
    }
  } catch (e) {
    console.warn('Failed to parse saved repo tracks from local storage:', e);
  }
  return [];
}
/**
 * Resume any uploads that were interrupted
 */
export async function resumePendingUploads(): Promise<void> {
  try {
    const pendingJson = localStorage.getItem('kolot_pending_uploads');
    if (!pendingJson) return;
    
    const pendingIds: string[] = JSON.parse(pendingJson);
    if (!Array.isArray(pendingIds) || pendingIds.length === 0) return;

    console.info(`Resuming ${pendingIds.length} interrupted uploads...`);
    
    for (const id of pendingIds) {
      const allCached = await loadTracksFromIndexedDB();
      const track = allCached.find(t => t.id === id);
      if (!track) continue;

      const audioBlob = await getCachedAudioBlob(id);
      const coverBlob = track.coverUrl?.startsWith('data:') ? await urlToBlob(track.coverUrl) : null;
      
      const res = await uploadTrackToGitHubRepo(track, audioBlob || undefined, coverBlob || undefined);
      if (res.success) {
        // Remove from pending
        const currentPending = JSON.parse(localStorage.getItem('kolot_pending_uploads') || '[]');
        const updated = currentPending.filter((pid: string) => pid !== id);
        localStorage.setItem('kolot_pending_uploads', JSON.stringify(updated));
        console.info(`Interrupted upload for ${track.name} recovered successfully.`);
      }
    }
  } catch (err) {
    console.warn('Interrupted upload recovery notice:', err);
  }
}

/**
 * Instant song pool returns cached cloud tracks + verified default tracks for 0ms initial load
 */
export async function getInstantSongPoolAsync(): Promise<JamendoTrack[]> {
  const cachedCloud = getCachedCloudTracks();
  const indexedDBTracks = await loadTracksFromIndexedDB();
  const combined = [...cachedCloud, ...indexedDBTracks, ...VERIFIED_REAL_TRACKS];
  return deduplicateTracks(combined);
}

/**
 * Synchronous version for state init (reads from localStorage only)
 */
export function getInstantSongPool(): JamendoTrack[] {
  const cachedCloud = getCachedCloudTracks();
  const combined = [...cachedCloud, ...VERIFIED_REAL_TRACKS];
  return deduplicateTracks(combined);
}

const CLOUD_PROFILES_CACHE_KEY = 'kolot_cloud_profiles_cache';

export async function fetchAllArtistProfiles(): Promise<any[]> {
  try {
    const ghProfiles = await fetchArtistProfilesFromGitHub();
    if (Array.isArray(ghProfiles)) {
      // Force local cache to strictly match GitHub
      localStorage.setItem(CLOUD_PROFILES_CACHE_KEY, JSON.stringify(ghProfiles));
      return ghProfiles;
    }
  } catch (err) {
    console.warn('GitHub profiles fetch error:', err);
  }
  
  try {
    const cached = localStorage.getItem(CLOUD_PROFILES_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}
  
  return [];
}

/**
 * Tracks if user has accepted terms in Firestore to ensure one-time requirement
 */
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
 * Migrates data from Firebase to GitHub if any is found.
 */
export async function migrateFirebaseToGitHub(): Promise<void> {
  // Only run migration once per session to save bandwidth
  if ((window as any)._kolot_migration_run) return;
  (window as any)._kolot_migration_run = true;

  console.info('Checking for data to migrate from Firebase to GitHub...');
  
  try {
    // 1. Migrate Tracks
    const fbTracks = await getArtistTracksFromFirebase();
    if (fbTracks.length > 0) {
      console.info(`Found ${fbTracks.length} tracks in Firebase. Migrating...`);
      for (const track of fbTracks) {
        const audioBlob = track.audioUrl ? await urlToBlob(track.audioUrl) : null;
        const coverBlob = track.coverUrl ? await urlToBlob(track.coverUrl) : null;
        
        const res = await uploadTrackToGitHubRepo(track, audioBlob || undefined, coverBlob || undefined);
        if (res.success) {
          console.info(`Migrated track: ${track.name}. Deleting from Firebase...`);
          await deleteArtistTrackFromFirebase(track.id);
        }
      }
    }

    // 2. Migrate Artist Profiles
    const fbAccounts = await getArtistAccountsFromFirebase();
    if (fbAccounts.length > 0) {
      for (const artist of fbAccounts) {
        // Skip migration if it's a bare auth record
        if (!artist.avatarUrl && !artist.bio && artist.tracksCount === 0) continue;
        
        const avatarBlob = artist.avatarUrl ? await urlToBlob(artist.avatarUrl) : null;
        await uploadArtistProfileToGitHub(artist, avatarBlob || undefined);
      }
    }
  } catch (err) {
    console.warn('Migration failed:', err);
  }
}

/**
 * Fetches all saved tracks from GitHub primarily, and runs migration in background.
 */
export async function fetchAllRealSongs(
  onProgress?: (count: number) => void,
  onBatch?: (tracks: JamendoTrack[]) => void
): Promise<JamendoTrack[]> {
  const instantPool = await getInstantSongPoolAsync();

  // Run resume and migration in background without blocking
  resumePendingUploads().catch(() => {});
  migrateFirebaseToGitHub().catch(() => {});

  let ghTracks: JamendoTrack[] = [];
  try {
    ghTracks = await fetchTracksFromGitHubRepo();
  } catch (e) {
    console.warn('GitHub tracks fetch warning:', e);
  }

  // Force local cache to strictly match GitHub (GitHub is absolute source of truth)
  if (ghTracks.length > 0) {
    try {
      const activeGitHubIds = new Set(ghTracks.map((t) => t.id));
      
      // Sync IndexedDB to match GitHub
      const indexedDBTracks = await loadTracksFromIndexedDB();
      for (const t of indexedDBTracks) {
        // If it's a known github track (has non-blob URL) but not in current fetch, remove from local
        if (t.audioUrl && !t.audioUrl.startsWith('blob:') && !activeGitHubIds.has(t.id)) {
          await removeTrackFromStorage(t.id);
        }
      }
      
      // Refresh the high-speed cloud cache
      saveCachedCloudTracks(ghTracks);
    } catch (err) {
      console.warn('Stale track sync notice:', err);
    }
  }

  const combined = deduplicateTracks([...ghTracks, ...VERIFIED_REAL_TRACKS]);
  if (onProgress) onProgress(combined.length);
  if (onBatch) onBatch(combined);

  return combined;
}

// Stubs for unsaved external sources (returning empty array so only stored tracks exist)
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
