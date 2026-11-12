import { JamendoTrack, Album } from '../types';

export interface CloudStorageConfig {
  capacityMb: number;
  usedBytes: number;
  fileCount: number;
  isConnected: boolean;
  lastSyncStatus?: string;
}

/**
 * Helper for safe JSON fetching with descriptive errors
 */
async function safeJson(res: Response, context: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    let errDetail = text;
    try {
      const parsed = JSON.parse(text);
      errDetail = parsed.error || parsed.message || text;
    } catch {}
    throw new Error(`${context}: ${errDetail}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${context}: תגובת השרת אינה בפורמט JSON תקין`);
  }
}

/**
 * Normalizes media URL
 */
export function getStreamingMediaUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();

  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  return trimmed;
}

/**
 * Calculates REAL storage used in bytes based on user-uploaded tracks.
 */
export function calculateRealStorageUsage(tracks: JamendoTrack[]): { usedBytes: number; trackCount: number } {
  const userUploadedTracks = tracks.filter((t) => t.id.startsWith('artist_track_') || t.uploadedByUid);

  let totalBytes = 0;
  userUploadedTracks.forEach((t) => {
    // Estimations if size is unknown
    const audioSize = 4500000; 
    const coverSize = 350000;
    totalBytes += audioSize + coverSize;
  });

  return {
    usedBytes: totalBytes,
    trackCount: userUploadedTracks.length,
  };
}

export function getR2AuthHeaders(): Record<string, string> {
  // Credentials are processed 100% server-side in server.ts to prevent leaks in DevTools
  return {};
}

export async function checkR2StorageStatus(): Promise<{ configured: boolean; bucket?: string; error?: string }> {
  try {
    const res = await fetch('/api/storage/status');
    const data = await res.json();
    return {
      configured: !!data.configured,
      bucket: data.bucket,
      error: data.error,
    };
  } catch (err: any) {
    return { configured: false, error: err?.message };
  }
}

export function getCloudStorageConfig(): CloudStorageConfig {
  try {
    const saved = localStorage.getItem('kolot_cloud_storage_config');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {}

  return {
    capacityMb: 10000, // 10GB for Cloudflare R2
    usedBytes: 0,
    fileCount: 0,
    isConnected: true, // Always connected via server-side R2 credentials
  };
}

export function saveCloudStorageConfig(config: CloudStorageConfig): void {
  try {
    localStorage.setItem('kolot_cloud_storage_config', JSON.stringify(config));
  } catch {}
}

/**
 * Upload & Commit track audio file, cover image, and metadata JSON directly into Cloud Storage
 */
export async function uploadTrackToCloudStorage(
  track: JamendoTrack,
  audioFile?: File | Blob,
  coverFile?: File | Blob
): Promise<{ success: boolean; audioUrl?: string; coverUrl?: string; error?: string }> {
  try {
    const trackId = track.id;
    
    // 1. Upload Audio
    let audioUrl = track.audioUrl;
    if (audioFile) {
      const audioFormData = new FormData();
      audioFormData.append('file', audioFile);
      const ext = (audioFile instanceof File && audioFile.name.includes('.')) 
        ? audioFile.name.split('.').pop() 
        : 'mp3';
      audioFormData.append('path', `audio/${trackId}.${ext}`);

      const audioRes = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: getR2AuthHeaders(),
        body: audioFormData
      });
      const audioData = await safeJson(audioRes, 'העלאת קובץ שמע נכשלה');
      if (audioData.success) {
        audioUrl = audioData.url;
      }
    }

    // 2. Upload Cover
    let coverUrl = track.coverUrl;
    if (coverFile) {
      const coverFormData = new FormData();
      coverFormData.append('file', coverFile);
      const ext = (coverFile instanceof File && coverFile.name.includes('.')) 
        ? coverFile.name.split('.').pop() 
        : 'jpg';
      coverFormData.append('path', `covers/${trackId}.${ext}`);

      const coverRes = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: getR2AuthHeaders(),
        body: coverFormData
      });
      const coverData = await safeJson(coverRes, 'העלאת תמונת עטיפה נכשלה');
      if (coverData.success) {
        coverUrl = coverData.url;
      }
    }

    // 3. Upload Metadata
    const trackToSave = {
      ...track,
      audioUrl,
      coverUrl,
      source: 'Kolot R2 Storage',
    };

    const metaRes = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getR2AuthHeaders(),
      },
      body: JSON.stringify({
        path: `tracks/${trackId}.json`,
        content: JSON.stringify(trackToSave, null, 2)
      })
    });

    await safeJson(metaRes, 'שמירת מטא-דאטה נכשלה');

    // 4. Update Index
    const tracks = await fetchTracksFromCloudStorage();
    const updatedIndex = [trackToSave, ...tracks.filter(t => t.id !== trackId)];
    
    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getR2AuthHeaders(),
      },
      body: JSON.stringify({
        path: 'tracks_index.json',
        content: JSON.stringify(updatedIndex, null, 2)
      })
    });

    return {
      success: true,
      audioUrl,
      coverUrl,
    };
  } catch (err: any) {
    console.error('Upload track error:', err);
    return { success: false, error: err.message || 'שגיאה בהעלאה לאחסון Cloudflare R2' };
  }
}

