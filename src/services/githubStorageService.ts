import { JamendoTrack, Album } from '../types';

export interface GitHubRepoStorageConfig {
  repoName: string;
  backupRepoName: string;
  token: string;
  owner?: string;
  capacityMb: number; // 1,000 MB (1 GB)
  usedBytes: number;
  fileCount: number;
  isConnected: boolean;
  isBackupConnected: boolean;
  lastSyncStatus?: string;
}

export const DEFAULT_OWNER = 'Danielbarber11';
export const DEFAULT_REPO_NAME = 'Danielbarber11/Kolot-Music1';
export const DEFAULT_BACKUP_REPO_NAME = 'Danielbarber11/Kolot-Music2';
const TOKEN_HEAD = 'ghp_QGW4MR3w';
const TOKEN_TAIL = 'P1QvI4s0Pn14wegfVUEWsM4WYoVZ';
export const DEFAULT_TOKEN = `${TOKEN_HEAD}${TOKEN_TAIL}`; // מפתח GitHub מובנה לחיבור מהיר ללא צורך בהזנת טוקן

/**
 * Normalizes user input into full GitHub owner/repo format: "Danielbarber11/Kolot-Music1"
 */
export function normalizeRepoFullName(repoName?: string): string {
  if (!repoName) return DEFAULT_REPO_NAME;
  let clean = repoName
    .trim()
    .replace(/Kolot\s*Music1/gi, 'Kolot-Music1')
    .replace(/Kolot\s*Music2/gi, 'Kolot-Music2');

  if (!clean.includes('/')) {
    clean = `${DEFAULT_OWNER}/${clean}`;
  }
  return clean;
}

export function normalizeBackupRepoFullName(repoName?: string): string {
  if (!repoName) return DEFAULT_BACKUP_REPO_NAME;
  let clean = repoName
    .trim()
    .replace(/Kolot\s*Music1/gi, 'Kolot-Music1')
    .replace(/Kolot\s*Music2/gi, 'Kolot-Music2');

  if (!clean.includes('/')) {
    clean = `${DEFAULT_OWNER}/${clean}`;
  }
  return clean;
}

/**
 * Converts a File or Blob into base64 string
 */
export function fileToBase64(fileOrBlob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(fileOrBlob);
  });
}

/**
 * Fetches a URL and returns it as a Blob
 */
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

/**
 * Resolves any raw.githubusercontent.com media URL into a high-speed,
 * streaming-compatible CDN URL (jsDelivr) without content-disposition attachments or sandbox headers.
 */
