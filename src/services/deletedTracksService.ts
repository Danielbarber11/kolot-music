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

export function markSongAsDeleted(id: string): void {
  try {
    const set = getDeletedSongIds();
    set.add(id);
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function isSongDeleted(id: string): boolean {
  return getDeletedSongIds().has(id);
}
