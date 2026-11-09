import {
  WikiItem,
  ArchiveItem,
  GutenbergBook,
  OpenLibraryBook,
  MusicBrainzRelease,
  JamendoTrack,
  OpenverseImage,
  GitHubRepo,
  Language,
  EngineMode,
} from '../types';

import { searchWikipedia } from './wikiService';
import { searchInternetArchive } from './archiveService';
import { searchGutenberg } from './gutenbergService';
import { searchOpenLibrary } from './openLibraryService';
import { searchMusicBrainz } from './musicBrainzService';
import { searchJamendoTracks } from './jamendoService';
import { searchOpenverseImages } from './openverseService';
import { searchGitHubRepos } from './githubService';
import { sendPollinationsChat } from './pollinationsService';

export interface AISynthesizeResult {
  text: string;
  wikiItems: WikiItem[];
  archiveItems: ArchiveItem[];
  gutenbergBooks: GutenbergBook[];
  openLibraryBooks: OpenLibraryBook[];
  musicBrainzReleases: MusicBrainzRelease[];
  jamendoTracks: JamendoTrack[];
  openverseImages: OpenverseImage[];
  githubRepos: GitHubRepo[];
  suggestedQuestions: string[];
}

export async function askWikiArchiveBot(
  prompt: string,
  lang: Language = 'he',
  _engineMode: EngineMode = 'server'
): Promise<AISynthesizeResult> {
  const isHe = lang === 'he';

  // Query open knowledge platforms concurrently
  const [
    wikiItems,
    archiveItems,
    gutenbergBooks,
    openLibraryBooks,
    musicBrainzReleases,
    jamendoTracks,
    openverseImages,
    githubRepos,
  ] = await Promise.all([
    searchWikipedia(prompt, lang, 3),
    searchInternetArchive(prompt, 'all', 4),
    searchGutenberg(prompt, 3),
    searchOpenLibrary(prompt, 3),
    searchMusicBrainz(prompt, 3),
    searchJamendoTracks(prompt, 3),
    searchOpenverseImages(prompt, 3),
    searchGitHubRepos(prompt, 3),
  ]);

  // Construct context for Pollinations.ai API
  let contextBrief = '';
  if (wikiItems.length > 0) {
    contextBrief += `\nמידע ויקיפדיה: ${wikiItems[0].title} - ${wikiItems[0].extract || wikiItems[0].snippet}`;
  }
  if (archiveItems.length > 0) {
    contextBrief += `\nארכיון האינטרנט: ${archiveItems.map((a) => a.title).join(', ')}`;
  }
  if (gutenbergBooks.length > 0) {
    contextBrief += `\nספרי גוטנברג: ${gutenbergBooks.map((b) => b.title).join(', ')}`;
  }

  const systemPrompt = isHe
    ? `אתה עוזר בינה מלאכותית חכם ומלומד המחובר למאגרי ידע פתוחים (Pollinations.ai API).
ענה בעברית עשירה, רהוטה ומזמינה. ספק הסבר מקיף, מעניין ומדויק על השאלה של המשתמש. השתמש בעיצוב Markdown ברור (כותרות, נקודות, הדגשות).
אם יש מידע רלוונטי מהמאגרים הבאים, שזור אותו בתשובתך בטבעיות:
${contextBrief}`
    : `You are an intelligent knowledge assistant powered by the Pollinations.ai API.
Provide comprehensive, engaging, and accurate responses in English. Use clean Markdown formatting.
Context from open archives: ${contextBrief}`;

  try {
    const aiResponse = await sendPollinationsChat(
      [{ role: 'user', content: prompt }],
      systemPrompt
    );

    if (aiResponse && aiResponse.trim().length > 0) {
      return {
        text: aiResponse,
        wikiItems,
        archiveItems,
        gutenbergBooks,
        openLibraryBooks,
        musicBrainzReleases,
        jamendoTracks,
        openverseImages,
        githubRepos,
        suggestedQuestions: generateSuggestedQuestions(prompt, wikiItems, lang),
      };
    }
  } catch (err) {
    console.warn('Pollinations API call had issue, generating fallback RAG:', err);
  }

  // Fallback if network drops
  const text = generateMultiPlatformClientRAG(
    prompt,
    wikiItems,
    archiveItems,
    gutenbergBooks,
    openLibraryBooks,
    musicBrainzReleases,
    jamendoTracks,
    openverseImages,
    githubRepos,
    lang
  );

  return {
    text,
    wikiItems,
    archiveItems,
    gutenbergBooks,
    openLibraryBooks,
    musicBrainzReleases,
    jamendoTracks,
    openverseImages,
    githubRepos,
    suggestedQuestions: generateSuggestedQuestions(prompt, wikiItems, lang),
  };
}

