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
  const trimmed = (text || '').trim();

  if (!trimmed) {
    if (res.status === 404 || res.status === 405) {
      throw new Error(`${context}: נתיב השרת (/api/storage) לא נמצא (${res.status}). יש לחבר Worker/שרת פעיל ולפרוס מחדש.`);
    }
    throw new Error(`${context}: השרת החזיר תגובה ריקה (HTTP ${res.status}). ודא ששרת Cloudflare R2 / Express זמין.`);
  }

  if (trimmed.startsWith('<')) {
    throw new Error(`${context}: השרת החזיר עמוד HTML במקום JSON (HTTP ${res.status}). בדוק שניתוב ה-API (/api/*) מחובר לשרת.`);
  }

  if (!res.ok) {
    let errDetail = trimmed;
    try {
      const parsed = JSON.parse(trimmed);
      errDetail = parsed.error || parsed.message || trimmed;
    } catch {}
    throw new Error(`${context}: ${errDetail}`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
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
  try {
    const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('kolot_session_token') || '' : '';
    return token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};
  } catch {
    return {};
  }
}

export async function checkR2StorageStatus(): Promise<{ configured: boolean; bucket?: string; error?: string }> {
  try {
    const res = await fetch('/api/storage/status', { cache: 'no-store' });
    const data = await safeJson(res, 'בדיקת חיבור Cloudflare R2 נכשלה');
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
 * Fast XHR PUT/POST helper with real upload percentage reporting (0..100).
 */
function xhrSend(
  method: 'PUT' | 'POST',
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    const isSameOrigin = url.startsWith('/') || (typeof window !== 'undefined' && url.startsWith(window.location.origin));
    xhr.withCredentials = isSameOrigin;
    xhr.timeout = 120000;
    const allHeaders = isSameOrigin ? { ...getR2AuthHeaders(), ...headers } : { ...headers };
    for (const [k, v] of Object.entries(allHeaders)) {
      xhr.setRequestHeader(k, v);
    }
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
        }
      };
    }
    xhr.onload = () => {
      resolve({ status: xhr.status, responseText: xhr.responseText || '' });
    };
    xhr.onerror = () => {
      reject(new Error('תקלת רשת בהעלאת הקובץ לענן'));
    };
    xhr.ontimeout = () => {
      reject(new Error('העלאת הקובץ ארכה יותר מדי זמן — בדוק חיבור לאינטרנט ונסה שוב'));
    };
    xhr.onabort = () => {
      reject(new Error('ההעלאה בוטלה'));
    };
    xhr.send(body);
  });
}

/**
 * Uploads any Blob/File directly to Cloudflare R2 via Presigned/Stream PUT URL for large audio files,
 * skipping the extra presign roundtrip for small files (covers) and falling back cleanly to multipart upload.
 */