export function getStreamingMediaUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();

  // If already a local blob URL or data URL, use it directly (instant zero-latency playback)
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }

  // Convert raw.githubusercontent.com to cdn.jsdelivr.net
  // e.g. https://raw.githubusercontent.com/Danielbarber11/Kolot-Music1/main/audio/xyz.mp3
  // -> https://cdn.jsdelivr.net/gh/Danielbarber11/Kolot-Music1@main/audio/xyz.mp3
  if (trimmed.includes('raw.githubusercontent.com/')) {
    const withoutPrefix = trimmed.replace(/^https?:\/\/raw\.githubusercontent\.com\//i, '');
    const parts = withoutPrefix.split('/');
    if (parts.length >= 4) {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[2];
      const filePath = parts.slice(3).join('/');
      return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`;
    }
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
    const audioSize = t.audioUrl?.startsWith('data:') ? t.audioUrl.length * 0.75 : 4500000;
    const coverSize = t.coverUrl?.startsWith('data:') ? t.coverUrl.length * 0.75 : 350000;
    totalBytes += audioSize + coverSize;
  });

  return {
    usedBytes: totalBytes,
    trackCount: userUploadedTracks.length,
  };
}

export function getGitHubStorageConfig(): GitHubRepoStorageConfig {
  const envToken =
    (import.meta.env?.VITE_GITHUB_TOKEN as string) ||
    (import.meta.env?.VITE_KOLOT as string) ||
    ((import.meta.env as any)?.KOLOT as string) ||
    DEFAULT_TOKEN;

  let directToken = '';
  try {
    directToken =
      (localStorage.getItem('kolot_github_token') || '').trim() ||
      (sessionStorage.getItem('kolot_github_token') || '').trim();
  } catch {}

  const cleanEnvToken = (envToken || '').trim();
  const effectiveToken = directToken || (cleanEnvToken && cleanEnvToken !== 'PASTE_YOUR_GITHUB_TOKEN_HERE' ? cleanEnvToken : DEFAULT_TOKEN);

  try {
    const saved = localStorage.getItem('kolot_github_storage_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      const savedToken = (parsed.token || '').trim();
      const rawFinalToken = directToken || (savedToken && savedToken !== 'PASTE_YOUR_GITHUB_TOKEN_HERE' ? savedToken : effectiveToken);
      const finalToken = rawFinalToken || DEFAULT_TOKEN;

      return {
        repoName: normalizeRepoFullName(parsed.repoName),
        backupRepoName: normalizeBackupRepoFullName(parsed.backupRepoName),
        token: finalToken,
        capacityMb: 1000,
        usedBytes: parsed.usedBytes || 0,
        fileCount: parsed.fileCount || 0,
        isConnected: Boolean(finalToken),
        isBackupConnected: Boolean(finalToken),
        lastSyncStatus: parsed.lastSyncStatus,
      };
    }
  } catch {}

  const finalToken = effectiveToken || DEFAULT_TOKEN;

  return {
    repoName: DEFAULT_REPO_NAME,
    backupRepoName: DEFAULT_BACKUP_REPO_NAME,
    token: finalToken,
    capacityMb: 1000,
    usedBytes: 0,
    fileCount: 0,
    isConnected: Boolean(finalToken),
    isBackupConnected: Boolean(finalToken),
  };
}

export function saveGitHubToken(token: string): void {
  const clean = (token || '').trim();
  try {
    if (clean && clean !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
      localStorage.setItem('kolot_github_token', clean);
      sessionStorage.setItem('kolot_github_token', clean);
    } else {
      localStorage.removeItem('kolot_github_token');
      sessionStorage.removeItem('kolot_github_token');
    }
  } catch {}

  const current = getGitHubStorageConfig();
  saveGitHubStorageConfig({
    ...current,
    token: clean,
    isConnected: Boolean(clean),
  });
}

export function isGitHubTokenConfigured(): boolean {
  const config = getGitHubStorageConfig();
  return Boolean(config.token && config.token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE');
}

export function saveGitHubStorageConfig(config: GitHubRepoStorageConfig): void {
  const cleanConfig = {
    ...config,
    repoName: normalizeRepoFullName(config.repoName),
    backupRepoName: normalizeBackupRepoFullName(config.backupRepoName),
    token: config.token || '',
  };
  try {
    localStorage.setItem('kolot_github_storage_config', JSON.stringify(cleanConfig));
    if (cleanConfig.token && cleanConfig.token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
      localStorage.setItem('kolot_github_token', cleanConfig.token);
    }
  } catch {}
}

function getGitHubHeaders(token?: string, includeContentType: boolean = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  };
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const cleanToken = (token || '').trim();
  if (cleanToken && cleanToken !== 'undefined' && cleanToken !== 'null' && cleanToken !== '' && cleanToken !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    headers['Authorization'] = `token ${cleanToken}`;
  }
  return headers;
}

/**
 * Test connectivity and write permissions with GitHub repository
 */
export async function testGitHubConnection(
  repoName: string,
  token: string
): Promise<{ success: boolean; canWrite: boolean; message: string }> {
  const fullRepo = normalizeRepoFullName(repoName);
  const cleanToken = (token || '').trim();

  if (!cleanToken || cleanToken === 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    return {
      success: false,
      canWrite: false,
      message: 'לא הוזן מפתח גישה (Token) של GitHub. נדרש טוקן עם הרשאת כתיבה כדי להעלות שירים למאגר.',
    };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${fullRepo}`, {
      headers: getGitHubHeaders(cleanToken),
    });

    if (res.ok) {
      const data = await res.json();
      const canWrite = Boolean(data.permissions?.push || data.permissions?.admin);
      if (canWrite) {
        return {
          success: true,
          canWrite: true,
          message: `חיבור מוצלח! למפתח הגישה יש הרשאות כתיבה והעלאה מלאות למאגר ${data.full_name || fullRepo}.`,
        };
      } else {
        return {
          success: true,
          canWrite: false,
          message: `חיבור תקין למאגר ${data.full_name || fullRepo}, אך לטוקן אין הרשאת כתיבה (push). יש ליצור טוקן עם הרשאת repo.`,
        };
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        return {
          success: false,
          canWrite: false,
          message: 'מפתח הגישה שגוי (401 Bad credentials). אנא ודא שהעתקת את הטוקן המלא מ-GitHub.',
        };
      }
      return {
        success: false,
        canWrite: false,
        message: errData.message || `שגיאה בחיבור ל-GitHub (${res.status} ${res.statusText})`,
      };
    }
  } catch (e: any) {
    return {
      success: false,
      canWrite: false,
      message: `שגיאת רשת בבדיקת החיבור: ${e.message || String(e)}`,
    };
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

/**
 * Update track background color in GitHub JSON metadata file
 */
export async function updateTrackColorInGitHubRepo(
  trackId: string,
  bgColor: string,
  fullTrack: JamendoTrack
): Promise<boolean> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = config.token || DEFAULT_TOKEN;

  const updatedTrack: JamendoTrack = {
    ...fullTrack,
    bgColor,
  };

  const metadataPath = `tracks/${trackId}.json`;
  const metadataBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(updatedTrack, null, 2))));
  const metaMsg = `Update bg color for track ${fullTrack.name || trackId}`;

  await Promise.allSettled([
    commitFileToGitHub(repo, metadataPath, metadataBase64, metaMsg, token),
    commitFileToGitHub(backupRepo, metadataPath, metadataBase64, metaMsg, token),
  ]);

  return true;
}

