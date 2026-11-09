import { JamendoTrack } from '../types';

const DB_NAME = 'kolot_music_db_v2';
const STORE_NAME = 'uploaded_tracks';
const LOCAL_STORAGE_KEY = 'kolot_uploaded_tracks';

/**
 * Clear any existing local device storage so nothing is retained on user's device
 */
export async function clearAllLocalDeviceStorage(): Promise<void> {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem('kolot_locally_saved_tracks');
  } catch {}

  try {
    if (typeof window !== 'undefined' && window.indexedDB) {
      window.indexedDB.deleteDatabase(DB_NAME);
    }
  } catch {}
}

/**
 * Persist track to storage - NO-OP as requested by user ("No local device storage")
 */
export async function persistTrackToStorage(_track: JamendoTrack, _audioBlob?: Blob): Promise<void> {
  // Purge any accidental local entries
  clearAllLocalDeviceStorage().catch(() => {});
  return Promise.resolve();
}

/**
 * Load tracks from IndexedDB - Always returns empty array to prevent local stale device loading
 */
export async function loadTracksFromIndexedDB(): Promise<JamendoTrack[]> {
  clearAllLocalDeviceStorage().catch(() => {});
  return Promise.resolve([]);
}

import { markSongAsDeleted } from './deletedTracksService';

/**
 * Remove track from storage and mark permanently deleted
 */
export async function removeTrackFromStorage(trackId: string): Promise<void> {
  if (trackId) {
    markSongAsDeleted(trackId);
  }
  clearAllLocalDeviceStorage().catch(() => {});
  return Promise.resolve();
}