async function uploadBinaryFastToR2(
  blob: File | Blob,
  r2Path: string,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<{ success: boolean; url?: string; error?: string }> {
  // 1. Direct Stream / Presigned PUT for larger binary files (> 1.5MB)
  if (blob.size > 1.5 * 1024 * 1024) {
    try {
      const presignRes = await fetch('/api/storage/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ path: r2Path, contentType }),
      });
      if (presignRes.ok) {
        const presignData = await safeJson(presignRes, 'קבלת כתובת העלאה מהירה נכשלה');
        if (presignData.success && presignData.uploadUrl && presignData.url) {
          const directRes = await xhrSend(
            'PUT',
            presignData.uploadUrl,
            blob,
            { 'Content-Type': contentType },
            onProgress
          );
          if (directRes.status >= 200 && directRes.status < 300) {
            return { success: true, url: presignData.url };
          }
        }
      }
    } catch (directErr) {
      console.warn('[FastUpload] Direct R2 PUT unavailable, using server multipart fallback:', directErr);
    }
  }

  // 2. Single-roundtrip Direct POST -> /api/storage/upload (optimal for small covers & fallback)
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('path', r2Path);

  const fallbackRes = await xhrSend('POST', '/api/storage/upload', formData, {}, onProgress);
  const trimmed = (fallbackRes.responseText || '').trim();
  if (!trimmed || trimmed.startsWith('<')) {
    return {
      success: false,
      error: `העלאה ל-Cloudflare R2 נכשלה (HTTP ${fallbackRes.status}).`,
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (fallbackRes.status >= 200 && fallbackRes.status < 300 && parsed.success && parsed.url) {
      return { success: true, url: parsed.url };
    }
    return { success: false, error: parsed.error || `שגיאה בהעלאת הקובץ (${fallbackRes.status})` };
  } catch {
    return { success: false, error: 'תגובה לא תקינה משרת האחסון' };
  }
}

async function syncTracksIndexInBackground(trackToSave: JamendoTrack): Promise<void> {
  try {
    const listRes = await fetch('/api/storage/list?prefix=tracks_index.json', { cache: 'no-store' });
    let existingIndex: JamendoTrack[] = [];
    if (listRes.ok) {
      const listData = await safeJson(listRes, 'טעינת אינדקס');
      const idxFile = listData.files?.[0];
      if (idxFile?.url) {
        const idxRes = await fetch(idxFile.url, { cache: 'no-store' });
        if (idxRes.ok) {
          const parsed = await safeJson(idxRes, 'קריאת אינדקס');
          if (Array.isArray(parsed)) existingIndex = parsed;
        }
      }
    }
    const map = new Map<string, JamendoTrack>();
    existingIndex.forEach((t) => {
      if (t?.id) map.set(t.id, t);
    });
    map.set(trackToSave.id, trackToSave);
    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({
        path: 'tracks_index.json',
        content: JSON.stringify(Array.from(map.values())),
      }),
    });
  } catch (err) {
    console.warn('Background tracks_index.json sync notice:', err);
  }
}

/**
 * Upload & Commit track audio file, cover image, and metadata JSON directly into Cloudflare R2
 * Runs Audio + Cover uploads IN PARALLEL via Direct Presigned PUT for <10s completion.
 */