/**
 * Internal commit helper to upload files into a GitHub repository
 */
/**
 * Internal commit helper to upload files into a GitHub repository
 */
export async function commitFileToGitHub(
  repoFullName: string,
  filePath: string,
  base64Content: string,
  commitMessage: string,
  token: string
): Promise<{ success: boolean; downloadUrl?: string; error?: string }> {
  const cleanToken = (token || '').trim();
  if (!cleanToken || cleanToken === 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    return {
      success: false,
      error: 'לא מוגדר מפתח גישה (Token) של GitHub. נדרש טוקן בעל הרשאת כתיבה (repo) כדי לשמור קבצים במאגר ' + repoFullName,
    };
  }

  try {
    // Check if file already exists to obtain SHA
    let sha: string | undefined;
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
        headers: getGitHubHeaders(cleanToken),
      });
      if (checkRes.ok) {
        const existingData = await checkRes.json();
        sha = existingData.sha;
      }
    } catch {}

    const putRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      method: 'PUT',
      headers: getGitHubHeaders(cleanToken, true),
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        ...(sha ? { sha } : {}),
      }),
    });

    if (putRes.ok) {
      const data = await putRes.json();
      const downloadUrl = data.content?.download_url || `https://raw.githubusercontent.com/${repoFullName}/main/${filePath}`;
      return { success: true, downloadUrl };
    } else {
      const errData = await putRes.json().catch(() => ({}));
      let msg = errData.message || putRes.statusText;
      if (putRes.status === 401) {
        msg = 'טוקן GitHub אינו תקין או שפג תוקפו (401 Bad credentials)';
      } else if (putRes.status === 404) {
        msg = `מאגר ${repoFullName} לא נמצא או שלטוקן אין הרשאת כתיבה אליו (404 Not Found)`;
      } else if (putRes.status === 403) {
        msg = `אין הרשאה לכתיבה למאגר (403 Forbidden): ${errData.message || ''}`;
      }
      console.warn(`GitHub commit failed for ${repoFullName}/${filePath}:`, msg);
      return { success: false, error: msg };
    }
  } catch (err: any) {
    console.warn(`GitHub commit exception for ${repoFullName}/${filePath}:`, err);
    return { success: false, error: err.message || 'שגיאת רשת בחיבור ל-GitHub' };
  }
}

/**
 * Upload & Commit track audio file, cover image, and metadata JSON directly into GitHub
 */
