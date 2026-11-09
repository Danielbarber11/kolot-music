import { WikiItem, Language } from '../types';

export async function searchWikipedia(
  query: string,
  lang: Language = 'he',
  limit: number = 6
): Promise<WikiItem[]> {
  if (!query.trim()) return [];

  const baseUrl = lang === 'he' ? 'https://he.wikipedia.org' : 'https://en.wikipedia.org';
  const searchUrl = `${baseUrl}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&utf8=1&format=json&origin=*&srlimit=${limit}`;

  try {
    const res = await fetch(searchUrl);
    if (!res.ok) throw new Error('Wikipedia search failed');
    const data = await res.json();

    const searchResults = data.query?.search || [];
    if (searchResults.length === 0) {
      // Fallback to English if Hebrew gave zero results
      if (lang === 'he') {
        return searchWikipedia(query, 'en', limit);
      }
      return [];
    }

    // Fetch extra details (extracts + thumbnail images) for these pages
    const pageTitles = searchResults.map((r: any) => r.title).join('|');
    const detailsUrl = `${baseUrl}/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&titles=${encodeURIComponent(
      pageTitles
    )}&piprop=thumbnail&pithumbsize=500&format=json&origin=*`;

    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();
    const pages = detailsData.query?.pages || {};

    const items: WikiItem[] = searchResults.map((item: any) => {
      const pageDetail = Object.values(pages).find((p: any) => p.title === item.title) as any;
      const cleanSnippet = item.snippet
        .replace(/<span class="searchmatch">/g, '')
        .replace(/<\/span>/g, '')
        .replace(/&quot;/g, '"');

      return {
        pageid: item.pageid,
        title: item.title,
        snippet: cleanSnippet,
        extract: pageDetail?.extract || cleanSnippet,
        pageUrl: `${baseUrl}/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        thumbnail: pageDetail?.thumbnail?.source,
        language: lang,
        lastModified: item.timestamp,
      };
    });

    return items;
  } catch (err) {
    console.error('Wikipedia search error:', err);
    return [];
  }
}

export async function getWikipediaFeaturedOrRandom(lang: Language = 'he'): Promise<WikiItem[]> {
  const popularTopics =
    lang === 'he'
      ? ['אלברט איינשטיין', 'מסע בחלל', 'מחשב', 'תל אביב', 'ארכיון האינטרנט', 'מלחמת העולם השנייה', 'בינה מלאכותית']
      : ['Apollo 11', 'Internet Archive', 'Albert Einstein', 'Computer science', 'Artificial intelligence', 'World War II'];

  const randomTopic = popularTopics[Math.floor(Math.random() * popularTopics.length)];
  return searchWikipedia(randomTopic, lang, 4);
}
