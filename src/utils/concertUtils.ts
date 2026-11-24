import { ArtistProfile, ConcertShow, JamendoTrack } from '../types';

export function sanitizeTicketUrl(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith('//')
      ? `https:${trimmed}`
      : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function formatConcertDate(dateStr?: string | null, isHe = true): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const dt = new Date(year, month, day);
    if (!Number.isNaN(dt.getTime())) {
      try {
        return new Intl.DateTimeFormat(isHe ? 'he-IL' : 'en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(dt);
      } catch {
        return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
      }
    }
  }

  const parsedMs = Date.parse(trimmed);
  if (!Number.isNaN(parsedMs)) {
    try {
      return new Intl.DateTimeFormat(isHe ? 'he-IL' : 'en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(parsedMs));
    } catch {}
  }

  return trimmed;
}

export function findArtistForTrack(
  track: JamendoTrack | null | undefined,
  artists: ArtistProfile[] = []
): ArtistProfile | undefined {
  if (!track || !Array.isArray(artists) || artists.length === 0) return undefined;
  const uid = (track.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
  const normName = (track.artistName || '').toLowerCase().trim();

  if (uid) {
    const byUid = artists.find((a) => {
      const aUid = (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim();
      return aUid === uid;
    });
    if (byUid) return byUid;
  }

  if (normName) {
    return artists.find((a) => (a.name || '').toLowerCase().trim() === normName);
  }
  return undefined;
}

export function getArtistConcertShows(
  artist?: ArtistProfile | null,
  fallbackTrack?: JamendoTrack | null
): ConcertShow[] {
  const validShows: ConcertShow[] = [];
  const rawShows = Array.isArray(artist?.concertShows) ? artist.concertShows : [];

  for (const show of rawShows) {
    if (!show || typeof show !== 'object') continue;
    const title = String(show.title || '').trim();
    const date = String(show.date || '').trim();
    const safeUrl = sanitizeTicketUrl(show.ticketUrl);
    if (!title || !safeUrl) continue;
    validShows.push({
      id: String(show.id || `${title}_${date}`),
      title,
      date,
      ticketUrl: safeUrl,
      venue: show.venue ? String(show.venue).trim() : undefined,
      createdAt: show.createdAt,
    });
  }

  if (validShows.length === 0 && fallbackTrack?.concertName && fallbackTrack?.concertTicketUrl) {
    const safeFallbackUrl = sanitizeTicketUrl(fallbackTrack.concertTicketUrl);
    if (safeFallbackUrl) {
      validShows.push({
        id: `track_show_${fallbackTrack.id}`,
        title: fallbackTrack.concertName.trim(),
        date: (fallbackTrack.concertDate || '').trim(),
        ticketUrl: safeFallbackUrl,
      });
    }
  }

  return validShows.sort((a, b) => {
    const da = a.date ? Date.parse(a.date) || 0 : 0;
    const db = b.date ? Date.parse(b.date) || 0 : 0;
    if (da && db) return da - db;
    return 0;
  });
}