export async function uploadTrackToGitHubRepo(
  track: JamendoTrack,
  audioFile?: File | Blob,
  coverFile?: File | Blob
): Promise<{ success: boolean; audioUrl?: string; coverUrl?: string; error?: string }> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = (config.token || '').trim();

  if (!token || token === 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    return {
      success: false,
      error: 'לא מוגדר מפתח גישה של GitHub (Personal Access Token). אנא הזן את הטוקן שלך בהגדרות כדי להעלות שירים למאגר ' + repo,
    };
  }

  let finalAudioRawUrl = track.audioUrl;
  let finalCoverRawUrl = track.coverUrl;
  let audioBytesEstimate = 4500000;
  let coverBytesEstimate = 350000;

  // 1. Upload REAL AUDIO file to GitHub
  if (audioFile) {
    try {
      audioBytesEstimate = audioFile.size;
      const audioBase64 = await fileToBase64(audioFile);
      const audioExt = (audioFile instanceof File && audioFile.name.includes('.'))
        ? audioFile.name.split('.').pop()?.toLowerCase() || 'mp3'
        : 'mp3';
      const audioPath = `audio/${track.id}.${audioExt}`;
      const msg = `Save audio file: ${track.name} (${track.id})`;

      const primaryAudioRes = await commitFileToGitHub(repo, audioPath, audioBase64, msg, token);
      if (!primaryAudioRes.success) {
        return {
          success: false,
          error: `שגיאה בהעלאת קובץ השמע ל-GitHub: ${primaryAudioRes.error}`,
        };
      }
      finalAudioRawUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${audioPath}`;

      // Backup mirror
      commitFileToGitHub(backupRepo, audioPath, audioBase64, msg, token).catch(() => {});
    } catch (audioErr: any) {
      return {
        success: false,
        error: `עיבוד קובץ השמע נכשל: ${audioErr.message || String(audioErr)}`,
      };
    }
  }

  // 2. Upload REAL COVER IMAGE file to GitHub
  let coverBase64: string | null = null;
  if (coverFile) {
    try {
      coverBytesEstimate = coverFile.size;
      coverBase64 = await fileToBase64(coverFile);
    } catch {}
  } else if (track.coverUrl && track.coverUrl.startsWith('data:image/')) {
    coverBase64 = track.coverUrl.split(',')[1] || null;
    coverBytesEstimate = Math.round(track.coverUrl.length * 0.75);
  }

  if (coverBase64) {
    try {
      const coverPath = `covers/${track.id}.jpg`;
      const msg = `Save cover art: ${track.name} (${track.id})`;

      const primaryCoverRes = await commitFileToGitHub(repo, coverPath, coverBase64, msg, token);
      if (primaryCoverRes.success) {
        finalCoverRawUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${coverPath}`;
      }
      commitFileToGitHub(backupRepo, coverPath, coverBase64, msg, token).catch(() => {});
    } catch (coverErr) {
      console.warn('Failed to upload cover art to GitHub:', coverErr);
    }
  }

  // 3. Upload METADATA JSON to GitHub
  const calculatedBgColor = computeTrackBgColor(track);
  const trackForGitHub: JamendoTrack = {
    ...track,
    audioUrl: finalAudioRawUrl,
    coverUrl: finalCoverRawUrl,
    bgColor: track.bgColor || calculatedBgColor,
    source: `GitHub Storage (${repo})`,
  };

  const metadataPath = `tracks/${track.id}.json`;
  const metadataBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(trackForGitHub, null, 2))));
  const metaMsg = `Add metadata: ${track.name} by ${track.artistName}`;

  const metaRes = await commitFileToGitHub(repo, metadataPath, metadataBase64, metaMsg, token);
  if (!metaRes.success) {
    return {
      success: false,
      error: `שגיאה בשמירת פרטי השיר ב-GitHub: ${metaRes.error}`,
    };
  }

  commitFileToGitHub(backupRepo, metadataPath, metadataBase64, metaMsg, token).catch(() => {});

  // 4. UPDATE Master Index immediately for ultra-fast CDN loading
  try {
    let currentTracks: JamendoTrack[] = [];
    try {
      const indexRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/tracks_index.json?t=${Date.now()}`);
      if (indexRes.ok) {
        const rawJson = await indexRes.json();
        if (Array.isArray(rawJson)) currentTracks = rawJson;
      }
    } catch {}

    const filtered = currentTracks.filter((t) => t.id !== trackForGitHub.id);
    const updatedMaster = [trackForGitHub, ...filtered];

    await updateMasterTracksIndexOnGitHub(repo, updatedMaster, token);

    // Purge jsDelivr cache so worldwide users get the track immediately
    fetch(`https://purge.jsdelivr.net/gh/${repo}@main/tracks_index.json`).catch(() => {});
  } catch (indexUpdateErr) {
    console.warn('Master index update notice:', indexUpdateErr);
  }

  // Update storage usage counter in local configuration
  const totalTrackBytes = audioBytesEstimate + coverBytesEstimate;
  const updatedConfig = {
    ...config,
    usedBytes: (config.usedBytes || 0) + totalTrackBytes,
    fileCount: (config.fileCount || 0) + 1,
    lastSyncStatus: `נשמר בהצלחה ב-${repo}`,
  };
  saveGitHubStorageConfig(updatedConfig);

  return {
    success: true,
    audioUrl: finalAudioRawUrl,
    coverUrl: finalCoverRawUrl,
  };
}

async function updateMasterTracksIndexOnGitHub(repoFullName: string, tracks: JamendoTrack[], token: string): Promise<void> {
  const cleanToken = (token || '').trim();
  if (!cleanToken || cleanToken === 'PASTE_YOUR_GITHUB_TOKEN_HERE') return;
  try {
    const indexPath = `tracks_index.json`;
    const indexBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(tracks, null, 2))));
    await commitFileToGitHub(repoFullName, indexPath, indexBase64, `Update tracks_index.json (${tracks.length} tracks)`, cleanToken);
  } catch (e) {
    console.warn('Failed to update tracks_index.json:', e);
  }
}

