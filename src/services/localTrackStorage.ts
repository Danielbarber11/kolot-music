import { JamendoTrack } from '../types';
import { markSongAsDeleted } from './deletedTracksService';

const DB_NAME = 'kolot_music_db_v3';

/**
 * Local disk/IndexedDB caching is disabled — all tracks are stored 100% in Cloudflare R2 & Firebase.
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
    localStorage.removeItem('kolot_uploaded_tracks');
    localStorage.removeItem('kolot_cloud_tracks_cache');
    localStorage.removeItem('kolot_pending_uploads');
    localStorage.removeItem('kolot_user_albums');
    localStorage.removeItem('kolot_cloud_profiles_cache');
    localStorage.removeItem('kolot_cloud_storage_config');
    localStorage.removeItem('kolot_permanently_deleted_tracks_v1');
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase(DB_NAME);
    }
  } catch {}
}
