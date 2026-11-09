import { JamendoTrack } from '../types';

const DB_NAME = 'kolot_music_db_v3';
const STORE_NAME = 'tracks_cache';
const BLOB_STORE_NAME = 'blobs_cache';

async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persist track to local IndexedDB cache
 */
export async function persistTrackToStorage(track: JamendoTrack, audioBlob?: Blob): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).put(track);
    if (audioBlob) {
      tx.objectStore(BLOB_STORE_NAME).put(audioBlob, track.id);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to persist track locally:', err);
  }
}

/**
 * Load all cached tracks from IndexedDB
 */
export async function loadTracksFromIndexedDB(): Promise<JamendoTrack[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

/**
 * Get a cached audio blob
 */
export async function getCachedAudioBlob(trackId: string): Promise<Blob | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
      const request = tx.objectStore(BLOB_STORE_NAME).get(trackId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

import { markSongAsDeleted } from './deletedTracksService';

/**
 * Remove track from local storage
 */
export async function removeTrackFromStorage(trackId: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(trackId);
    tx.objectStore(BLOB_STORE_NAME).delete(trackId);
    markSongAsDeleted(trackId);
  } catch {}
}

export async function clearAllLocalDeviceStorage(): Promise<void> {
  try {
    localStorage.removeItem('kolot_uploaded_tracks');
    localStorage.removeItem('kolot_cloud_tracks_cache');
    const db = await getDB();
    const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.objectStore(BLOB_STORE_NAME).clear();
  } catch {}
}
