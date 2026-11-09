export interface DuckDuckGoWebResult {
  title: string;
  url: string;
  embedUrl?: string;
  snippet: string;
  favicon?: string;
  displayUrl: string;
}

export interface DuckDuckGoResponse {
  heading: string;
  abstract: string;
  abstractUrl: string;
  imageUrl?: string;
  source: string;
  webResults: DuckDuckGoWebResult[];
}

export async function searchDuckDuckGoWeb(query: string): Promise<DuckDuckGoResponse | null> {
  const cleanQ = query.trim();
  if (!cleanQ) return null;

  const lower = cleanQ.toLowerCase();
  const directPicks: DuckDuckGoWebResult[] = [];

  // Special popular direct portal resolvers (e.g., YouTube, Google, Wikipedia)
  if (lower.includes('יוטיוב') || lower.includes('youtube')) {
    directPicks.push(
      {
        title: 'YouTube - שיתוף וצפייה בסרטונים ומוזיקה',
        url: 'https://www.youtube.com',
        embedUrl: `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(cleanQ.replace(/יוטיוב|youtube/gi, '').trim() || 'trending')}`,
        snippet: 'אתר שיתוף הווידאו הגדול בעולם. צפה בסרטונים, ערוצים, מוזיקה ושידורים חיים מכל העולם.',
        displayUrl: 'youtube.com',
        favicon: 'https://icons.duckduckgo.com/ip3/youtube.com.ico',
      },
      {
        title: 'YouTube Music - מוזיקה והופעות חיות',
        url: 'https://music.youtube.com',
        snippet: 'שירות הזרמת המוזיקה הרשמי של YouTube. אלבומים, סינגלים, הופעות חיות וקליפים.',
        displayUrl: 'music.youtube.com',
        favicon: 'https://icons.duckduckgo.com/ip3/music.youtube.com.ico',
      }
    );
  } else if (lower.includes('גוגל') || lower.includes('google')) {
    directPicks.push({
      title: 'Google - מנוע חיפוש עולמי',
      url: 'https://www.google.com',
      snippet: 'מנוע החיפוש הפופולרי בעולם לחיפוש מידע, אתרים, תמונות וחדשות.',
      displayUrl: 'google.com',
      favicon: 'https://icons.duckduckgo.com/ip3/google.com.ico',
    });
  }

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQ)}&format=json&no_redirect=1&no_html=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('DuckDuckGo API request failed');
    const data = await res.json();

    const related = (data.RelatedTopics || []).map((item: any) => {
      const topicText = item.Text || '';
      const topicUrl = item.FirstURL || '';
      const display = topicUrl.replace(/^https?:\/\//, '').split('/')[0] || topicUrl;

      return {
        title: topicText.slice(0, 60) + (topicText.length > 60 ? '...' : ''),
        url: topicUrl,
        snippet: topicText,
        displayUrl: display,
        favicon: `https://icons.duckduckgo.com/ip3/${display}.ico`,
      };
    }).filter((r: DuckDuckGoWebResult) => r.url && r.snippet);

    const fallbackSites: DuckDuckGoWebResult[] = [
      {
        title: `${cleanQ} - ויקיפדיה האנציקלופדיה החופשית`,
        url: `https://he.wikipedia.org/wiki/${encodeURIComponent(cleanQ)}`,
        snippet: `קרא מידע מלא אודות ${cleanQ} במיזם האנציקלופדיה החופשית ויקיפדיה.`,
        displayUrl: 'he.wikipedia.org',
        favicon: 'https://icons.duckduckgo.com/ip3/he.wikipedia.org.ico',
      },
      {
        title: `${cleanQ} - ארכיון האינטרנט (Internet Archive)`,
        url: `https://archive.org/search.php?query=${encodeURIComponent(cleanQ)}`,
        snippet: `חפש קבצי היסטוריה, סרטונים, ספרים ואודיו בנושא ${cleanQ} בארכיון האינטרנט.`,
        displayUrl: 'archive.org',
        favicon: 'https://icons.duckduckgo.com/ip3/archive.org.ico',
      },
    ];

    const combinedWeb = [...directPicks, ...related, ...(related.length === 0 && directPicks.length === 0 ? fallbackSites : [])];

    return {
      heading: data.Heading || cleanQ,
      abstract: data.Abstract || data.AbstractText || '',
      abstractUrl: data.AbstractURL || '',
      imageUrl: data.Image ? `https://duckduckgo.com${data.Image}` : undefined,
      source: data.AbstractSource || 'DuckDuckGo Web Search',
      webResults: combinedWeb,
    };
  } catch (err) {
    console.error('DuckDuckGo search error:', err);
    return {
      heading: cleanQ,
      abstract: '',
      abstractUrl: '',
      source: 'DuckDuckGo Fallback Engine',
      webResults: directPicks.length > 0 ? directPicks : [
        {
          title: `${cleanQ} - ויקיפדיה`,
          url: `https://he.wikipedia.org/wiki/${encodeURIComponent(cleanQ)}`,
          snippet: `מידע חופשי אודות ${cleanQ} בויקיפדיה.`,
          displayUrl: 'he.wikipedia.org',
          favicon: 'https://icons.duckduckgo.com/ip3/he.wikipedia.org.ico',
        },
      ],
    };
  }
}
