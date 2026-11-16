import { JamendoTrack } from '../types';
import { markSongAsDeleted } from './deletedTracksService';

const DB_NAME = 'kolot_music_db_v3';

/**
 * Local disk/IndexedDB caching is disabled — all tracks are stored 100% in Cloudflare R2.
 * Also purges ALL legacy localStorage PII/auth/profile keys on every boot so zero sensitive user data resides in localStorage.
 */
export async function persistTrackToStorage(_track: JamendoTrack, _audioBlob?: Blob): Promise<void> {
  // No-op: never store tracks locally
}

export async function loadTracksFromIndexedDB(): Promise<JamendoTrack[]> {
  return [];
}

export async function getCachedAudioBlob(_trackId: string): Promise<Blob | null> {
  return null;
}

export async function removeTrackFromStorage(trackId: string): Promise<void> {
  markSongAsDeleted(trackId);
}

export async function clearAllLocalDeviceStorage(): Promise<void> {
  try {
    const legacyKeys = [
      'kolot_uploaded_tracks',
      'kolot_cloud_tracks_cache',
      'kolot_pending_uploads',
      'kolot_user_albums',
      'kolot_cloud_profiles_cache',
      'kolot_cloud_storage_config',
      'kolot_permanently_deleted_tracks_v1',
      'wikiarchive_cached_auth_user',
      'wikiarchive_artist_account',
      'kolot_artist_account_v1',
      'kolot_track_reports',
      'kolot_terms_accepted',
    ];
    legacyKeys.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    // Sweep any per-UID cached profile keys containing user metadata
    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('wikiarchive_artist_account_') || k.startsWith('firebase:host:'))) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });

    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase(DB_NAME);
    }
  } catch {}
}
