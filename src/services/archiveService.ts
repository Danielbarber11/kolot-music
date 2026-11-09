import { ArchiveItem, MediaType, WaybackSnapshot, ArchiveFile } from '../types';

export async function searchInternetArchive(
  query: string,
  mediaFilter: MediaType = 'all',
  limit: number = 8
): Promise<ArchiveItem[]> {
  if (!query.trim()) return [];

  // Construct Internet Archive Lucene Query
  let mediaQuery = '';
  if (mediaFilter === 'movies') mediaQuery = ' AND mediatype:(movies)';
  else if (mediaFilter === 'audio') mediaQuery = ' AND mediatype:(audio OR etree)';
  else if (mediaFilter === 'texts') mediaQuery = ' AND mediatype:(texts)';
  else if (mediaFilter === 'software') mediaQuery = ' AND mediatype:(software)';
  else if (mediaFilter === 'web') mediaQuery = ' AND mediatype:(web)';

  // Escape special query characters or formulate query
  const cleanQuery = query.replace(/[:"()]/g, ' ').trim();
  const fullSearchQuery = `(${cleanQuery} OR title:(${cleanQuery}))${mediaQuery}`;

  const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    fullSearchQuery
  )}&fl[]=identifier,title,description,mediatype,year,date,creator,downloads&sort[]=downloads desc&rows=${limit}&page=1&output=json`;

  try {
    const res = await fetch(searchUrl);
    if (!res.ok) throw new Error('Internet Archive search request failed');
    const data = await res.json();

    const docs = data.response?.docs || [];

    const items: ArchiveItem[] = docs.map((doc: any) => {
      const id = doc.identifier;
      const mediaTypeRaw = doc.mediatype as string;
      let mappedType: MediaType = 'all';

      if (mediaTypeRaw === 'movies' || mediaTypeRaw === 'film') mappedType = 'movies';
      else if (mediaTypeRaw === 'audio' || mediaTypeRaw === 'etree') mappedType = 'audio';
      else if (mediaTypeRaw === 'texts') mappedType = 'texts';
      else if (mediaTypeRaw === 'software') mappedType = 'software';
      else if (mediaTypeRaw === 'web') mappedType = 'web';
      else mappedType = 'movies';

      const cleanDesc = typeof doc.description === 'string'
        ? doc.description.replace(/<[^>]+>/g, '').slice(0, 240)
        : Array.isArray(doc.description)
        ? doc.description.join(' ').replace(/<[^>]+>/g, '').slice(0, 240)
        : '';

      return {
        identifier: id,
        title: doc.title || id,
        description: cleanDesc,
        mediaType: mappedType,
        year: doc.year ? String(doc.year) : doc.date ? String(doc.date).slice(0, 4) : undefined,
        creator: Array.isArray(doc.creator) ? doc.creator[0] : doc.creator,
        downloads: doc.downloads || 0,
        thumbnail: `https://archive.org/services/img/${id}`,
        embedUrl: `https://archive.org/embed/${id}`,
        itemUrl: `https://archive.org/details/${id}`,
      };
    });

    return items;
  } catch (err) {
    console.error('Internet Archive search error:', err);
    return [];
  }
}

export async function getArchiveItemDetails(identifier: string): Promise<ArchiveItem | null> {
  const metadataUrl = `https://archive.org/metadata/${identifier}`;
  try {
    const res = await fetch(metadataUrl);
    if (!res.ok) return null;
    const data = await res.json();

    const meta = data.metadata || {};
    const filesList: ArchiveFile[] = (data.files || []).map((f: any) => ({
      name: f.name,
      format: f.format,
      size: f.size ? Number(f.size) : undefined,
      url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
    }));

    // Find direct media file (MP4, MP3, PDF, OGX, WebM)
    const directVideo = filesList.find(f => f.name.endsWith('.mp4') || f.name.endsWith('.webm') || f.format?.includes('MP4'));
    const directAudio = filesList.find(f => f.name.endsWith('.mp3') || f.name.endsWith('.ogg') || f.format?.includes('VBR MP3'));
    const directPdf = filesList.find(f => f.name.endsWith('.pdf'));

    const directUrl = directVideo?.url || directAudio?.url || directPdf?.url || undefined;

    return {
      identifier,
      title: meta.title || identifier,
      description: meta.description ? meta.description.replace(/<[^>]+>/g, '') : '',
      mediaType: meta.mediatype === 'movies' ? 'movies' : meta.mediatype === 'audio' ? 'audio' : 'texts',
      year: meta.year || meta.date?.slice(0, 4),
      creator: meta.creator,
      thumbnail: `https://archive.org/services/img/${identifier}`,
      embedUrl: `https://archive.org/embed/${identifier}`,
      itemUrl: `https://archive.org/details/${identifier}`,
      directMediaUrl: directUrl,
      files: filesList,
    };
  } catch (err) {
    console.error('Error fetching Archive item metadata:', err);
    return null;
  }
}

