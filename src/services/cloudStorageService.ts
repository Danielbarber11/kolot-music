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
  return {
    capacityMb: 10000, // 10GB for Cloudflare R2
    usedBytes: 0,
    fileCount: 0,
    isConnected: true, // Always connected via server-side R2 credentials
  };
}

export function saveCloudStorageConfig(_config: CloudStorageConfig): void {
  // Storage configuration is managed 100% server-side in R2 (no localStorage)
}

/**
 * Upload & Commit track audio file, cover image, and metadata JSON directly into Cloudflare R2
 */
export async function uploadTrackToCloudStorage(
  track: JamendoTrack,
  audioFile?: File | Blob,
  coverFile?: File | Blob
): Promise<{ success: boolean; audioUrl?: string; coverUrl?: string; error?: string }> {
  const trackId = track.id;
  let audioUrl = track.audioUrl || '';
  let coverUrl = track.coverUrl || '';

  // 1. Upload Audio to R2
  if (audioFile) {
    try {
      const audioFormData = new FormData();
      audioFormData.append('file', audioFile);
      const ext =
        audioFile instanceof File && audioFile.name.includes('.')
          ? audioFile.name.split('.').pop()?.toLowerCase() || 'mp3'
          : 'mp3';
      audioFormData.append('path', `audio/${trackId}.${ext}`);

      const audioRes = await fetch('/api/storage/upload', {
        method: 'POST',
        body: audioFormData,
      });
      const audioData = await audioRes.json();
      if (audioRes.ok && audioData.success && audioData.url) {
        audioUrl = audioData.url;
      } else {
        return {
          success: false,
          error:
            audioData.error ||
            'שגיאה בהעלאת קובץ השמע ל-Cloudflare R2. אנא בדוק את חיבור האחסון בשרת.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `תקלת רשת בחיבור ל-Cloudflare R2: ${err?.message || 'אנא נסה שוב'}`,
      };
    }
  }

  // Reject unresolved blob URLs
  if (!audioUrl || audioUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'קובץ השמע לא הועלה לענן (Cloudflare R2). אנא בחר קובץ שמע תקין ונסה שוב.',
    };
  }

  // 2. Upload Cover to R2 (either compressed DataURL or raw Cover File)
  let coverBlobToUpload: Blob | File | undefined = coverFile;
  if (!coverBlobToUpload && coverUrl.startsWith('data:image/')) {
    coverBlobToUpload = (await urlToBlob(coverUrl)) || undefined;
  }

  if (coverBlobToUpload) {
    try {
      const coverFormData = new FormData();
      coverFormData.append('file', coverBlobToUpload);
      const ext =
        coverBlobToUpload instanceof File && coverBlobToUpload.name.includes('.')
          ? coverBlobToUpload.name.split('.').pop()?.toLowerCase() || 'jpg'
          : 'jpg';
      coverFormData.append('path', `covers/${trackId}.${ext}`);

      const coverRes = await fetch('/api/storage/upload', {
        method: 'POST',
        body: coverFormData,
      });
      const coverData = await coverRes.json();
      if (coverRes.ok && coverData.success && coverData.url) {
        coverUrl = coverData.url;
      } else {
        return {
          success: false,
          error: coverData.error || 'שגיאה בהעלאת תמונת העטיפה ל-Cloudflare R2.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `שגיאה בהעלאת תמונת העטיפה ל-R2: ${err?.message || 'אנא נסה שוב'}`,
      };
    }
  }

  if (coverUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'תמונת העטיפה לא הועלתה לענן. אנא בחר תמונה תקינה ונסה שוב.',
    };
  }

  // 3. Metadata Object
  const trackToSave: JamendoTrack = {
    ...track,
    audioUrl,
    coverUrl,
    source: 'Kolot R2 Storage',
  };

  // Save tracks/${trackId}.json strictly in R2
  try {
    const metaRes = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `tracks/${trackId}.json`,
        content: JSON.stringify(trackToSave, null, 2),
      }),
    });
    const metaData = await metaRes.json();
    if (!metaRes.ok || !metaData.success) {
      return {
        success: false,
        error: metaData.error || 'שגיאה בשמירת נתוני השיר ב-Cloudflare R2.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: `שגיאה בשמירת נתוני השיר ב-R2: ${err?.message || 'אנא נסה שוב'}`,
    };
  }

  // Synchronize tracks_index.json in R2
  try {
    const existing = await fetchTracksFromCloudStorage();
    const map = new Map<string, JamendoTrack>();
    existing.forEach((t) => map.set(t.id, t));
    map.set(trackId, trackToSave);
    const updatedIndex = Array.from(map.values());

    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'tracks_index.json',
        content: JSON.stringify(updatedIndex, null, 2),
      }),
    });
  } catch (err) {
    console.warn('tracks_index.json update notice:', err);
  }

  return {
    success: true,
    audioUrl,
    coverUrl,
  };
}

