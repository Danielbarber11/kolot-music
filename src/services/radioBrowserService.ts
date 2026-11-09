export interface RadioStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  votes: number;
  clickcount: number;
}

export async function searchRadioStations(query?: string, limit: number = 24): Promise<RadioStation[]> {
  try {
    const baseUrl = 'https://de1.api.radio-browser.info/json/stations';
    const endpoint = query && query.trim()
      ? `${baseUrl}/byname/${encodeURIComponent(query)}?limit=${limit}&order=clickcount&reverse=true`
      : `${baseUrl}/search?limit=${limit}&order=clickcount&reverse=true&has_extended_info=true`;

    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('Radio Browser API failed');
    const data = await res.json();

    return (data || []).map((st: any) => ({
      stationuuid: st.stationuuid,
      name: st.name?.trim() || 'Live Radio Station',
      url: st.url_resolved || st.url,
      url_resolved: st.url_resolved || st.url,
      homepage: st.homepage || '',
      favicon: st.favicon || 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=200&q=80',
      tags: st.tags || 'pop, news, music',
      country: st.country || 'Global',
      votes: st.votes || 0,
      clickcount: st.clickcount || 0,
    })).filter((st: RadioStation) => st.url_resolved && st.name);
  } catch (err) {
    console.error('Radio Browser API error:', err);
    return [];
  }
}
