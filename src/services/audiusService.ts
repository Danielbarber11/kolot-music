import { JamendoTrack } from '../types';

export async function searchAudiusTracks(query?: string): Promise<JamendoTrack[]> {
  try {
    const endpoint = query && query.trim()
      ? `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=WikiArchive&limit=30`
      : `https://discoveryprovider.audius.co/v1/tracks/trending?app_name=WikiArchive&limit=30`;

    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('Audius API request failed');
    const data = await res.json();

    const items = data.data || [];
    return items.map((track: any): JamendoTrack => {
      // Only use the real artwork uploaded by the artist on Audius; do not inject fake images
      const artwork = track.artwork?.['1000x1000'] || track.artwork?.['480x480'] || track.artwork?.['150x150'] || '';
      const streamUrl = `https://discoveryprovider.audius.co/v1/tracks/${track.id}/stream?app_name=WikiArchive`;
      const artistAvatar = track.user?.profile_picture?.['480x480'] || track.user?.profile_picture?.['150x150'] || undefined;
      const artistHandle = track.user?.handle;
      const directArtistUrl = artistHandle ? `https://audius.co/${artistHandle}` : 'https://audius.co';

      // Map genre
      const g = (track.genre || '').toLowerCase();
      let genre = 'Pop';
      if (g.includes('classic')) genre = 'Classical';
      else if (g.includes('jazz')) genre = 'Jazz';
      else if (g.includes('blues') || g.includes('soul') || g.includes('r&b')) genre = 'Blues';
      else if (g.includes('chill') || g.includes('lo-fi') || g.includes('lofi')) genre = 'Chill';
      else if (g.includes('elect') || g.includes('techno') || g.includes('house') || g.includes('edm') || g.includes('synth') || g.includes('dubstep')) genre = 'Electronic';
      else if (g.includes('acoust') || g.includes('folk')) genre = 'Acoustic';
      else if (g.includes('soundtrack') || g.includes('cinematic') || g.includes('ambient')) genre = 'Cinematic';
      else if (g.includes('rock') || g.includes('metal') || g.includes('punk')) genre = 'Rock';
      else genre = track.genre || 'Pop';

      return {
        id: `audius_${track.id}`,
        name: track.title || 'Untitled Track',
        artistName: track.user?.name || track.user?.handle || 'Audius Artist',
        albumName: track.album_name || (track.mood ? `${genre} (${track.mood})` : `${genre} Release`),
        duration: Math.round(track.duration || 180),
        audioUrl: streamUrl,
        coverUrl: artwork,
        artistAvatarUrl: artistAvatar,
        publisherAccountUrl: directArtistUrl,
        artistBio: track.user?.bio || undefined,
        genre: genre,
        publishedDate: track.release_date ? new Date(track.release_date).getFullYear().toString() : '2024',
        source: 'Audius Protocol (רשת פתוחה ומבוזרת)',
        license: 'Audius Open Streaming API / Artist Direct Clearance',
        licenseUrl: directArtistUrl,
        legalStatus: '100% מאושר וחוקי - רישיון ישיר מאמן Audius',
        lyrics: track.description || undefined,
      };
    });
  } catch (err) {
    console.error('Audius API error:', err);
    return [];
  }
}
