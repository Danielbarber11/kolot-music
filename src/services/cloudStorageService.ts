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
    throw new Error(`${context}: השרת החזיר תגובה ריקה (HTTP ${res.status}). ודא ששרת האחסון זמין.`);
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
    const data = await safeJson(res, 'בדיקת חיבור האחסון נכשלה');
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
export async function uploadBinaryFastToR2(
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
      error: `ההעלאה לאחסון הענן נכשלה (HTTP ${fallbackRes.status}).`,
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
    let existingIndex: JamendoTrack[] = [];
    const idxRes = await fetch(`/api/storage/raw/tracks_index.json?_t=${Date.now()}`, {
      headers: getR2AuthHeaders(),
      cache: 'no-store',
    });
    if (idxRes.ok) {
      const parsed = await safeJson(idxRes, 'קריאת אינדקס');
      if (Array.isArray(parsed)) existingIndex = parsed;
    }
    const map = new Map<string, JamendoTrack>();
    existingIndex.forEach((t) => {
      if (t?.id) map.set(t.id, t);
    });
    const prev = map.get(trackToSave.id);
    map.set(trackToSave.id, {
      ...trackToSave,
      viewsCount: Math.max(Number(prev?.viewsCount) || 0, Number(trackToSave.viewsCount) || 0),
      playsCount: Math.max(Number(prev?.playsCount) || 0, Number(trackToSave.playsCount) || 0),
    });
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

  onProgress?.(5, 'מעלה את השיר לאחסון האתר...');

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
        error: audioResult.error || 'שגיאה בהעלאת קובץ השמע לאחסון הענן.',
      };
    }
    audioUrl = audioResult.url;

    if (!coverResult.success || !coverResult.url) {
      return {
        success: false,
        error: coverResult.error || 'שגיאה בהעלאת תמונת העטיפה לאחסון הענן.',
      };
    }
    coverUrl = coverResult.url;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'תקלת רשת בחיבור לאחסון הענן. אנא נסה שוב.',
    };
  }

  if (!audioUrl || audioUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'קובץ השמע לא הועלה לענן. אנא בחר קובץ שמע תקין ונסה שוב.',
    };
  }
  if (coverUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'תמונת העטיפה לא הועלתה לענן. אנא בחר תמונה תקינה ונסה שוב.',
    };
  }

  onProgress?.(95, 'שומר פרטי שיר בענן...');

  // Save tracks/${trackId}.json (strip PII email fields before storing in public JSON)
  const { uploadedByEmail: _omitEmail, ...cleanTrack } = track as any;
  const trackToSave: JamendoTrack = {
    ...cleanTrack,
    audioUrl,
    coverUrl,
    source: 'Kolot Cloud Storage',
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
    const metaData = await safeJson(metaRes, 'שמירת נתוני השיר בענן נכשלה');
    if (!metaData.success) {
      return {
        success: false,
        error: metaData.error || 'שגיאה בשמירת נתוני השיר באחסון הענן.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'שגיאה בשמירת נתוני השיר באחסון הענן.',
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
  const bust = Date.now();
  // 1. Fast single-roundtrip feed from server/Worker (reads tracks/*.json directly server-side)
  try {
    const feedRes = await fetch(`/api/storage/tracks-feed?_t=${bust}`, {
      headers: { ...getR2AuthHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (feedRes.ok) {
      const feedData = await safeJson(feedRes, 'טעינה מהירה מהענן');
      if (feedData.success && Array.isArray(feedData.tracks)) {
        return feedData.tracks.filter(isCloudPlayableTrack);
      }
    }
  } catch (feedErr) {
    console.warn('Fast tracks-feed fallback to list:', feedErr);
  }

  const trackMap = new Map<string, JamendoTrack>();

  // 2. Fallback: Fetch tracks directory strictly from cloud storage (no cache)
  try {
    const res = await fetch(`/api/storage/list?prefix=tracks/&_t=${bust}`, {
      headers: { ...getR2AuthHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await safeJson(res, 'טעינת שירים מהענן');
      if (data.success && Array.isArray(data.files) && data.files.length > 0) {
        const jsonFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
        const loaded = await Promise.all(
          jsonFiles.map(async (f: any) => {
            try {
              const rawUrl = f.key ? `/api/storage/raw/${f.key}?_t=${bust}` : `${f.url}?_t=${bust}`;
              const itemRes = await fetch(rawUrl, { cache: 'no-store' });
              if (itemRes.ok) {
                return await safeJson(itemRes, 'קריאת שיר מהענן');
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
    console.warn('Failed to list tracks/ from storage:', err);
  }

  // 3. Fetch tracks_index.json from cloud storage as supplementary catalog
  try {
    const indexRes = await fetch(`/api/storage/raw/tracks_index.json?_t=${bust}`, {
      headers: { ...getR2AuthHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (indexRes.ok) {
      const indexTracks = await safeJson(indexRes, 'קריאת אינדקס שירים מהענן');
      if (Array.isArray(indexTracks)) {
        indexTracks.filter(isCloudPlayableTrack).forEach((t: JamendoTrack) => {
          if (!trackMap.has(t.id)) {
            trackMap.set(t.id, t);
          }
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch tracks_index.json from R2:', err);
  }

  return Array.from(trackMap.values());
}

export type SingleTrackStatusResult =
  | { status: 'found'; track: JamendoTrack }
  | { status: 'deleted' }
  | { status: 'error' };

export async function fetchSingleTrackStatusFromCloud(trackId: string): Promise<SingleTrackStatusResult> {
  const cleanId = String(trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!cleanId) return { status: 'deleted' };
  try {
    const res = await fetch(`/api/storage/track/${encodeURIComponent(cleanId)}?_t=${Date.now()}`, {
      headers: { ...getR2AuthHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.status === 404) {
      return { status: 'deleted' };
    }
    if (!res.ok) {
      return { status: 'error' };
    }
    const data = await safeJson(res, 'טעינת שיר');
    if (data?.success && data.track && isCloudPlayableTrack(data.track)) {
      return { status: 'found', track: data.track as JamendoTrack };
    }
    return { status: 'deleted' };
  } catch {
    return { status: 'error' };
  }
}

export async function fetchSingleTrackFromCloud(trackId: string): Promise<JamendoTrack | null> {
  const result = await fetchSingleTrackStatusFromCloud(trackId);
  return result.status === 'found' ? result.track : null;
}

export async function deleteTrackFromCloudStorage(trackId: string): Promise<boolean> {
  try {
    // Clean up associated audio & cover objects in R2 BEFORE deleting tracks/<id>.json so server ownership checks verify against track metadata
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

    // Delete track metadata JSON
    await fetch(`/api/storage/delete?path=${encodeURIComponent(`tracks/${trackId}.json`)}`, {
      method: 'DELETE',
      headers: getR2AuthHeaders(),
      credentials: 'include',
    });

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
        return { success: false, error: data.error || 'העלאת התמונה לענן נכשלה' };
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
    const metaData = await safeJson(metaRes, 'שמירת הפרופיל בענן נכשלה');
    if (!metaData.success) {
      return { success: false, error: metaData.error || 'שמירת הפרופיל בענן נכשלה' };
    }

    // Remove legacy profiles/artist_${cleanId}.json so old cached avatars/terms never overwrite the canonical profile
    void fetch(`/api/storage/delete?path=${encodeURIComponent(`profiles/artist_${cleanId}.json`)}`, {
      method: 'DELETE',
      headers: getR2AuthHeaders(),
      credentials: 'include',
    }).catch(() => {});

    return { success: true, avatarUrl: avatarUrl || undefined, profile: profileToSave };
  } catch (err: any) {
    return { success: false, error: err?.message || 'שגיאה בשמירת הפרופיל בענן' };
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
      const parsed = await safeJson(fallbackRes, 'קריאת פרופיל מהענן');
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
  if ((!avatarUrl && !artistNameHint) || (!artistUid && !artistNameHint)) return tracks;
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
      ...(avatarUrl !== undefined ? { artistAvatarUrl: avatarUrl } : {}),
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
          headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
          credentials: 'include',
          body: JSON.stringify({
            path: `tracks/${updated.id}.json`,
            content: JSON.stringify(updated, null, 2),
          }),
        }).catch(() => {})
      )
  );

  // Refresh tracks_index.json so initial feed reflects new avatar immediately
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
              ...(avatarUrl !== undefined ? { artistAvatarUrl: avatarUrl } : {}),
              ...(artistNameHint ? { artistName: artistNameHint } : {}),
            };
          }
          return cleanItem;
        });
        await fetch('/api/storage/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
          credentials: 'include',
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

export async function updateTrackColorInCloud(trackId: string, bgColor: string, _fullTrack: JamendoTrack): Promise<boolean> {
  try {
    const cleanId = (trackId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || !bgColor) return false;
    const res = await fetch('/api/storage/track-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ trackId: cleanId, bgColor }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveTrackSubtitlesInCloud(
  track: JamendoTrack,
  subtitleSegments: NonNullable<JamendoTrack['subtitleSegments']>,
  lyrics?: string,
  extra?: {
    subtitleSegmentsHe?: JamendoTrack['subtitleSegmentsHe'];
    subtitleSegmentsEn?: JamendoTrack['subtitleSegmentsEn'];
    subtitleSegmentsOrig?: JamendoTrack['subtitleSegmentsOrig'];
    lyricsHe?: string;
    lyricsEn?: string;
    lyricsOrig?: string;
    detectedLanguageCode?: string;
    detectedLanguageLabel?: string;
  }
): Promise<boolean> {
  try {
    const updatedTrack: JamendoTrack = {
      ...track,
      subtitleSegments,
      hasWhisperSubtitles:
        subtitleSegments.length > 0 ||
        !!(extra?.subtitleSegmentsHe?.length || extra?.subtitleSegmentsEn?.length || extra?.subtitleSegmentsOrig?.length),
      ...(lyrics ? { lyrics } : {}),
      ...(extra?.subtitleSegmentsHe?.length ? { subtitleSegmentsHe: extra.subtitleSegmentsHe } : {}),
      ...(extra?.subtitleSegmentsEn?.length ? { subtitleSegmentsEn: extra.subtitleSegmentsEn } : {}),
      ...(extra?.subtitleSegmentsOrig?.length ? { subtitleSegmentsOrig: extra.subtitleSegmentsOrig } : {}),
      ...(extra?.lyricsHe ? { lyricsHe: extra.lyricsHe } : {}),
      ...(extra?.lyricsEn ? { lyricsEn: extra.lyricsEn } : {}),
      ...(extra?.lyricsOrig ? { lyricsOrig: extra.lyricsOrig } : {}),
      ...(extra?.detectedLanguageCode ? { detectedLanguageCode: extra.detectedLanguageCode } : {}),
      ...(extra?.detectedLanguageLabel ? { detectedLanguageLabel: extra.detectedLanguageLabel } : {}),
    };
    const res = await fetch('/api/storage/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
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

export async function saveGeneratedSubtitlesToCloud(
  trackId: string,
  subData: {
    segments: NonNullable<JamendoTrack['subtitleSegments']>;
    segmentsHe?: JamendoTrack['subtitleSegmentsHe'];
    segmentsEn?: JamendoTrack['subtitleSegmentsEn'];
    segmentsOrig?: JamendoTrack['subtitleSegmentsOrig'];
    lyrics?: string;
    lyricsHe?: string;
    lyricsEn?: string;
    lyricsOrig?: string;
    detectedLanguageCode?: string;
    detectedLanguageLabel?: string;
    subtitlesIncomplete?: boolean;
    subtitlesCompletedUpTo?: number;
    forceReplace?: boolean;
  }
): Promise<JamendoTrack | null> {
  try {
    const cleanId = (trackId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || !subData.segments.length) return null;
    const res = await fetch('/api/storage/track-subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({
        trackId: cleanId,
        subtitleSegments: subData.segments,
        subtitleSegmentsHe: subData.segmentsHe,
        subtitleSegmentsEn: subData.segmentsEn,
        subtitleSegmentsOrig: subData.segmentsOrig,
        lyrics: subData.lyrics,
        lyricsHe: subData.lyricsHe,
        lyricsEn: subData.lyricsEn,
        lyricsOrig: subData.lyricsOrig,
        detectedLanguageCode: subData.detectedLanguageCode,
        detectedLanguageLabel: subData.detectedLanguageLabel,
        subtitlesIncomplete: Boolean(subData.subtitlesIncomplete),
        subtitlesCompletedUpTo: Number(subData.subtitlesCompletedUpTo || 0),
        forceReplace: Boolean(subData.forceReplace),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data?.success && data.track) {
      return data.track as JamendoTrack;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveTrackGenreInCloud(
  track: JamendoTrack,
  genre: string
): Promise<boolean> {
  try {
    const cleanId = (track?.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || !genre) return false;
    const res = await fetch('/api/storage/track-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getR2AuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ trackId: cleanId, genre }),
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
    const res = await fetch(`/api/bootstrap?_t=${Date.now()}`, {
      headers: { ...getR2AuthHeaders(), 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await safeJson(res, 'טעינת נתונים מהענן');
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

const pendingTrackViewIncrements = new Map<string, Promise<number | null>>();

export function isTrackViewIncrementPending(trackId: string): boolean {
  return Boolean(trackId && pendingTrackViewIncrements.has(trackId));
}

export async function waitForPendingTrackViewIncrement(trackId: string): Promise<void> {
  const pending = pendingTrackViewIncrements.get(trackId);
  if (pending) {
    await pending.catch(() => {});
  }
}

export function incrementTrackViewsInCloud(track: JamendoTrack): Promise<number | null> {
  if (!track?.id) return Promise.resolve(null);
  const cleanId = track.id;
  const promise = (async (): Promise<number | null> => {
    try {
      const res = await fetch(`/api/storage/track-view?_t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        body: JSON.stringify({ trackId: cleanId }),
        keepalive: true,
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (data?.success && typeof data.viewsCount === 'number' && Number.isFinite(data.viewsCount)) {
        const committedViews = Number(data.viewsCount);
        const m = await import('./multiMusicService').catch(() => null);
        m?.syncTrackViewFromServer(cleanId, committedViews, true);
        return committedViews;
      }
    } catch {}
    return null;
  })().finally(() => {
    if (pendingTrackViewIncrements.get(cleanId) === promise) {
      pendingTrackViewIncrements.delete(cleanId);
    }
  });
  pendingTrackViewIncrements.set(cleanId, promise);
  return promise;
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
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'העלאת תמונת אלבום נכשלה' };
      }
      coverUrl = data.url;
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
    if (!metaRes.ok || !metaData.success) {
      return { success: false, error: metaData.error || 'שמירת אלבום בענן נכשלה' };
    }
    return { success: true, coverUrl };
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

export async function fetchAlbumsFromCloud(): Promise<Album[] | null> {
  try {
    const feedRes = await fetch(`/api/storage/albums-feed?_t=${Date.now()}`, {
      headers: getR2AuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    if (feedRes.ok) {
      const feedData = await safeJson(feedRes, 'טעינת אלבומים נכשלה');
      if (feedData.success && Array.isArray(feedData.albums)) {
        return feedData.albums.filter(Boolean);
      }
    }

    const res = await fetch('/api/storage/list?prefix=albums/', {
      headers: getR2AuthHeaders(),
      credentials: 'include',
      cache: 'no-store',
    });
    const data = await safeJson(res, 'טעינת רשימת אלבומים נכשלה');
    if (data.success && data.files) {
      const albumFiles = data.files.filter((f: any) => f.key.endsWith('.json'));
      const albums = await Promise.all(
        albumFiles.map(async (f: any) => {
          try {
            const albumRes = await fetch(getStreamingMediaUrl(f.url) || f.url, { cache: 'no-store' });
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
  return null;
}


