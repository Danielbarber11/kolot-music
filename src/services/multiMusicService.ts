import { JamendoTrack } from '../types';
import { getArtistTracksFromFirebase } from './firebaseService';
import { loadTracksFromIndexedDB } from './localTrackStorage';
import { fetchTracksFromGitHubRepo, computeTrackBgColor } from './githubStorageService';

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

import { getDeletedSongIds } from './deletedTracksService';

const CLOUD_TRACKS_CACHE_KEY = 'kolot_cloud_tracks_cache';

export function getCachedCloudTracks(): JamendoTrack[] {
  try {
    const saved = localStorage.getItem(CLOUD_TRACKS_CACHE_KEY);
    if (saved) {
      const parsed: JamendoTrack[] = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
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
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse saved repo tracks from local storage:', e);
  }
  return [];
}

/**
 * Instant song pool returns cached cloud tracks + repo tracks for 0ms initial load
 */
export function getInstantSongPool(): JamendoTrack[] {
  const cachedCloud = getCachedCloudTracks();
  const savedRepo = getSavedRepoTracks();
  return deduplicateTracks([...cachedCloud, ...savedRepo]);
}

/**
 * Fetches all saved tracks from Firebase, GitHub & Storage, updating the instant cache
 */
export async function fetchAllRealSongs(
  onProgress?: (count: number) => void,
  onBatch?: (tracks: JamendoTrack[]) => void
): Promise<JamendoTrack[]> {
  const instantPool = getInstantSongPool();

  let fbTracks: JamendoTrack[] = [];
  try {
    fbTracks = await getArtistTracksFromFirebase();
  } catch (e) {
    console.warn('Firebase tracks fetch warning:', e);
  }

  let ghTracks: JamendoTrack[] = [];
  try {
    ghTracks = await fetchTracksFromGitHubRepo();
  } catch (e) {
    console.warn('GitHub tracks fetch warning:', e);
  }

  // Merge with priority: Firestore -> GitHub -> Instant Pool
  const combined = deduplicateTracks([...fbTracks, ...ghTracks, ...instantPool]);

  saveCachedCloudTracks(combined);

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
