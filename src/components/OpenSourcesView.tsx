import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Music,
  Code,
  Image,
  Globe,
  Search,
  ExternalLink,
  Star,
  GitFork,
  Play,
  Download,
  Sparkles,
  BookMarked,
  Disc,
} from 'lucide-react';
import { motion } from 'motion/react';

import {
  GutenbergBook,
  OpenLibraryBook,
  MusicBrainzRelease,
  JamendoTrack,
  OpenverseImage,
  GitHubRepo,
  Language,
} from '../types';

import { searchGutenberg } from '../services/gutenbergService';
import { searchOpenLibrary } from '../services/openLibraryService';
import { searchMusicBrainz } from '../services/musicBrainzService';
import { searchJamendoTracks, CURATED_JAMENDO_TRACKS } from '../services/jamendoService';
import { searchOpenverseImages } from '../services/openverseService';
import { searchGitHubRepos, CURATED_GITHUB_REPOS } from '../services/githubService';

interface OpenSourcesViewProps {
  lang: Language;
  onPlayTrack: (track: JamendoTrack) => void;
  onAskBotAbout: (topic: string) => void;
}

export const OpenSourcesView: React.FC<OpenSourcesViewProps> = ({
  lang,
  onPlayTrack,
  onAskBotAbout,
}) => {
  const isHe = lang === 'he';

  const [activeCategory, setActiveCategory] = useState<
    'github' | 'gutenberg' | 'openlibrary' | 'jamendo' | 'musicbrainz' | 'openverse'
  >('github');

  const [query, setQuery] = useState('react');
  const [loading, setLoading] = useState(false);

  // States
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>(CURATED_GITHUB_REPOS);
  const [gutenbergBooks, setGutenbergBooks] = useState<GutenbergBook[]>([]);
  const [openLibraryBooks, setOpenLibraryBooks] = useState<OpenLibraryBook[]>([]);
  const [jamendoTracks, setJamendoTracks] = useState<JamendoTrack[]>(CURATED_JAMENDO_TRACKS);
  const [mbReleases, setMbReleases] = useState<MusicBrainzRelease[]>([]);
  const [openverseImages, setOpenverseImages] = useState<OpenverseImage[]>([]);

  const handleSearch = async (searchTerm?: string) => {
    const q = searchTerm !== undefined ? searchTerm : query;
    if (!q.trim()) return;

    setLoading(true);
    try {
      if (activeCategory === 'github') {
        const res = await searchGitHubRepos(q, 8);
        setGithubRepos(res);
      } else if (activeCategory === 'gutenberg') {
        const res = await searchGutenberg(q, 8);
        setGutenbergBooks(res);
      } else if (activeCategory === 'openlibrary') {
        const res = await searchOpenLibrary(q, 8);
        setOpenLibraryBooks(res);
      } else if (activeCategory === 'jamendo') {
        const res = await searchJamendoTracks(q, 8);
        setJamendoTracks(res);
      } else if (activeCategory === 'musicbrainz') {
        const res = await searchMusicBrainz(q, 8);
        setMbReleases(res);
      } else if (activeCategory === 'openverse') {
        const res = await searchOpenverseImages(q, 8);
        setOpenverseImages(res);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, [activeCategory]);

  const categories = [
    { id: 'github', label: isHe ? '💻 פרויקטים ב-GitHub' : '💻 GitHub Repositories', icon: Code },
    { id: 'gutenberg', label: isHe ? '📚 Project Gutenberg' : '📚 Project Gutenberg', icon: BookOpen },
    { id: 'openlibrary', label: isHe ? '📖 Open Library' : '📖 Open Library Catalog', icon: BookMarked },
    { id: 'jamendo', label: isHe ? '🎵 מוזיקה ב-Jamendo' : '🎵 Jamendo Free Music', icon: Music },
    { id: 'musicbrainz', label: isHe ? '💿 MusicBrainz' : '💿 MusicBrainz Releases', icon: Disc },
    { id: 'openverse', label: isHe ? '🖼️ אמנות Openverse' : '🖼️ Openverse CC Art', icon: Image },
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="bg-[#121522]/90 border border-white/10 rounded-3xl p-6 shadow-2xl backdrop-blur-2xl">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-mono mb-3">
            <Globe className="w-3.5 h-3.5" />
            <span>8 OPEN KNOWLEDGE & CODE REPOSITORIES</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {isHe ? 'מרכז מאגרי הידע החופשיים' : 'Open Sources & Code Repository Hub'}
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm mt-2 leading-relaxed">
            {isHe
              ? 'חפש וסקור פרויקטי קוד ב-GitHub, ספרים ב-Project Gutenberg & Open Library, מוזיקה ב-Jamendo & MusicBrainz, ואמנות ב-Openverse.'
              : 'Search open source GitHub repos, Gutenberg & OpenLibrary ebooks, Jamendo music streams, MusicBrainz catalogs, and Openverse visual art.'}
          </p>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-[#0e101a] border border-white/10 p-3 rounded-2xl">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 custom-scrollbar">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <motion.button
                whileTap={{ scale: 0.95 }}
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id as any);
                  setQuery(cat.id === 'github' ? 'react' : cat.id === 'gutenberg' ? 'sherlock' : 'classical');
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40'
                    : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{cat.label}</span>
              </motion.button>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="relative w-full md:w-80"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHe ? 'חפש קוד, ספרים, מוזיקה...' : 'Search repos, books, music...'}
            className="w-full pr-10 pl-10 py-2 bg-slate-950 border border-white/15 focus:border-indigo-500 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </form>
      </div>

      {/* Grid Results Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-56 bg-slate-900 border border-white/10 rounded-2xl p-4" />
          ))}
        </div>
      ) : activeCategory === 'github' ? (
        /* GitHub Repositories Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {githubRepos.map((repo) => (
            <div
              key={repo.id}
              className="bg-[#11131f]/90 border border-white/10 hover:border-indigo-500/50 rounded-2xl p-5 shadow-xl transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <img src={repo.owner.avatarUrl} alt={repo.owner.login} className="w-6 h-6 rounded-full border border-white/20" />
                    <span className="text-xs font-mono text-slate-400">{repo.owner.login}</span>
                  </div>
                  {repo.language && (
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 rounded-md">
                      {repo.language}
                    </span>
                  )}
                </div>

                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-base text-white hover:text-indigo-300 transition-colors block line-clamp-1"
                >
                  {repo.name}
                </a>

                <p className="text-xs text-slate-300 line-clamp-2 mt-2 leading-relaxed">
                  {repo.description}
                </p>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {repo.topics?.map((topic, i) => (
                    <span key={i} className="px-2 py-0.5 text-[9px] bg-slate-800 text-slate-300 rounded-md">
                      #{topic}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 font-mono text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {repo.stars.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <GitFork className="w-3.5 h-3.5" />
                    {repo.forks.toLocaleString()}
                  </span>
                </div>

                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold flex items-center gap-1 transition-all"
                >
                  GitHub
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : activeCategory === 'gutenberg' ? (
        /* Project Gutenberg Books Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {gutenbergBooks.map((book) => (
            <div
              key={book.id}
              className="bg-[#11131f]/90 border border-white/10 hover:border-amber-500/50 rounded-2xl p-4 shadow-xl transition-all flex flex-col justify-between"
            >
              <div>
                <div className="relative h-48 bg-slate-950 rounded-xl overflow-hidden mb-3 border border-white/10 flex items-center justify-center">
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                  ) : (
                    <BookOpen className="w-12 h-12 text-slate-600" />
                  )}
                </div>

                <h3 className="font-bold text-sm text-white line-clamp-2">{book.title}</h3>
                <p className="text-xs text-slate-400 mt-1 truncate">
                  ✍️ {book.authors.map((a) => a.name).join(', ') || 'Unknown Author'}
                </p>
              </div>

              <div className="mt-4 pt-2 border-t border-white/10 flex items-center justify-between">
                <a
                  href={book.readUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1 shadow"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>{isHe ? 'קרא ספר' : 'Read Book'}</span>
                </a>

                {book.epubUrl && (
                  <a
                    href={book.epubUrl}
                    download
                    className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs"
                    title="Download EPUB"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : activeCategory === 'jamendo' ? (
        /* Jamendo Music Stream Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {jamendoTracks.map((track) => (
            <div
              key={track.id}
              className="bg-[#11131f]/90 border border-white/10 hover:border-indigo-500/50 rounded-2xl p-4 shadow-xl transition-all flex flex-col justify-between"
            >
              <div>
                <div className="relative h-40 bg-slate-950 rounded-xl overflow-hidden mb-3 group cursor-pointer" onClick={() => onPlayTrack(track)}>
                  <img src={track.coverUrl} alt={track.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  <div className="absolute inset-0 bg-slate-950/40 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg">
                      <Play className="w-6 h-6 fill-current translate-x-0.5" />
                    </div>
                  </div>
                </div>

                <h3 className="font-bold text-sm text-white line-clamp-1">{track.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{track.artistName}</p>
              </div>

              <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between">
                <button
                  onClick={() => onPlayTrack(track)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isHe ? 'נגן כעת' : 'Stream Track'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Fallback / General Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {openverseImages.map((img) => (
            <div key={img.id} className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden p-3">
              <img src={img.thumbnailUrl} alt={img.title} className="w-full h-36 object-cover rounded-xl mb-2" />
              <h4 className="font-bold text-xs text-white truncate">{img.title}</h4>
              <p className="text-[11px] text-slate-400">{img.creator || 'Openverse CC'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