export async function checkWaybackSnapshot(url: string): Promise<WaybackSnapshot | null> {
  if (!url) return null;
  const cleanUrl = url.replace(/^https?:\/\//, '');
  const waybackApi = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}`;

  try {
    const res = await fetch(waybackApi);
    if (!res.ok) return null;
    const data = await res.json();

    const snapshot = data.archived_snapshots?.closest;
    if (snapshot && snapshot.available) {
      return {
        originalUrl: snapshot.url,
        timestamp: snapshot.timestamp,
        archiveUrl: snapshot.url,
        status: snapshot.status,
      };
    }
    return null;
  } catch (err) {
    console.error('Wayback check error:', err);
    return null;
  }
}

// Curated collections for Instant Video/Media Showcase
export const CURATED_ARCHIVE_ITEMS: ArchiveItem[] = [
  {
    identifier: 'Apollo11Moonlanding',
    title: 'Apollo 11 Moon Landing Broadcast (1969)',
    description: 'Original NASA Television live broadcast of Neil Armstrong stepping onto the lunar surface during Apollo 11.',
    mediaType: 'movies',
    year: '1969',
    creator: 'NASA / TV Networks',
    thumbnail: 'https://archive.org/services/img/Apollo11Moonlanding',
    embedUrl: 'https://archive.org/embed/Apollo11Moonlanding',
    itemUrl: 'https://archive.org/details/Apollo11Moonlanding',
  },
  {
    identifier: 'A_Trip_to_the_Moon_1902',
    title: 'A Trip to the Moon (מסע אל הירח - 1902)',
    description: 'The legendary landmark sci-fi silent movie directed by Georges Méliès.',
    mediaType: 'movies',
    year: '1902',
    creator: 'Georges Méliès',
    thumbnail: 'https://archive.org/services/img/A_Trip_to_the_Moon_1902',
    embedUrl: 'https://archive.org/embed/A_Trip_to_the_Moon_1902',
    itemUrl: 'https://archive.org/details/A_Trip_to_the_Moon_1902',
  },
  {
    identifier: 'computer_history_museum_demo',
    title: 'Early Computing & Microprocessor Revolution',
    description: 'Archival video documenting the genesis of computer chips, ENIAC, and personal computing.',
    mediaType: 'movies',
    year: '1977',
    creator: 'Computer History Museum',
    thumbnail: 'https://archive.org/services/img/computer_history_museum_demo',
    embedUrl: 'https://archive.org/embed/computer_history_museum_demo',
    itemUrl: 'https://archive.org/details/computer_history_museum_demo',
  },
  {
    identifier: '78_sing-sing-sing-with-a-swing_benny-goodman-and-his-orchestra-louis-prima_gbia0011853a',
    title: 'Sing, Sing, Sing (78rpm Gramophone Archive)',
    description: 'High definition audio transfer of the original 78rpm Benny Goodman Orchestra swing classic from 1937.',
    mediaType: 'audio',
    year: '1937',
    creator: 'Benny Goodman',
    thumbnail: 'https://archive.org/services/img/george-blood-78s',
    embedUrl: 'https://archive.org/embed/78_sing-sing-sing-with-a-swing_benny-goodman-and-his-orchestra-louis-prima_gbia0011853a',
    itemUrl: 'https://archive.org/details/78_sing-sing-sing-with-a-swing_benny-goodman-and-his-orchestra-louis-prima_gbia0011853a',
  },
  {
    identifier: 'msdos_Pac-Man_1983',
    title: 'Pac-Man (MS-DOS Arcade Emulator)',
    description: 'Classic arcade game preserved in Internet Archive MS-DOS Software Library.',
    mediaType: 'software',
    year: '1983',
    creator: 'Namco / Midway',
    thumbnail: 'https://archive.org/services/img/msdos_Pac-Man_1983',
    embedUrl: 'https://archive.org/embed/msdos_Pac-Man_1983',
    itemUrl: 'https://archive.org/details/msdos_Pac-Man_1983',
  },
  {
    identifier: 'RelativityByAlbertEinstein',
    title: 'Relativity: The Special and General Theory by Albert Einstein',
    description: 'Original digitized book publication of Albert Einstein explaining relativity to general public.',
    mediaType: 'texts',
    year: '1920',
    creator: 'Albert Einstein',
    thumbnail: 'https://archive.org/services/img/RelativityByAlbertEinstein',
    embedUrl: 'https://archive.org/embed/RelativityByAlbertEinstein',
    itemUrl: 'https://archive.org/details/RelativityByAlbertEinstein',
  },
];