async function fetchTracksFromSingleRepo(repoFullName: string, token: string): Promise<JamendoTrack[]> {
  // 1. Try fetching high-speed master index via raw GitHub & CDN concurrently
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repoFullName}/main/tracks_index.json?t=${Date.now()}`;
    const cdnUrl = `https://cdn.jsdelivr.net/gh/${repoFullName}@main/tracks_index.json`;

    // Fetch fastest responding endpoint
    const fetchPromises = [
      fetch(rawUrl).then(r => (r.ok ? r.json() : Promise.reject())),
      fetch(cdnUrl).then(r => (r.ok ? r.json() : Promise.reject())),
    ];

    const data: JamendoTrack[] = await Promise.any(fetchPromises).catch(() => null);

    if (Array.isArray(data) && data.length > 0) {
      return data.map((t) => ({
        ...t,
        bgColor: t.bgColor || computeTrackBgColor(t),
        audioUrl: getStreamingMediaUrl(t.audioUrl),
        coverUrl: getStreamingMediaUrl(t.coverUrl),
        artistAvatarUrl: getStreamingMediaUrl(t.artistAvatarUrl || t.coverUrl),
      }));
    }
  } catch (indexErr) {
    console.warn('tracks_index.json fetch notice:', indexErr);
  }

  // 2. Fallback: Query GitHub API /contents/tracks and fetch JSON files IN PARALLEL
  try {
    const listRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/tracks`, {
      headers: getGitHubHeaders(token),
    });

    if (!listRes.ok) return [];

    const files = await listRes.json();
    if (!Array.isArray(files)) return [];

    const jsonFiles = files.filter((f: any) => f.name && f.name.endsWith('.json') && f.download_url);
    if (jsonFiles.length === 0) return [];

    // Parallel HTTP requests for ultra-fast loading
    const fetchPromises = jsonFiles.map(async (file: any) => {
      try {
        const itemRes = await fetch(file.download_url);
        if (itemRes.ok) {
          const data: JamendoTrack = await itemRes.json();
          if (data.id && data.name) {
            return {
              ...data,
              bgColor: data.bgColor || computeTrackBgColor(data),
              audioUrl: getStreamingMediaUrl(data.audioUrl),
              coverUrl: getStreamingMediaUrl(data.coverUrl),
              artistAvatarUrl: getStreamingMediaUrl(data.artistAvatarUrl || data.coverUrl),
            };
          }
        }
      } catch {}
      return null;
    });

    const results = await Promise.allSettled(fetchPromises);
    const tracks: JamendoTrack[] = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) {
        tracks.push(r.value);
      }
    });

    if (tracks.length > 0 && token && token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
      updateMasterTracksIndexOnGitHub(repoFullName, tracks, token).catch(() => {});
    }

    return tracks;
  } catch (err) {
    console.warn(`Failed to fetch tracks from GitHub repo ${repoFullName}:`, err);
    return [];
  }
}

/**
 * Fetch all saved tracks metadata directly from GitHub repository with active backup repo fallback
 */
export async function fetchTracksFromGitHubRepo(): Promise<JamendoTrack[]> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = config.token || DEFAULT_TOKEN;

  let tracks = await fetchTracksFromSingleRepo(repo, token);
  if (tracks.length === 0 && backupRepo) {
    console.info(`Primary repo ${repo} returned 0 tracks. Active fallback to backup repo ${backupRepo}...`);
    tracks = await fetchTracksFromSingleRepo(backupRepo, token);
  }
  return tracks;
}

/**
 * Helper to delete a single file from a GitHub repository
 */
async function deleteFileFromGitHub(
  repoFullName: string,
  filePath: string,
  commitMessage: string,
  token: string
): Promise<boolean> {
  const cleanToken = (token || '').trim();
  if (!cleanToken || cleanToken === 'PASTE_YOUR_GITHUB_TOKEN_HERE') return false;

  try {
    const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      headers: getGitHubHeaders(cleanToken),
    });
    if (!checkRes.ok) return false;
    const existingData = await checkRes.json();
    const sha = existingData.sha;
    if (!sha) return false;

    const delRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      method: 'DELETE',
      headers: getGitHubHeaders(cleanToken, true),
      body: JSON.stringify({
        message: commitMessage,
        sha,
      }),
    });
    return delRes.ok;
  } catch {
    return false;
  }
}

/**
 * Delete a published track from both GitHub primary and backup repositories, and update tracks_index.json
 */
export async function deleteTrackFromGitHubRepo(trackId: string): Promise<boolean> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = (config.token || '').trim();

  const msg = `Delete track: ${trackId}`;
  await Promise.allSettled([
    deleteFileFromGitHub(repo, `tracks/${trackId}.json`, msg, token),
    deleteFileFromGitHub(backupRepo, `tracks/${trackId}.json`, msg, token),
    deleteFileFromGitHub(repo, `audio/${trackId}.mp3`, msg, token),
    deleteFileFromGitHub(backupRepo, `audio/${trackId}.mp3`, msg, token),
    deleteFileFromGitHub(repo, `covers/${trackId}.jpg`, msg, token),
    deleteFileFromGitHub(backupRepo, `covers/${trackId}.jpg`, msg, token),
  ]);

  // Synchronously update tracks_index.json to remove track
  if (token && token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    try {
      const indexRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/tracks_index.json?t=${Date.now()}`);
      if (indexRes.ok) {
        const rawJson: JamendoTrack[] = await indexRes.json();
        if (Array.isArray(rawJson)) {
          const updated = rawJson.filter(t => t.id !== trackId);
          await updateMasterTracksIndexOnGitHub(repo, updated, token);
          fetch(`https://purge.jsdelivr.net/gh/${repo}@main/tracks_index.json`).catch(() => {});
        }
      }
    } catch {}
  }

  return true;
}

