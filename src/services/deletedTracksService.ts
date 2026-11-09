const DELETED_IDS_KEY = 'kolot_permanently_deleted_tracks_v1';

export function getDeletedSongIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr);
      }
    }
  } catch {}
  return new Set();
}

export function markSongAsDeleted(id: string, songName?: string, artistName?: string): void {
  try {
    const set = getDeletedSongIds();
    set.add(id);
    if (songName && artistName) {
      const normKey = `del_${artistName.trim().toLowerCase()}::${songName.trim().toLowerCase()}`;
      set.add(normKey);
    }
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));

    // Immediately purge from cloud tracks cache
    try {
      const savedCloud = localStorage.getItem('kolot_cloud_tracks_cache');
      if (savedCloud) {
        const parsed = JSON.parse(savedCloud);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((t: any) => t.id !== id && (!songName || t.name !== songName));
          localStorage.setItem('kolot_cloud_tracks_cache', JSON.stringify(filtered));
        }
      }
    } catch {}

    // Immediately purge from uploaded tracks cache
    try {
      const savedUploaded = localStorage.getItem('kolot_uploaded_tracks');
      if (savedUploaded) {
        const parsed = JSON.parse(savedUploaded);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((t: any) => t.id !== id && (!songName || t.name !== songName));
          localStorage.setItem('kolot_uploaded_tracks', JSON.stringify(filtered));
        }
      }
    } catch {}
  } catch {}
}

export function isSongDeleted(id: string): boolean {
  return getDeletedSongIds().has(id);
}
