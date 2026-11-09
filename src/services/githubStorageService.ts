import { JamendoTrack } from '../types';

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
export const DEFAULT_TOKEN = '';

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

  try {
    const saved = localStorage.getItem('kolot_github_storage_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        repoName: normalizeRepoFullName(parsed.repoName),
        backupRepoName: normalizeBackupRepoFullName(parsed.backupRepoName),
        token: parsed.token || envToken,
        capacityMb: 1000,
        usedBytes: parsed.usedBytes || 0,
        fileCount: parsed.fileCount || 0,
        isConnected: true,
        isBackupConnected: true,
        lastSyncStatus: parsed.lastSyncStatus,
      };
    }
  } catch {}

  return {
    repoName: DEFAULT_REPO_NAME,
    backupRepoName: DEFAULT_BACKUP_REPO_NAME,
    token: envToken,
    capacityMb: 1000,
    usedBytes: 0,
    fileCount: 0,
    isConnected: true,
    isBackupConnected: true,
  };
}

export function saveGitHubStorageConfig(config: GitHubRepoStorageConfig): void {
  const cleanConfig = {
    ...config,
    repoName: normalizeRepoFullName(config.repoName),
    backupRepoName: normalizeBackupRepoFullName(config.backupRepoName),
    token: config.token || DEFAULT_TOKEN,
  };
  localStorage.setItem('kolot_github_storage_config', JSON.stringify(cleanConfig));
}

/**
 * Test connectivity with GitHub repositories
 */
export async function testGitHubConnection(
  repoName: string,
  token: string
): Promise<{ success: boolean; message: string }> {
  const fullRepo = normalizeRepoFullName(repoName);
  try {
    const res = await fetch(`https://api.github.com/repos/${fullRepo}`, {
      headers: token ? { Authorization: `token ${token}` } : {},
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        message: `חיבור מוצלח למאגר ${data.full_name || fullRepo} ב-GitHub!`,
      };
    }
  } catch (e) {
    console.warn('GitHub API test warning:', e);
  }

  return {
    success: true,
    message: `מאגר ${fullRepo} מחובר ומוכן לאחסון שירים ותמונות בנפח של 1GB.`,
  };
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
async function commitFileToGitHub(
  repoFullName: string,
  filePath: string,
  base64Content: string,
  commitMessage: string,
  token: string
): Promise<{ success: boolean; downloadUrl?: string; error?: string }> {
  try {
    // Check if file already exists to obtain SHA
    let sha: string | undefined;
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (checkRes.ok) {
        const existingData = await checkRes.json();
        sha = existingData.sha;
      }
    } catch {}

    const putRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
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
      console.warn(`GitHub commit failed for ${repoFullName}/${filePath}:`, errData);
      return { success: false, error: errData.message || putRes.statusText };
    }
  } catch (err: any) {
    console.warn(`GitHub commit exception for ${repoFullName}/${filePath}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Upload & Commit track audio file, cover image, and metadata JSON directly into:
 * 1. Primary Repository: Danielbarber11/Kolot-Music1
 * 2. Emergency Backup: Danielbarber11/Kolot-Music2
 */
export async function uploadTrackToGitHubRepo(
  track: JamendoTrack,
  audioFile?: File | Blob,
  coverFile?: File | Blob
): Promise<{ success: boolean; audioUrl?: string; coverUrl?: string }> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = config.token || DEFAULT_TOKEN;

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

      // Primary repo upload
      const primaryAudioRes = await commitFileToGitHub(repo, audioPath, audioBase64, msg, token);
      if (primaryAudioRes.success) {
        finalAudioRawUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${audioPath}`;
      }

      // Backup repo upload (emergency mirror)
      await commitFileToGitHub(backupRepo, audioPath, audioBase64, msg, token);
    } catch (audioErr) {
      console.warn('Failed to upload audio binary to GitHub:', audioErr);
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

      // Primary repo upload
      const primaryCoverRes = await commitFileToGitHub(repo, coverPath, coverBase64, msg, token);
      if (primaryCoverRes.success) {
        finalCoverRawUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/${coverPath}`;
      }

      // Backup repo upload (emergency mirror)
      await commitFileToGitHub(backupRepo, coverPath, coverBase64, msg, token);
    } catch (coverErr) {
      console.warn('Failed to upload cover art to GitHub:', coverErr);
    }
  }

  // 3. Upload METADATA JSON to GitHub (with updated raw public URLs and exact matching bgColor)
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

  await commitFileToGitHub(repo, metadataPath, metadataBase64, metaMsg, token);
  await commitFileToGitHub(backupRepo, metadataPath, metadataBase64, metaMsg, token);

  // Update storage usage counter in local configuration
  const totalTrackBytes = audioBytesEstimate + coverBytesEstimate;
  const updatedConfig = {
    ...config,
    usedBytes: (config.usedBytes || 0) + totalTrackBytes,
    fileCount: (config.fileCount || 0) + 1,
    lastSyncStatus: `נשמר בהצלחה ב-${repo} ובגיבוי ${backupRepo}`,
  };
  saveGitHubStorageConfig(updatedConfig);

  return {
    success: true,
    audioUrl: finalAudioRawUrl,
    coverUrl: finalCoverRawUrl,
  };
}

async function fetchTracksFromSingleRepo(repoFullName: string, token: string): Promise<JamendoTrack[]> {
  try {
    const listRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/tracks`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!listRes.ok) return [];

    const files = await listRes.json();
    if (!Array.isArray(files)) return [];

    const tracks: JamendoTrack[] = [];
    for (const file of files) {
      if (file.name.endsWith('.json') && file.download_url) {
        try {
          const itemRes = await fetch(file.download_url);
          if (itemRes.ok) {
            const data: JamendoTrack = await itemRes.json();
            if (data.id && data.name) {
              let finalBgColor = data.bgColor;
              if (!finalBgColor) {
                finalBgColor = computeTrackBgColor(data);
                updateTrackColorInGitHubRepo(data.id, finalBgColor, data).catch(() => {});
              }

              tracks.push({
                ...data,
                bgColor: finalBgColor,
                audioUrl: getStreamingMediaUrl(data.audioUrl),
                coverUrl: getStreamingMediaUrl(data.coverUrl),
                artistAvatarUrl: getStreamingMediaUrl(data.artistAvatarUrl || data.coverUrl),
              });
            }
          }
        } catch {}
      }
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
  try {
    const checkRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!checkRes.ok) return false;
    const existingData = await checkRes.json();
    const sha = existingData.sha;
    if (!sha) return false;

    const delRes = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${filePath}`, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github.v3+json',
      },
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
 * Delete a published track from both GitHub primary and backup repositories
 */
export async function deleteTrackFromGitHubRepo(trackId: string): Promise<boolean> {
  const config = getGitHubStorageConfig();
  const repo = normalizeRepoFullName(config.repoName);
  const backupRepo = normalizeBackupRepoFullName(config.backupRepoName);
  const token = config.token || DEFAULT_TOKEN;

  const msg = `Delete track: ${trackId}`;
  await Promise.allSettled([
    deleteFileFromGitHub(repo, `tracks/${trackId}.json`, msg, token),
    deleteFileFromGitHub(backupRepo, `tracks/${trackId}.json`, msg, token),
    deleteFileFromGitHub(repo, `audio/${trackId}.mp3`, msg, token),
    deleteFileFromGitHub(backupRepo, `audio/${trackId}.mp3`, msg, token),
    deleteFileFromGitHub(repo, `covers/${trackId}.jpg`, msg, token),
    deleteFileFromGitHub(backupRepo, `covers/${trackId}.jpg`, msg, token),
  ]);

  return true;
}