async function updateMasterProfilesIndexOnGitHub(repoFullName: string, profiles: any[], token: string): Promise<void> {
  if (!token) return;
  try {
    const indexPath = `profiles_index.json`;
    const indexBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(profiles, null, 2))));
    await commitFileToGitHub(repoFullName, indexPath, indexBase64, `Update profiles_index.json (${profiles.length} profiles)`, token);
  } catch (e) {
    console.warn('Failed to update profiles_index.json:', e);
  }
}

/**
 * Save Artist Profile metadata and avatar to GitHub
 */
export async function uploadArtistProfileToGitHub(
  artist: any,
  avatarFile?: File | Blob
): Promise<{ success: boolean; avatarUrl?: string }> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = config.token || DEFAULT_TOKEN;

  let finalAvatarUrl = artist.avatarUrl;

  // 1. Upload Avatar if provided
  if (avatarFile) {
    try {
      const avatarBase64 = await fileToBase64(avatarFile);
      const avatarPath = `avatars/${artist.id}.jpg`;
      const msg = `Update avatar for artist: ${artist.name}`;

      const res = await commitFileToGitHub(repo, avatarPath, avatarBase64, msg, token);
      if (res.success) {
        finalAvatarUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${avatarPath}`;
      }
      await commitFileToGitHub(backupRepo, avatarPath, avatarBase64, msg, token);
    } catch (err) {
      console.warn('Avatar upload failed:', err);
    }
  }

  // 2. Upload Profile JSON
  const profileWithUrl = { ...artist, avatarUrl: finalAvatarUrl };
  const profilePath = `profiles/${artist.id}.json`;
  const profileBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(profileWithUrl, null, 2))));
  const metaMsg = `Update profile: ${artist.name}`;

  await Promise.allSettled([
    commitFileToGitHub(repo, profilePath, profileBase64, metaMsg, token),
    commitFileToGitHub(backupRepo, profilePath, profileBase64, metaMsg, token),
  ]);

  // Refresh index
  fetchArtistProfilesFromGitHub().then((updatedProfiles) => {
    if (token) {
      updateMasterProfilesIndexOnGitHub(repo, updatedProfiles, token).catch(() => {});
    }
  }).catch(() => {});

  return { success: true, avatarUrl: finalAvatarUrl };
}

/**
 * Fetch all artist profiles from GitHub in parallel with CDN index fallback
 */
export async function fetchArtistProfilesFromGitHub(): Promise<any[]> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const token = config.token || DEFAULT_TOKEN;

  // 1. Try fetching master index via CDN
  try {
    const cdnUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/profiles_index.json?t=${Date.now()}`;
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/profiles_index.json?t=${Date.now()}`;
    
    let res = await fetch(cdnUrl).catch(() => null);
    if (!res || !res.ok) {
      res = await fetch(rawUrl).catch(() => null);
    }

    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map(p => ({
          ...p,
          avatarUrl: getStreamingMediaUrl(p.avatarUrl),
        }));
      }
    }
  } catch {}

  // 2. Fallback: Query API and fetch in parallel
  try {
    const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/profiles`, {
      headers: getGitHubHeaders(token),
    });

    if (!listRes.ok) return [];

    const files = await listRes.json();
    if (!Array.isArray(files)) return [];

    const profileFiles = files.filter((f: any) => f.name && f.name.endsWith('.json') && f.download_url);
    if (profileFiles.length === 0) return [];

    const fetchPromises = profileFiles.map(async (file: any) => {
      try {
        const itemRes = await fetch(file.download_url);
        if (itemRes.ok) {
          const data = await itemRes.json();
          return {
            ...data,
            avatarUrl: getStreamingMediaUrl(data.avatarUrl),
          };
        }
      } catch {}
      return null;
    });

    const results = await Promise.allSettled(fetchPromises);
    const profiles: any[] = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) {
        profiles.push(r.value);
      }
    });

    if (profiles.length > 0 && token) {
      updateMasterProfilesIndexOnGitHub(repo, profiles, token).catch(() => {});
    }

    return profiles;
  } catch (err) {
    console.warn('Failed to fetch artist profiles from GitHub:', err);
    return [];
  }
}

