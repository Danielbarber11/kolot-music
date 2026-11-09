import { GutenbergBook } from '../types';

export async function searchGutenberg(query: string, limit: number = 6): Promise<GutenbergBook[]> {
  if (!query.trim()) return [];

  const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Gutendex fetch failed');
    const data = await res.json();

    const results = data.results || [];
    return results.slice(0, limit).map((book: any) => {
      const formats = book.formats || {};
      const coverUrl = formats['image/jpeg'] || `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`;
      const htmlUrl = formats['text/html'] || formats['text/html; charset=utf-8'];
      const epubUrl = formats['application/epub+zip'];
      const txtUrl = formats['text/plain; charset=us-ascii'] || formats['text/plain'];

      return {
        id: book.id,
        title: book.title || 'Untitled Book',
        authors: (book.authors || []).map((a: any) => ({
          name: a.name,
          birth_year: a.birth_year,
          death_year: a.death_year,
        })),
        subjects: (book.subjects || []).slice(0, 4),
        languages: book.languages || ['en'],
        downloadCount: book.download_count || 0,
        coverUrl,
        readUrl: htmlUrl || `https://www.gutenberg.org/ebooks/${book.id}`,
        epubUrl,
        txtUrl,
      };
    });
  } catch (err) {
    console.error('Project Gutenberg search error:', err);
    return [];
  }
}