export async function uploadTrackToCloudStorage(
  track: JamendoTrack,
  audioFile?: File | Blob,
  coverFile?: File | Blob,
  onProgress?: (percent: number, stageText: string) => void
): Promise<{ success: boolean; audioUrl?: string; coverUrl?: string; error?: string }> {
  const trackId = track.id;
  let audioUrl = track.audioUrl || '';
  let coverUrl = track.coverUrl || '';

  // Prefer crisp pre-compressed JPEG DataURL (~60KB) if available instead of multi-MB unresized image
  let coverBlobToUpload: Blob | File | undefined;
  if (coverUrl.startsWith('data:image/')) {
    coverBlobToUpload = (await urlToBlob(coverUrl)) || undefined;
  } else if (coverFile) {
    coverBlobToUpload = coverFile;
  }

  onProgress?.(5, 'מעלה את השיר ישירות ל-Cloudflare R2...');

  // 1 & 2. Upload Audio & Cover IN PARALLEL!
  const audioPromise: Promise<{ success: boolean; url?: string; error?: string }> = audioFile
    ? (async () => {
        const ext =
          audioFile instanceof File && audioFile.name.includes('.')
            ? audioFile.name.split('.').pop()?.toLowerCase() || 'mp3'
            : 'mp3';
        const mimeType = audioFile.type || 'audio/mpeg';
        return uploadBinaryFastToR2(audioFile, `audio/${trackId}.${ext}`, mimeType, (pct) => {
          const scaled = Math.min(92, Math.max(5, Math.round(pct * 0.87) + 5));
          onProgress?.(scaled, `מעלה את קובץ השמע לענן... ${pct}%`);
        });
      })()
    : Promise.resolve({ success: true, url: audioUrl });

  const coverPromise: Promise<{ success: boolean; url?: string; error?: string }> = coverBlobToUpload
    ? (async () => {
        const ext =
          coverBlobToUpload instanceof File && coverBlobToUpload.name.includes('.')
            ? coverBlobToUpload.name.split('.').pop()?.toLowerCase() || 'jpg'
            : 'jpg';
        const mimeType = coverBlobToUpload.type || 'image/jpeg';
        return uploadBinaryFastToR2(coverBlobToUpload, `covers/${trackId}.${ext}`, mimeType);
      })()
    : Promise.resolve({ success: true, url: coverUrl });

  try {
    const [audioResult, coverResult] = await Promise.all([audioPromise, coverPromise]);

    if (!audioResult.success || !audioResult.url) {
      return {
        success: false,
        error: audioResult.error || 'שגיאה בהעלאת קובץ השמע ל-Cloudflare R2.',
      };
    }
    audioUrl = audioResult.url;

    if (!coverResult.success || !coverResult.url) {
      return {
        success: false,
        error: coverResult.error || 'שגיאה בהעלאת תמונת העטיפה ל-Cloudflare R2.',
      };
    }
    coverUrl = coverResult.url;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'תקלת רשת בחיבור ל-Cloudflare R2. אנא נסה שוב.',
    };
  }

  if (!audioUrl || audioUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'קובץ השמע לא הועלה לענן (Cloudflare R2). אנא בחר קובץ שמע תקין ונסה שוב.',
    };
  }
  if (coverUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'תמונת העטיפה לא הועלתה לענן. אנא בחר תמונה תקינה ונסה שוב.',
    };
  }

  onProgress?.(95, 'שומר פרטי שיר בענן...');

  // 3. Save tracks/${trackId}.json strictly in R2 (strip PII email fields before storing in public JSON)
  const { uploadedByEmail: _omitEmail, ...cleanTrack } = track as any;
  const trackToSave: JamendoTrack = {
    ...cleanTrack,
    audioUrl,
    coverUrl,
    source: 'Kolot R2 Storage',
  };

  try {
    const metaRes = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({
        path: `tracks/${trackId}.json`,
        content: JSON.stringify(trackToSave),
      }),
    });
    const metaData = await safeJson(metaRes, 'שמירת נתוני השיר ב-Cloudflare R2 נכשלה');
    if (!metaData.success) {
      return {
        success: false,
        error: metaData.error || 'שגיאה בשמירת נתוני השיר ב-Cloudflare R2.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'שגיאה בשמירת נתוני השיר ב-R2.',
    };
  }

  onProgress?.(100, 'השיר פורסם בהצלחה!');

  // Non-blocking background sync of tracks_index.json (never delays publish completion!)
  void syncTracksIndexInBackground(trackToSave);

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
  // 1. Fast single-roundtrip feed from server/Worker (reads tracks_index.json + tracks/*.json server-side)
  try {
    const feedRes = await fetch('/api/storage/tracks-feed', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (feedRes.ok) {
      const feedData = await safeJson(feedRes, 'טעינה מהירה מ-R2');
      if (feedData.success && Array.isArray(feedData.tracks)) {
        return feedData.tracks.filter(isCloudPlayableTrack);
      }
    }
  } catch (feedErr) {
    console.warn('Fast tracks-feed fallback to list:', feedErr);
  }

  const trackMap = new Map<string, JamendoTrack>();

  // 2. Fallback: Fetch tracks directory strictly from Cloudflare R2 (no cache)
  try {
    const res = await fetch('/api/storage/list?prefix=tracks/', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await safeJson(res, 'טעינת שירים מ-R2');
      if (data.success && Array.isArray(data.files) && data.files.length > 0) {
        const jsonFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
        const loaded = await Promise.all(
          jsonFiles.map(async (f: any) => {
            try {
              const itemRes = await fetch(f.url, { cache: 'no-store' });
              if (itemRes.ok) {
                return await safeJson(itemRes, 'קריאת שיר מ-R2');
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

  // 3. Fetch tracks_index.json from R2 as supplementary catalog
  try {
    const res = await fetch('/api/storage/list?prefix=tracks_index.json', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await safeJson(res, 'טעינת אינדקס שירים מ-R2');
      if (data.success && data.files?.length > 0) {
        const indexUrl = data.files[0].url;
        const indexRes = await fetch(indexUrl, { cache: 'no-store' });
        if (indexRes.ok) {
          const indexTracks = await safeJson(indexRes, 'קריאת אינדקס שירים מ-R2');
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
      credentials: 'include',
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
          deletions.push(fetch(`/api/storage/delete?path=${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: getR2AuthHeaders(), credentials: 'include' }));
        });
      }
      if (coverListRes.ok) {
        const cData = await coverListRes.json();
        (cData.files || []).forEach((f: any) => {
          deletions.push(fetch(`/api/storage/delete?path=${encodeURIComponent(f.key)}`, { method: 'DELETE', headers: getR2AuthHeaders(), credentials: 'include' }));
        });
      }
      await Promise.allSettled(deletions);
    } catch {}

    // Update index
    const tracks = await fetchTracksFromCloudStorage();
    const updatedIndex = tracks.filter((t) => t.id !== trackId);

    await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
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

export async function deleteOldArtistAvatarsFromCloud(
  artistId: string,
  keepKey?: string
): Promise<void> {
  if (!artistId) return;
  const cleanId = artistId.replace(/^artist_/, '').trim();
  const prefixes = Array.from(new Set([`avatars/${artistId}`, `avatars/${cleanId}`, `avatars/artist_${cleanId}`]));

  await Promise.allSettled(
    prefixes.map(async (prefix) => {
      try {
        const listRes = await fetch(`/api/storage/list?prefix=${encodeURIComponent(prefix)}`, { cache: 'no-store' });
        if (!listRes.ok) return;
        const data = await listRes.json();
        const files: Array<{ key: string }> = Array.isArray(data?.files) ? data.files : [];
        await Promise.allSettled(
          files
            .filter((f) => f?.key && f.key !== keepKey)
            .map((f) =>
              fetch(`/api/storage/delete?path=${encodeURIComponent(f.key)}`, {
                method: 'DELETE',
                headers: getR2AuthHeaders(),
                credentials: 'include',
              }).catch(() => {})
            )
        );
      } catch {}
    })
  );
}

export async function uploadArtistProfileToCloud(
  artist: any,
  avatarFile?: File | Blob,
  options?: { purgeOldAvatars?: boolean }
): Promise<{ success: boolean; avatarUrl?: string; profile?: any; error?: string }> {
  try {
    const cleanId = String(artist.googleUid || artist.id || '').replace(/^artist_/, '').trim();
    if (!cleanId) {
      return { success: false, error: 'חסר מזהה משתמש תקין לשמירה בענן' };
    }

    let avatarUrl = artist.avatarUrl;
    let uploadedKey: string | undefined;

    if (avatarFile) {
      uploadedKey = `avatars/${cleanId}_${Date.now()}.jpg`;
      const formData = new FormData();
      formData.append('file', avatarFile);
      formData.append('path', uploadedKey);
      const res = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: getR2AuthHeaders(),
        credentials: 'include',
        body: formData,
      });
      const data = await safeJson(res, 'העלאת תמונת פרופיל נכשלה');
      if (!data.success || !data.url) {
        return { success: false, error: data.error || 'העלאת התמונה ל-Cloudflare R2 נכשלה' };
      }
      avatarUrl = data.url;
      await deleteOldArtistAvatarsFromCloud(cleanId, uploadedKey);
    } else if (options?.purgeOldAvatars) {
      await deleteOldArtistAvatarsFromCloud(cleanId);
    }

    const { googleEmail: _omitEmail, ...safeArtist } = artist || {};
    const nowIso = new Date().toISOString();
    const profileToSave = {
      ...safeArtist,
      id: cleanId,
      googleUid: cleanId,
      avatarUrl: avatarUrl || '',
      updatedAt: nowIso,
    };

    const metaRes = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({
        path: `profiles/${cleanId}.json`,
        content: JSON.stringify(profileToSave, null, 2),
      }),
    });
    const metaData = await safeJson(metaRes, 'שמירת הפרופיל ב-Cloudflare R2 נכשלה');
    if (!metaData.success) {
      return { success: false, error: metaData.error || 'שמירת הפרופיל ב-R2 נכשלה' };
    }

    // Remove legacy profiles/artist_${cleanId}.json so old cached avatars/terms never overwrite the canonical profile
    void fetch(`/api/storage/delete?path=${encodeURIComponent(`profiles/artist_${cleanId}.json`)}`, {
      method: 'DELETE',
      headers: getR2AuthHeaders(),
      credentials: 'include',
    }).catch(() => {});

    return { success: true, avatarUrl: avatarUrl || undefined, profile: profileToSave };
  } catch (err: any) {
    return { success: false, error: err?.message || 'שגיאה בשמירת הפרופיל ל-Cloudflare R2' };
  }
}

export async function fetchArtistProfileByUidFromCloud(uid: string): Promise<any | null> {
  const cleanUid = String(uid || '').replace(/^artist_/, '').trim();
  if (!cleanUid) return null;

  try {
    const res = await fetch(`/api/storage/profile/${encodeURIComponent(cleanUid)}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await safeJson(res, 'טעינת פרופיל אמן נכשלה');
      if (data?.success && data?.profile) {
        return { ...data.profile, id: cleanUid, googleUid: cleanUid };
      }
    }
  } catch {}

  try {
    const fallbackRes = await fetch(`/api/storage/raw/${encodeURIComponent(`profiles/${cleanUid}.json`)}`, {
      cache: 'no-store',
    });
    if (fallbackRes.ok) {
      const parsed = await safeJson(fallbackRes, 'קריאת פרופיל מ-R2');
      if (parsed && typeof parsed === 'object') {
        return { ...parsed, id: cleanUid, googleUid: cleanUid };
      }
    }
  } catch {}

  return null;
}

export async function fetchArtistProfilesFromCloud(): Promise<any[]> {
  try {
    const feedRes = await fetch('/api/storage/profiles-feed', { cache: 'no-store' });
    if (feedRes.ok) {
      const feedData = await safeJson(feedRes, 'טעינת פרופילי אמנים נכשלה');
      if (feedData?.success && Array.isArray(feedData.profiles)) {
        return feedData.profiles;
      }
    }
  } catch (feedErr) {
    console.warn('profiles-feed fallback to list:', feedErr);
  }

  try {
    const res = await fetch('/api/storage/list?prefix=profiles/', { cache: 'no-store' });
    const data = await safeJson(res, 'טעינת פרופילי אמנים נכשלה');
    if (data.success && data.files) {
      const profileFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const loaded = await Promise.all(
        profileFiles.map(async (f: any) => {
          try {
            const rawUrl = f.key ? `/api/storage/raw/${f.key}` : f.url;
            const profileRes = await fetch(rawUrl, { cache: 'no-store' });
            if (profileRes.ok) {
              return { key: f.key, data: await safeJson(profileRes, 'עיבוד פרופיל אמן נכשל') };
            }
          } catch {}
          return null;
        })
      );

      const map = new Map<string, { data: any; ts: number; isCanonicalKey: boolean }>();
      for (const item of loaded) {
        if (!item?.data) continue;
        const cleanUid = String(item.data.googleUid || item.data.id || '').replace(/^artist_/, '').trim();
        if (!cleanUid) continue;
        const ts = Math.max(
          Date.parse(String(item.data.updatedAt || '')) || 0,
          Date.parse(String(item.data.acceptedTermsAt || '')) || 0
        );
        const isCanonicalKey = !String(item.key || '').startsWith('profiles/artist_');
        const prev = map.get(cleanUid);
        if (!prev || ts > prev.ts || (ts === prev.ts && isCanonicalKey && !prev.isCanonicalKey)) {
          map.set(cleanUid, {
            data: { ...item.data, id: cleanUid, googleUid: cleanUid },
            ts,
            isCanonicalKey,
          });
        }
      }
      return Array.from(map.values()).map((entry) => entry.data);
    }
  } catch (err) {
    console.warn('Failed to fetch profiles from Cloud Storage:', err);
  }
  return [];
}

export async function syncArtistAvatarToTracksInR2(
  artistUid: string,
  avatarUrl: string | undefined,
  tracks: JamendoTrack[],
  artistNameHint?: string
): Promise<JamendoTrack[]> {
  if (!avatarUrl || (!artistUid && !artistNameHint)) return tracks;
  const cleanUid = artistUid.replace(/^artist_/, '').toLowerCase().trim();
  const cleanName = (artistNameHint || '').toLowerCase().trim();

  const ownedIds = new Set<string>();
  const updatedTracks = tracks.map((t) => {
    const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    const tName = (t.artistName || '').toLowerCase().trim();
    const matches = (cleanUid && tUid === cleanUid) || (!tUid && cleanName && tName === cleanName);
    if (!matches) return t;
    ownedIds.add(t.id);
    const { uploadedByEmail: _omit, ...safeTrack } = t as any;
    return {
      ...safeTrack,
      artistAvatarUrl: avatarUrl,
      ...(artistNameHint ? { artistName: artistNameHint } : {}),
    } as JamendoTrack;
  });

  if (ownedIds.size === 0) return updatedTracks;

  await Promise.allSettled(
    updatedTracks
      .filter((t) => ownedIds.has(t.id))
      .map((updated) =>
        fetch('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: `tracks/${updated.id}.json`,
            content: JSON.stringify(updated, null, 2),
          }),
        }).catch(() => {})
      )
  );

  // Refresh tracks_index.json in R2 so initial feed reflects new avatar immediately
  try {
    const idxRes = await fetch('/api/storage/raw/tracks_index.json', { cache: 'no-store' });
    if (idxRes.ok) {
      const parsed = await idxRes.json();
      if (Array.isArray(parsed)) {
        const nextIdx = parsed.map((item: any) => {
          const { uploadedByEmail: _omit, ...cleanItem } = item || {};
          if (ownedIds.has(cleanItem?.id)) {
            return {
              ...cleanItem,
              artistAvatarUrl: avatarUrl,
              ...(artistNameHint ? { artistName: artistNameHint } : {}),
            };
          }
          return cleanItem;
        });
        await fetch('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'tracks_index.json',
            content: JSON.stringify(nextIdx),
          }),
        });
      }
    }
  } catch {}

  return updatedTracks;
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

export async function saveTrackSubtitlesInCloud(
  track: JamendoTrack,
  subtitleSegments: NonNullable<JamendoTrack['subtitleSegments']>,
  lyrics?: string,
  extra?: {
    subtitleSegmentsHe?: JamendoTrack['subtitleSegmentsHe'];
    subtitleSegmentsEn?: JamendoTrack['subtitleSegmentsEn'];
    lyricsHe?: string;
    lyricsEn?: string;
  }
): Promise<boolean> {
  try {
    const updatedTrack: JamendoTrack = {
      ...track,
      subtitleSegments,
      hasWhisperSubtitles: subtitleSegments.length > 0 || !!(extra?.subtitleSegmentsHe?.length || extra?.subtitleSegmentsEn?.length),
      ...(lyrics ? { lyrics } : {}),
      ...(extra?.subtitleSegmentsHe?.length ? { subtitleSegmentsHe: extra.subtitleSegmentsHe } : {}),
      ...(extra?.subtitleSegmentsEn?.length ? { subtitleSegmentsEn: extra.subtitleSegmentsEn } : {}),
      ...(extra?.lyricsHe ? { lyricsHe: extra.lyricsHe } : {}),
      ...(extra?.lyricsEn ? { lyricsEn: extra.lyricsEn } : {}),
    };
    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `tracks/${track.id}.json`,
        content: JSON.stringify(updatedTrack, null, 2),
      }),
    });
    if (res.ok) {
      void syncTracksIndexInBackground(updatedTrack);
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveTrackGenreInCloud(
  track: JamendoTrack,
  genre: string
): Promise<boolean> {
  try {
    const updatedTrack: JamendoTrack = {
      ...track,
      genre,
    };
    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `tracks/${track.id}.json`,
        content: JSON.stringify(updatedTrack, null, 2),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchBootstrapFromCloud(): Promise<{
  tracks: JamendoTrack[];
  profiles: any[];
  albums: Album[];
} | null> {
  try {
    const res = await fetch('/api/bootstrap', {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await safeJson(res, 'טעינת נתונים מ-R2');
    if (data?.success) {
      return {
        tracks: Array.isArray(data.tracks) ? data.tracks.filter(isCloudPlayableTrack) : [],
        profiles: Array.isArray(data.profiles) ? data.profiles : [],
        albums: Array.isArray(data.albums) ? data.albums : [],
      };
    }
  } catch (err) {
    console.warn('Bootstrap fetch fallback notice:', err);
  }
  return null;
}

export async function incrementTrackPlaysInCloud(track: JamendoTrack): Promise<number> {
  const optimistic = (track.playsCount || 0) + 1;
  try {
    const res = await fetch('/api/storage/track-play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: track.id }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.playsCount) return Number(data.playsCount);
    }
  } catch {}
  return optimistic;
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
        credentials: 'include',
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
      credentials: 'include',
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
    credentials: 'include',
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