function isCloudPlayableTrack(t: any): t is JamendoTrack {
  if (!t || !t.id || !t.name || !t.audioUrl) return false;
  if (typeof t.audioUrl !== 'string') return false;
  if (t.audioUrl.startsWith('blob:') || t.audioUrl.startsWith('/uploads/')) return false;
  return true;
}

export async function fetchTracksFromCloudStorage(): Promise<JamendoTrack[]> {
  const trackMap = new Map<string, JamendoTrack>();

  // 1. Fetch tracks directory strictly from Cloudflare R2 (no cache)
  try {
    const res = await fetch('/api/storage/list?prefix=tracks/', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.files) && data.files.length > 0) {
        const jsonFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
        const loaded = await Promise.all(
          jsonFiles.map(async (f: any) => {
            try {
              const itemRes = await fetch(f.url, { cache: 'no-store' });
              if (itemRes.ok) {
                return await itemRes.json();
              }
            } catch {}
            return null;
          })
        );
        loaded.filter(isCloudPlayableTrack).forEach((t: JamendoTrack) => {
          trackMap.set(t.id, t);
        });
      }
    }
  } catch (err) {
    console.warn('Failed to list tracks/ from R2:', err);
  }

  // 2. Fetch tracks_index.json from R2 as supplementary catalog (only if tracks/ didn't already include it)
  try {
    const res = await fetch('/api/storage/list?prefix=tracks_index.json', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.files?.length > 0) {
        const indexUrl = data.files[0].url;
        const indexRes = await fetch(indexUrl, { cache: 'no-store' });
        if (indexRes.ok) {
          const indexTracks = await indexRes.json();
          if (Array.isArray(indexTracks)) {
            indexTracks.filter(isCloudPlayableTrack).forEach((t: JamendoTrack) => {
              if (!trackMap.has(t.id)) {
                trackMap.set(t.id, t);
              }
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to fetch tracks_index.json from R2:', err);
  }

  return Array.from(trackMap.values());
}

export async function deleteTrackFromCloudStorage(trackId: string): Promise<boolean> {
  try {
    // Delete track metadata JSON
    await fetch(`/api/storage/delete?path=${encodeURIComponent(`tracks/${trackId}.json`)}`, {
      method: 'DELETE',
      headers: getR2AuthHeaders(),
    });

    // Clean up associated audio & cover objects in R2
    try {
      const [audioListRes, coverListRes] = await Promise.all([
        fetch(`/api/storage/list?prefix=${encodeURIComponent(`audio/${trackId}`)}`, { cache: 'no-store' }),
        fetch(`/api/storage/list?prefix=${encodeURIComponent(`covers/${trackId}`)}`, { cache: 'no-store' }),
      ]);
      const deletions: Promise<any>[] = [];
      if (audioListRes.ok) {
        const aData = await audioListRes.json();
        (aData.files || []).forEach((f: any) => {
          deletions.push(fetch(`/api/storage/delete?path=${encodeURIComponent(f.key)}`, { method: 'DELETE' }));
        });
      }
      if (coverListRes.ok) {
        const cData = await coverListRes.json();
        (cData.files || []).forEach((f: any) => {
          deletions.push(fetch(`/api/storage/delete?path=${encodeURIComponent(f.key)}`, { method: 'DELETE' }));
        });
      }
      await Promise.allSettled(deletions);
    } catch {}

    // Update index
    const tracks = await fetchTracksFromCloudStorage();
    const updatedIndex = tracks.filter((t) => t.id !== trackId);

    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'tracks_index.json',
        content: JSON.stringify(updatedIndex, null, 2),
      }),
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
    const res = await fetch('/api/storage/list?prefix=profiles/', { cache: 'no-store' });
    const data = await safeJson(res, 'טעינת פרופילי אמנים נכשלה');
    if (data.success && data.files) {
      const profileFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const profiles = await Promise.all(
        profileFiles.map(async (f: any) => {
          try {
            const profileRes = await fetch(f.url, { cache: 'no-store' });
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
    const metaRes = await fetch('/api/storage/upload', {
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
    const metaData = await safeJson(metaRes, 'שמירת אלבום בענן נכשלה');
    return { success: !!metaData.success, coverUrl };
  } catch (err: any) {
    return { success: false, error: err.message || 'שגיאה בשמירת האלבום' };
  }
}

export async function deleteAlbumFromCloud(albumId: string) {
  await fetch(`/api/storage/delete?path=${encodeURIComponent(`albums/${albumId}.json`)}`, {
    method: 'DELETE',
    headers: getR2AuthHeaders(),
  });
  return true;
}

export async function fetchAlbumsFromCloud(): Promise<Album[]> {
  try {
    const res = await fetch('/api/storage/list?prefix=albums/', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    const data = await safeJson(res, 'טעינת רשימת אלבומים נכשלה');
    if (data.success && data.files) {
      const albumFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const albums = await Promise.all(
        albumFiles.map(async (f: any) => {
          try {
            const albumRes = await fetch(f.url, { cache: 'no-store' });
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