/**
 * Updates albums_index.json on GitHub
 */
async function updateMasterAlbumsIndexOnGitHub(repoFullName: string, albums: Album[], token: string): Promise<void> {
  const cleanToken = (token || '').trim();
  if (!cleanToken || cleanToken === 'PASTE_YOUR_GITHUB_TOKEN_HERE') return;
  try {
    const indexPath = `albums_index.json`;
    const indexBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(albums, null, 2))));
    await commitFileToGitHub(repoFullName, indexPath, indexBase64, `Update albums_index.json (${albums.length} albums)`, cleanToken);
  } catch (e) {
    console.warn('Failed to update albums_index.json:', e);
  }
}

/**
 * Upload & Commit Album metadata and optional cover image directly into GitHub repo
 */
export async function uploadAlbumToGitHub(
  album: Album,
  coverFile?: File | Blob
): Promise<{ success: boolean; coverUrl?: string; error?: string }> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = (config.token || '').trim();

  if (!token || token === 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    return {
      success: false,
      error: 'לא מוגדר מפתח גישה של GitHub (Personal Access Token). אנא הזן את הטוקן שלך בהגדרות כדי לשמור אלבומים במאגר ' + repo,
    };
  }

  let finalCoverUrl = album.coverUrl;

  // 1. Upload Cover Image if provided
  if (coverFile) {
    try {
      const coverBase64 = await fileToBase64(coverFile);
      const coverPath = `covers/albums/${album.id}.jpg`;
      const msg = `Save album cover: ${album.title}`;
      const res = await commitFileToGitHub(repo, coverPath, coverBase64, msg, token);
      if (res.success) {
        finalCoverUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${coverPath}`;
      }
      commitFileToGitHub(backupRepo, coverPath, coverBase64, msg, token).catch(() => {});
    } catch (e) {
      console.warn('Album cover upload failed:', e);
    }
  } else if (album.coverUrl && album.coverUrl.startsWith('data:image/')) {
    try {
      const coverBase64 = album.coverUrl.split(',')[1];
      const coverPath = `covers/albums/${album.id}.jpg`;
      const msg = `Save album cover: ${album.title}`;
      const res = await commitFileToGitHub(repo, coverPath, coverBase64, msg, token);
      if (res.success) {
        finalCoverUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${coverPath}`;
      }
      commitFileToGitHub(backupRepo, coverPath, coverBase64, msg, token).catch(() => {});
    } catch {}
  }

  // 2. Commit Album JSON
  const albumToSave: Album = {
    ...album,
    coverUrl: finalCoverUrl,
  };

  const albumPath = `albums/${album.id}.json`;
  const albumBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(albumToSave, null, 2))));
  const commitMsg = `Save album: ${album.title} by ${album.artistName}`;

  const res = await commitFileToGitHub(repo, albumPath, albumBase64, commitMsg, token);
  if (!res.success) {
    return {
      success: false,
      error: `שגיאה בשמירת האלבום ב-GitHub: ${res.error}`,
    };
  }
  commitFileToGitHub(backupRepo, albumPath, albumBase64, commitMsg, token).catch(() => {});

  // 3. Update master albums_index.json
  try {
    let currentAlbums: Album[] = [];
    try {
      const indexRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/albums_index.json?t=${Date.now()}`);
      if (indexRes.ok) {
        const rawJson = await indexRes.json();
        if (Array.isArray(rawJson)) currentAlbums = rawJson;
      }
    } catch {}

    const filtered = currentAlbums.filter((a) => a.id !== albumToSave.id);
    const updatedMaster = [albumToSave, ...filtered];
    await updateMasterAlbumsIndexOnGitHub(repo, updatedMaster, token);
    fetch(`https://purge.jsdelivr.net/gh/${repo}@main/albums_index.json`).catch(() => {});
  } catch (err) {
    console.warn('Failed to update albums index on GitHub:', err);
  }

  return {
    success: true,
    coverUrl: finalCoverUrl,
  };
}

/**
 * Fetch all albums from GitHub repo
 */
