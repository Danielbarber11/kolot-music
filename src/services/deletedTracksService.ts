// Session-only deleted IDs tracking (no localStorage persistence)
const sessionDeletedIds = new Set<string>();

export function getDeletedSongIds(): Set<string> {
  return new Set(sessionDeletedIds);
}

export function markSongAsDeleted(id: string, songName?: string, artistName?: string): void {
  if (id) sessionDeletedIds.add(id);
  if (songName && artistName) {
    const normKey = `del_${artistName.trim().toLowerCase()}::${songName.trim().toLowerCase()}`;
    sessionDeletedIds.add(normKey);
  }
}

export function isSongDeleted(id: string): boolean {
  return sessionDeletedIds.has(id);
}
