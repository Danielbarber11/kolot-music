import React, { useState, useEffect } from 'react';
import {
  Film,
  Music,
  BookOpen,
  Gamepad2,
  Globe,
  Search,
  Play,
  Download,
  ExternalLink,
  Sparkles,
  Filter,
  Eye,
  Bookmark,
} from 'lucide-react';
import { ArchiveItem, MediaType, Language } from '../types';
import { searchInternetArchive, CURATED_ARCHIVE_ITEMS } from '../services/archiveService';

interface MediaArchiveViewProps {
  lang: Language;
  onPlayMedia: (item: ArchiveItem) => void;
  onBookmark: (title: string, summary: string, url: string, type: 'archive', extra?: any) => void;
}

export const MediaArchiveView: React.FC<MediaArchiveViewProps> = ({
  lang,
  onPlayMedia,
  onBookmark,
}) => {
  const isHe = lang === 'he';

  const [activeFilter, setActiveFilter] = useState<MediaType>('movies');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<ArchiveItem[]>(CURATED_ARCHIVE_ITEMS);
  const [loading, setLoading] = useState(false);

  const filterTabs = [
    { id: 'movies', label: isHe ? '🎥 סרטונים ווידאו' : '🎥 Videos & Films', icon: Film },
    { id: 'audio', label: isHe ? '📻 אודיו והקלטות' : '📻 Audio & Music', icon: Music },
    { id: 'texts', label: isHe ? '📚 ספרים ומסמכים' : '📚 Books & Texts', icon: BookOpen },
    { id: 'software', label: isHe ? '🎮 תוכנות ומשחקים' : '🎮 Software & Games', icon: Gamepad2 },
    { id: 'all', label: isHe ? '🌐 כל הסוגים' : '🌐 All Categories', icon: Globe },
  ];

  const quickPills = [
    { label: isHe ? 'אפולו 11 ונאס"א' : 'Apollo 11 & NASA', query: 'Apollo 11 NASA moon landing' },
    { label: isHe ? 'סרטים אלמים 1900' : 'Silent Films 1900s', query: 'Georges Melies silent film 1900' },
    { label: isHe ? 'היסטוריית המחשב' : 'Computer History', query: 'ENIAC microcomputer history' },
    { label: isHe ? 'הקלטות 78rpm' : 'Vintage 78rpm Music', query: '78rpm swing jazz orchestra' },
    { label: isHe ? 'משחקי MS-DOS' : 'Retro MS-DOS Games', query: 'MS-DOS arcade game' },
    { label: isHe ? 'אלברט איינשטיין' : 'Albert Einstein Papers', query: 'Albert Einstein physics relativity' },
  ];

  const handleSearch = async (queryText?: string) => {
    const q = queryText !== undefined ? queryText : searchQuery;
    if (!q.trim()) {
      setItems(CURATED_ARCHIVE_ITEMS.filter((i) => activeFilter === 'all' || i.mediaType === activeFilter));
      return;
    }

    setLoading(true);
    try {
      const results = await searchInternetArchive(q, activeFilter, 12);
      setItems(results.length > 0 ? results : CURATED_ARCHIVE_ITEMS);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, [activeFilter]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-mono mb-3">
            <Film className="w-3.5 h-3.5" />
            <span>INTERNET ARCHIVE MEDIA VAULT</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {isHe ? 'ארכיון סרטונים, אודיו ומדיה היסטורית' : 'Historical Video, Audio & Document Vault'}
          </h1>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed">
            {isHe
              ? 'גלה מיליוני סרטונים היסטוריים, שידורי רדיו ישנים, ספרים סרוקים ומשחקי רטרו מארכיון האינטרנט העולמי (Internet Archive). נגן והקרן ישירות במכשיר שלך.'
              : 'Explore millions of open historic newsreels, vintage broadcasts, digitized books, and games preserved in the Internet Archive. Stream or download directly.'}
          </p>

          {/* Quick Filter Pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {quickPills.map((pill, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setSearchQuery(pill.query);
                  handleSearch(pill.query);
                }}
                className="px-3 py-1 text-xs bg-slate-800/80 hover:bg-indigo-600/30 text-indigo-200 border border-slate-700 rounded-full transition-all flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>{pill.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-2xl">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto custom-scrollbar pb-1 md:pb-0">
          {filterTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id as MediaType)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'bg-slate-950/60 text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="relative w-full md:w-80"
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isHe ? 'חפש בארכיון הוידאו...' : 'Search archive media...'}
            className="w-full pr-10 pl-10 py-2 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </form>
      </div>

      {/* Media Items Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n} className="h-64 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/50 border border-slate-800 rounded-3xl">
          <Film className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-300">
            {isHe ? 'לא נמצאו פריטי מדיה מתאימים' : 'No media items found'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {isHe ? 'נסה לחפש מונח באנגלית או לשנות את הסינון' : 'Try searching for another keyword or changing the filter'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {items.map((item) => (
            <div
              key={item.identifier}
              className="group bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl hover:shadow-indigo-500/10 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Media Thumbnail Container */}
                <div
                  className="relative h-44 bg-slate-950 cursor-pointer overflow-hidden group"
                  onClick={() => onPlayMedia(item)}
                >
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-indigo-600/90 group-hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-all">
                      <Play className="w-6 h-6 fill-current translate-x-0.5" />
                    </div>
                  </div>

                  {/* Year Tag */}
                  {item.year && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-950/80 text-amber-300 border border-slate-700/80 rounded-md backdrop-blur-sm">
                      {item.year}
                    </span>
                  )}

                  <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-500/30 rounded-md backdrop-blur-sm">
                    {item.mediaType}
                  </span>
                </div>

                {/* Details */}
                <div className="p-4">
                  <h3
                    onClick={() => onPlayMedia(item)}
                    className="font-bold text-sm text-white hover:text-indigo-300 line-clamp-2 cursor-pointer transition-colors"
                  >
                    {item.title}
                  </h3>

                  {item.description && (
                    <p className="text-xs text-slate-400 line-clamp-2 mt-1.5 leading-relaxed">
                      {item.description}
                    </p>
                  )}

                  {item.creator && (
                    <p className="text-[11px] text-indigo-400/80 mt-2 font-medium truncate">
                      👤 {item.creator}
                    </p>
                  )}
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="px-4 py-3 bg-slate-950/60 border-t border-slate-800/80 flex items-center justify-between">
                <button
                  onClick={() => onPlayMedia(item)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isHe ? 'צפה / נגן' : 'Watch'}</span>
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      onBookmark(
                        item.title,
                        item.description || item.title,
                        item.itemUrl,
                        'archive',
                        item
                      )
                    }
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                    title={isHe ? 'שמור לאוסף' : 'Bookmark'}
                  >
                    <Bookmark className="w-4 h-4" />
                  </button>

                  <a
                    href={item.itemUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    title={isHe ? 'פתח ב-Internet Archive' : 'Open in Archive.org'}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
