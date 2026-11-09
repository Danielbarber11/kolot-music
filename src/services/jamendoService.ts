import { JamendoTrack } from '../types';
import { VERIFIED_REAL_TRACKS } from './multiMusicService';

/**
 * Curated authentic music tracks with 100% verified, live, working audio streams.
 * Covers Creative Commons, Public Domain (US MMA pre-1928), and Wikimedia Open Audio
 * with CORS headers and native browser audio streaming support.
 */
export const CURATED_JAMENDO_TRACKS: JamendoTrack[] = VERIFIED_REAL_TRACKS;

/**
 * Filter curated tracks by query, genre, or return full list
 */
export async function searchJamendoTracks(
  query: string = '',
  limit: number = 30
): Promise<JamendoTrack[]> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return CURATED_JAMENDO_TRACKS.slice(0, limit);
  }

  const filtered = CURATED_JAMENDO_TRACKS.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.artistName.toLowerCase().includes(q) ||
      t.genre?.toLowerCase().includes(q) ||
      t.albumName.toLowerCase().includes(q)
  );

  return filtered.slice(0, limit);
}
