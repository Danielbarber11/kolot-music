import { JamendoTrack } from '../types';
import { getArtistTracksFromFirebase } from './firebaseService';
import { loadTracksFromIndexedDB } from './localTrackStorage';
import { fetchTracksFromGitHubRepo } from './githubStorageService';

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
 * Deduplicates tracks by ID and intelligently merges updated metadata (newer titles, updated genres, AI markers, plays)
 */
export function deduplicateTracks(tracks: JamendoTrack[]): JamendoTrack[] {
  const deletedSet = getDeletedSongIds();
  const trackMap = new Map<string, JamendoTrack>();

  for (const t of tracks) {
    if (!t || !t.id || !t.name || !t.artistName) continue;
    if (deletedSet.has(t.id)) continue;
    if (!t.audioUrl || typeof t.audioUrl !== 'string' || !t.audioUrl.trim()) continue;

    const existing = trackMap.get(t.id);
    if (!existing) {
      trackMap.set(t.id, { ...t });
    } else {
      // First encountered item in array takes precedence (contains latest updates)
      const merged: JamendoTrack = {
        ...t,
        ...existing,
        audioUrl: existing.audioUrl && !existing.audioUrl.startsWith('blob:') ? existing.audioUrl : (t.audioUrl || existing.audioUrl),
        coverUrl: existing.coverUrl && !existing.coverUrl.startsWith('blob:') ? existing.coverUrl : (t.coverUrl || existing.coverUrl),
      };
      trackMap.set(t.id, merged);
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