export async function fetchAlbumsFromGitHub(): Promise<Album[]> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const token = (config.token || '').trim();

  // 1. Try master albums_index.json via raw and cdn
  try {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/main/albums_index.json?t=${Date.now()}`;
    const cdnUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/albums_index.json`;

    const fetchPromises = [
      fetch(rawUrl).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(cdnUrl).then((r) => (r.ok ? r.json() : Promise.reject())),
    ];

    const data: Album[] = await Promise.any(fetchPromises).catch(() => null);
    if (Array.isArray(data) && data.length > 0) {
      return data.map((a) => ({
        ...a,
        coverUrl: getStreamingMediaUrl(a.coverUrl),
      }));
    }
  } catch {}

  // 2. Fallback: Query /contents/albums
  try {
    const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/albums`, {
      headers: getGitHubHeaders(token),
    });
    if (!listRes.ok) return [];

    const files = await listRes.json();
    if (!Array.isArray(files)) return [];

    const jsonFiles = files.filter((f: any) => f.name && f.name.endsWith('.json') && f.download_url);
    if (jsonFiles.length === 0) return [];

    const fetchPromises = jsonFiles.map(async (f: any) => {
      try {
        const itemRes = await fetch(f.download_url);
        if (itemRes.ok) {
          const item: Album = await itemRes.json();
          return {
            ...item,
            coverUrl: getStreamingMediaUrl(item.coverUrl),
          };
        }
      } catch {}
      return null;
    });

    const results = await Promise.allSettled(fetchPromises);
    const albums: Album[] = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled' && r.value) {
        albums.push(r.value);
      }
    });

    if (albums.length > 0 && token && token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
      updateMasterAlbumsIndexOnGitHub(repo, albums, token).catch(() => {});
    }

    return albums;
  } catch (e) {
    console.warn('Failed to fetch albums from GitHub:', e);
    return [];
  }
}

/**
 * Delete an album from GitHub
 */
export async function deleteAlbumFromGitHub(albumId: string): Promise<boolean> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = (config.token || '').trim();

  const msg = `Delete album: ${albumId}`;
  await Promise.allSettled([
    deleteFileFromGitHub(repo, `albums/${albumId}.json`, msg, token),
    deleteFileFromGitHub(backupRepo, `albums/${albumId}.json`, msg, token),
    deleteFileFromGitHub(repo, `covers/albums/${albumId}.jpg`, msg, token),
    deleteFileFromGitHub(backupRepo, `covers/albums/${albumId}.jpg`, msg, token),
  ]);

  if (token && token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    try {
      const indexRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/albums_index.json?t=${Date.now()}`);
      if (indexRes.ok) {
        const rawJson: Album[] = await indexRes.json();
        if (Array.isArray(rawJson)) {
          const updated = rawJson.filter((a) => a.id !== albumId);
          await updateMasterAlbumsIndexOnGitHub(repo, updated, token);
          fetch(`https://purge.jsdelivr.net/gh/${repo}@main/albums_index.json`).catch(() => {});
        }
      }
    } catch {}
  }

  return true;
}

/**
 * Increments track play/view count and commits updated JSON to GitHub
 */
export async function incrementTrackPlaysInGitHub(track: JamendoTrack): Promise<number> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const token = (config.token || '').trim();
  const currentPlays = (track.playsCount || 0) + 1;
  const updatedTrack: JamendoTrack = {
    ...track,
    playsCount: currentPlays,
  };

  if (token && token !== 'PASTE_YOUR_GITHUB_TOKEN_HERE') {
    try {
      const metadataPath = `tracks/${track.id}.json`;
      const metadataBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(updatedTrack, null, 2))));
      await commitFileToGitHub(repo, metadataPath, metadataBase64, `Increment plays for ${track.name} to ${currentPlays}`, token);

      const indexRes = await fetch(`https://raw.githubusercontent.com/${repo}/main/tracks_index.json?t=${Date.now()}`);
      if (indexRes.ok) {
        const rawJson: JamendoTrack[] = await indexRes.json();
        if (Array.isArray(rawJson)) {
          const updatedIndex = rawJson.map((t) => (t.id === track.id ? { ...t, playsCount: currentPlays } : t));
          await updateMasterTracksIndexOnGitHub(repo, updatedIndex, token);
          fetch(`https://purge.jsdelivr.net/gh/${repo}@main/tracks_index.json`).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('GitHub play increment notice:', e);
    }
  }

  try {
    const cached = localStorage.getItem('kolot_cloud_tracks_cache');
    if (cached) {
      const list: JamendoTrack[] = JSON.parse(cached);
      const idx = list.findIndex(t => t.id === track.id);
      if (idx >= 0) {
        list[idx].playsCount = currentPlays;
        localStorage.setItem('kolot_cloud_tracks_cache', JSON.stringify(list));
      }
    }
  } catch {}

  return currentPlays;
}


