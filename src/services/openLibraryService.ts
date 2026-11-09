import { OpenLibraryBook } from '../types';

export async function searchOpenLibrary(query: string, limit: number = 6): Promise<OpenLibraryBook[]> {
  if (!query.trim()) return [];

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library fetch failed');
    const data = await res.json();

    const docs = data.docs || [];
    return docs.map((doc: any) => {
      const coveri = doc.cover_i;
      const coverUrl = coveri ? `https://covers.openlibrary.org/b/id/${coveri}-M.jpg` : undefined;

      return {
        key: doc.key,
        title: doc.title || 'Untitled',
        authorNames: doc.author_name || [],
        firstPublishYear: doc.first_publish_year,
        coverUrl,
        editionCount: doc.edition_count,
        subjects: (doc.subject || []).slice(0, 3),
        isbn: (doc.isbn || []).slice(0, 2),
      };
    });
  } catch (err) {
    console.error('Open Library search error:', err);
    return [];
  }
}
