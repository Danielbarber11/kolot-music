import { OpenverseImage } from '../types';

export async function searchOpenverseImages(query: string, limit: number = 6): Promise<OpenverseImage[]> {
  if (!query.trim()) return [];

  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Openverse API request failed');
    const data = await res.json();

    const results = data.results || [];
    return results.map((img: any) => ({
      id: img.id,
      title: img.title || 'Public Domain Artwork',
      creator: img.creator,
      url: img.url,
      thumbnailUrl: img.thumbnail || img.url,
      license: img.license || 'CC0',
      licenseUrl: img.license_url,
      source: img.source || 'Openverse',
    }));
  } catch (err) {
    console.error('Openverse search error:', err);
    return [];
  }
}