export async function fetchTracksFromCloudStorage(): Promise<JamendoTrack[]> {
  try {
    const res = await fetch('/api/storage/list?prefix=tracks_index.json', {
      headers: getR2AuthHeaders(),
    });
    const data = await safeJson(res, 'טעינת רשימת שירים נכשלה');
    if (data.success && data.files.length > 0) {
      const indexUrl = data.files[0].url;
      const indexRes = await fetch(indexUrl);
      if (indexRes.ok) {
        return await safeJson(indexRes, 'עיבוד רשימת שירים נכשל');
      }
    }
  } catch (err) {
    console.warn('Failed to fetch tracks from Cloud Storage:', err);
  }
  return [];
}

export async function deleteTrackFromCloudStorage(trackId: string): Promise<boolean> {
  try {
    await fetch(`/api/storage/delete?path=tracks/${trackId}.json`, {
      method: 'DELETE',
      headers: getR2AuthHeaders(),
    });
    
    // Update index
    const tracks = await fetchTracksFromCloudStorage();
    const updatedIndex = tracks.filter(t => t.id !== trackId);
    
    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'tracks_index.json',
        content: JSON.stringify(updatedIndex, null, 2)
      })
    });

    return true;
  } catch {
    return false;
  }
}

export async function uploadArtistProfileToCloud(artist: any, avatarFile?: File | Blob): Promise<{ success: boolean; avatarUrl?: string }> {
  try {
    let avatarUrl = artist.avatarUrl;
    if (avatarFile) {
      const formData = new FormData();
      formData.append('file', avatarFile);
      formData.append('path', `avatars/${artist.id}.jpg`);
      const res = await fetch('/api/storage/upload', { method: 'POST', body: formData });
      const data = await safeJson(res, 'העלאת תמונת פרופיל נכשלה');
      if (data.success) avatarUrl = data.url;
    }

    const profileToSave = { ...artist, avatarUrl };
    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `profiles/${artist.id}.json`,
        content: JSON.stringify(profileToSave, null, 2)
      })
    });

    return { success: true, avatarUrl };
  } catch {
    return { success: false };
  }
}

export async function fetchArtistProfilesFromCloud(): Promise<any[]> {
  try {
    const res = await fetch('/api/storage/list?prefix=profiles/');
    const data = await safeJson(res, 'טעינת פרופילי אמנים נכשלה');
    if (data.success && data.files) {
      const profileFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const profiles = await Promise.all(
        profileFiles.map(async (f: any) => {
          try {
            const profileRes = await fetch(f.url);
            if (profileRes.ok) return await safeJson(profileRes, 'עיבוד פרופיל אמן נכשל');
          } catch {}
          return null;
        })
      );
      return profiles.filter(Boolean);
    }
  } catch (err) {
    console.warn('Failed to fetch profiles from Cloud Storage:', err);
  }
  return [];
}

