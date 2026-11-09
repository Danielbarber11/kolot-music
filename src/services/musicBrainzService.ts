import { MusicBrainzRelease } from '../types';

export async function searchMusicBrainz(query: string, limit: number = 6): Promise<MusicBrainzRelease[]> {
  if (!query.trim()) return [];

  const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WikiArchiveApp/2.5.0 (https://ais-dev.run.app)',
      },
    });

    if (!res.ok) throw new Error('MusicBrainz search failed');
    const data = await res.json();

    const releases = data.releases || [];
    return releases.map((rel: any) => {
      const artistCredit = rel['artist-credit']?.[0]?.name || 'Unknown Artist';
      return {
        id: rel.id,
        title: rel.title || 'Untitled Release',
        artistName: artistCredit,
        type: rel.status || rel['primary-type'] || 'Album',
        date: rel.date,
        country: rel.country,
        trackCount: rel['track-count'],
        musicBrainzUrl: `https://musicbrainz.org/release/${rel.id}`,
      };
    });
  } catch (err) {
    console.error('MusicBrainz search error:', err);
    return [];
  }
}