function generateMultiPlatformClientRAG(
  prompt: string,
  wiki: WikiItem[],
  archive: ArchiveItem[],
  gutenberg: GutenbergBook[],
  openLibrary: OpenLibraryBook[],
  mb: MusicBrainzRelease[],
  jamendo: JamendoTrack[],
  _openverse: OpenverseImage[],
  github: GitHubRepo[],
  lang: Language
): string {
  const isHe = lang === 'he';

  let text = isHe ? `### 🧠 ניתוח מולטי-פלטפורמה: "${prompt}"\n\n` : `### 🧠 Multi-Platform Synthesis: "${prompt}"\n\n`;

  if (wiki.length > 0) {
    text += isHe ? `**📖 אנציקלופדיה (Wikipedia):**\n` : `**📖 Encyclopedia (Wikipedia):**\n`;
    text += `${wiki[0].extract || wiki[0].snippet}\n\n`;
  }

  if (archive.length > 0) {
    text += isHe ? `**📽️ ארכיון המדיה (Internet Archive):**\n` : `**📽️ Internet Archive Media:**\n`;
    text += `- ${archive[0].title} (${archive[0].year || 'ארכיון'})\n\n`;
  }

  if (gutenberg.length > 0 || openLibrary.length > 0) {
    text += isHe ? `**📚 ספרות ומסמכים (Project Gutenberg & Open Library):**\n` : `**📚 Literature & Catalog:**\n`;
    if (gutenberg[0]) text += `- Gutenberg: *${gutenberg[0].title}* (הורדות: ${gutenberg[0].downloadCount})\n`;
    if (openLibrary[0]) text += `- Open Library: *${openLibrary[0].title}* (${openLibrary[0].authorNames.join(', ') || 'סופר ne'})\n`;
    text += `\n`;
  }

  if (jamendo.length > 0 || mb.length > 0) {
    text += isHe ? `**🎵 מוזיקה ואודיו:**\n` : `**🎵 Audio & Music:**\n`;
    if (jamendo[0]) text += `- Direct Audio Stream: *${jamendo[0].name}* - ${jamendo[0].artistName}\n`;
    if (mb[0]) text += `- MusicBrainz: *${mb[0].title}* (${mb[0].artistName})\n`;
    text += `\n`;
  }

  if (github.length > 0) {
    text += isHe ? `**💻 פרויקטים בקוד פתוח (GitHub):**\n` : `**💻 GitHub Open Source Projects:**\n`;
    text += `- [${github[0].fullName}](${github[0].htmlUrl}) ⭐ ${github[0].stars.toLocaleString()} stars — ${github[0].description}\n\n`;
  }

  text += isHe
    ? `**💡 הנתונים סונכרנו בהצלחה ממאגרי הידע הפתוחים.**`
    : `**💡 Real-time results retrieved from global open archives.**`;

  return text;
}

function generateSuggestedQuestions(prompt: string, wiki: WikiItem[], lang: Language): string[] {
  const isHe = lang === 'he';
  const topic = wiki[0]?.title || prompt;

  if (isHe) {
    return [
      `מה המשמעות ההיסטורית של ${topic}?`,
      `הראה לי פרויקטי קוד ומחקר על ${topic}`,
      `ספר לי עובדות מרתקות על ${topic}`,
      `מהם המקורות והספרים המומלצים בנושא ${topic}?`,
    ];
  } else {
    return [
      `What is the history behind ${topic}?`,
      `Show me research projects regarding ${topic}`,
      `Tell me surprising facts about ${topic}`,
      `Recommended books and resources for ${topic}`,
    ];
  }
}