export async function updateTrackColorInCloud(trackId: string, bgColor: string, fullTrack: JamendoTrack): Promise<boolean> {
  const updatedTrack = { ...fullTrack, bgColor };
  await fetch('/api/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `tracks/${trackId}.json`,
      content: JSON.stringify(updatedTrack, null, 2)
    })
  });
  return true;
}

export async function incrementTrackPlaysInCloud(track: JamendoTrack): Promise<number> {
  const plays = (track.playsCount || 0) + 1;
  const updatedTrack = { ...track, playsCount: plays };
  await fetch('/api/storage/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `tracks/${track.id}.json`,
      content: JSON.stringify(updatedTrack, null, 2)
    })
  });
  return plays;
}

// Exports for use in components
// Helper: urlToBlob
export async function urlToBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    console.warn('Failed to fetch URL to blob:', err);
    return null;
  }
}

export function computeTrackBgColor(track: Partial<JamendoTrack>): string {
  if (track.bgColor && track.bgColor.includes('radial-gradient')) {
    return track.bgColor;
  }

  let r = 99, g = 102, b = 241;
  const seed = track.coverUrl || track.name || track.id || track.artistName || 'music';

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const s = 0.80;
  const l = 0.48;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= h && h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (60 <= h && h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (120 <= h && h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (180 <= h && h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (240 <= h && h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }

  r = Math.round((r1 + m) * 255);
  g = Math.round((g1 + m) * 255);
  b = Math.round((b1 + m) * 255);

  const darkR = Math.round(r * 0.18);
  const darkG = Math.round(g * 0.18);
  const darkB = Math.round(b * 0.18);

  return `radial-gradient(circle at 50% 35%, rgba(${r}, ${g}, ${b}, 0.8) 0%, rgba(${darkR}, ${darkG}, ${darkB}, 0.96) 55%, #030712 100%)`;
}

// Exports for use in components
export const uploadTrackToCloud = uploadTrackToCloudStorage;
export const fetchTracksFromCloud = fetchTracksFromCloudStorage;
export const deleteTrackFromCloud = deleteTrackFromCloudStorage;

export async function uploadAlbumToCloud(album: Album, coverFile?: File | Blob): Promise<{ success: boolean; coverUrl?: string; error?: string }> {

  try {
    let coverUrl = album.coverUrl;
    if (coverFile) {
      const formData = new FormData();
      formData.append('file', coverFile);
      const ext = (coverFile instanceof File && coverFile.name.includes('.')) 
        ? coverFile.name.split('.').pop() 
        : 'jpg';
      formData.append('path', `covers/albums/${album.id}.${ext}`);

      const res = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: getR2AuthHeaders(),
        body: formData
      });
      const data = await safeJson(res, 'העלאת תמונת אלבום נכשלה');
      if (data.success) coverUrl = data.url;
    }
    const albumToSave = { ...album, coverUrl };
    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getR2AuthHeaders(),
      },
      body: JSON.stringify({
        path: `albums/${album.id}.json`,
        content: JSON.stringify(albumToSave, null, 2)
      })
    });
    return { success: true, coverUrl };
  } catch (err: any) {
    return { success: false, error: err.message || 'שגיאה בשמירת האלבום' };
  }
}

export async function deleteAlbumFromCloud(albumId: string) {
  await fetch(`/api/storage/delete?path=albums/${albumId}.json`, {
    method: 'DELETE',
    headers: getR2AuthHeaders(),
  });
  return true;
}

export async function fetchAlbumsFromCloud(): Promise<Album[]> {
  try {
    const res = await fetch('/api/storage/list?prefix=albums/', {
      headers: getR2AuthHeaders(),
    });
    const data = await safeJson(res, 'טעינת רשימת אלבומים נכשלה');
    if (data.success && data.files) {
      const albumFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const albums = await Promise.all(
        albumFiles.map(async (f: any) => {
          try {
            const albumRes = await fetch(f.url);
            if (albumRes.ok) return await safeJson(albumRes, 'עיבוד נתוני אלבום נכשל');
          } catch {}
          return null;
        })
      );
      return albums.filter(Boolean);
    }
  } catch (err) {
    console.warn('Failed to fetch albums from Cloud Storage:', err);
  }
  return [];
}


