import React, { useState, useEffect } from 'react';
import { Search, BookOpen, Film, ExternalLink, Sparkles, Play, ArrowRightLeft, Music2 } from 'lucide-react';
import { WikiItem, ArchiveItem, Language, JamendoTrack } from '../types';
import { searchWikipedia } from '../services/wikiService';
import { searchInternetArchive } from '../services/archiveService';
import { getInstantSongPool, fetchLiveAudioFromArchive } from '../services/multiMusicService';
import { AudioTTSPlayer } from './AudioTTSPlayer';

interface SearchExplorerViewProps {
  lang: Language;
  onPlayMedia: (item: ArchiveItem) => void;
  onPlaySong?: (track: JamendoTrack) => void;
  onAskBotAbout: (topic: string) => void;
}

export const SearchExplorerView: React.FC<SearchExplorerViewProps> = ({
  lang,
  onPlayMedia,
  onPlaySong,
  onAskBotAbout,
}) => {
  const isHe = lang === 'he';

  const [query, setQuery] = useState('מוזיקה ומדע');
  const [wikiResults, setWikiResults] = useState<WikiItem[]>([]);
  const [archiveResults, setArchiveResults] = useState<ArchiveItem[]>([]);
  const [songResults, setSongResults] = useState<JamendoTrack[]>([]);
  const [loading, setLoading] = useState(false);

  const executeUnifiedSearch = async (qText?: string) => {
    const searchWord = qText !== undefined ? qText : query;
    if (!searchWord.trim()) return;

    setLoading(true);
    try {
      // 1. Fetch wiki & archive
      const [w, a] = await Promise.all([
        searchWikipedia(searchWord, lang, 8),
        searchInternetArchive(searchWord, 'all', 12),
      ]);
      setWikiResults(w);
      setArchiveResults(a);

      // 2. Search song catalog
      const basePool = getInstantSongPool();
      const normQ = searchWord.toLowerCase().trim();
      
      let matchedSongs = basePool.filter(
        (t) =>
          t.name.toLowerCase().includes(normQ) ||
          t.artistName.toLowerCase().includes(normQ) ||
          (t.genre && t.genre.toLowerCase().includes(normQ))
      );

      // If search yielded few results, fetch live from archive music
      if (matchedSongs.length < 10) {
        const liveAudioBatch = await fetchLiveAudioFromArchive(searchWord, 1);
        matchedSongs = [...matchedSongs, ...liveAudioBatch];
      }

      setSongResults(matchedSongs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    executeUnifiedSearch('מוזיקה ומדע');
  }, [lang]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Search Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-indigo-400" />
          <span>{isHe ? 'מנוע חיפוש משולב: ויקיפדיה + שירים + ארכיון האינטרנט' : 'Unified Explorer: Wikipedia, Songs & Archives'}</span>
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          {isHe
            ? 'הזן מילת מפתח וקבל תוצאות מורחבות בזמן אמת של ערכים, שירים מלאים וקבצי מדיה היסטוריים'
            : 'Search any term to stream articles, full audio songs, and historical archives.'}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeUnifiedSearch();
          }}
          className="relative flex items-center max-w-2xl"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHe ? 'חפש נושא, שיר או אמן (לדוגמה: Coldplay, Bach, חלל, רוק)...' : 'Search topic, song, artist...'}
            className="w-full pr-12 pl-12 py-3 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none shadow-inner"
          />
          <Search className="w-5 h-5 text-indigo-400 absolute right-4 top-1/2 -translate-y-1/2" />
          <button
            type="submit"
            className="absolute left-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition-all cursor-pointer"
          >
            {isHe ? 'חפש' : 'Search'}
          </button>
        </form>
      </div>

      {/* Grid Side-by-Side View */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
          <div className="h-96 bg-slate-900 rounded-2xl p-4" />
          <div className="h-96 bg-slate-900 rounded-2xl p-4" />
          <div className="h-96 bg-slate-900 rounded-2xl p-4" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1: Songs Catalog Stream */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                  <Music2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">{isHe ? 'שירי המאגר' : 'Songs Catalog'}</h3>
                  <p className="text-[10px] text-slate-400">Audio Player</p>
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-mono font-bold bg-emerald-500/10 text-emerald-300 rounded-full border border-emerald-500/20">
                {songResults.length} {isHe ? 'שירים' : 'Songs'}
              </span>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
              {songResults.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">{isHe ? 'לא נמצאו שירים תואמים' : 'No matching songs found'}</p>
              ) : (
                songResults.map((track) => (
                  <div
                    key={track.id}
                    className="bg-slate-950 border border-slate-800 hover:border-emerald-500/50 p-3 rounded-2xl transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {track.coverUrl ? (
                        <img
                          src={track.coverUrl}
                          alt={track.name}
                          className="w-12 h-12 rounded-xl object-cover border border-slate-800 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 flex-shrink-0">
                          <Music2 className="w-6 h-6" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-xs text-white truncate group-hover:text-emerald-300">
                          {track.name}
                        </h4>
                        <p className="text-[11px] text-emerald-400 truncate mt-0.5">
                          {track.artistName}
                        </p>
                        <span className="text-[9px] text-slate-500 font-mono">
                          {track.genre || 'Music'}
                        </span>
                      </div>
                    </div>

                    {onPlaySong && (
                      <button
                        onClick={() => onPlaySong(track)}
                        className="ml-2 p-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-xl flex-shrink-0 transition-all shadow cursor-pointer font-bold"
                        title={isHe ? 'נגן שיר' : 'Play song'}
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 2: Wikipedia Stream */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                  W
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">{isHe ? 'ערכי ויקיפדיה' : 'Wikipedia Articles'}</h3>
                  <p className="text-[10px] text-slate-400">he.wikipedia.org</p>
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-mono font-bold bg-amber-500/10 text-amber-300 rounded-full border border-amber-500/20">
                {wikiResults.length} {isHe ? 'ערכים' : 'Articles'}
              </span>
            </div>

            <div className="space-y-4 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
              {wikiResults.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">{isHe ? 'לא נמצאו ערכי ויקיפדיה' : 'No Wikipedia articles found'}</p>
              ) : (
                wikiResults.map((wiki) => (
                  <div
                    key={wiki.pageid}
                    className="bg-slate-950 border border-slate-800 hover:border-amber-500/40 p-4 rounded-2xl transition-all"
                  >
                    <div className="flex space-x-3 space-x-reverse items-start">
                      {wiki.thumbnail && (
                        <img
                          src={wiki.thumbnail}
                          alt={wiki.title}
                          className="w-16 h-16 rounded-xl object-cover border border-slate-800 flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-white hover:text-amber-300 transition-colors">
                            {wiki.title}
                          </h4>
                          <a
                            href={wiki.pageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-400 hover:text-white text-xs"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <p className="text-xs text-slate-300 mt-1.5 leading-relaxed line-clamp-3">
                          {wiki.extract || wiki.snippet}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <AudioTTSPlayer
                        text={`${wiki.title}. ${wiki.extract || wiki.snippet}`}
                        label={isHe ? 'הקרא ערך' : 'Read article'}
                      />
                      <button
                        onClick={() => onAskBotAbout(wiki.title)}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg transition-all cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>{isHe ? 'סנתז תשובה בבוט AI' : 'Synthesize in AI Bot'}</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 3: Internet Archive Stream */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                  IA
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">{isHe ? 'קבצי Internet Archive' : 'Internet Archive Records'}</h3>
                  <p className="text-[10px] text-slate-400">archive.org</p>
                </div>
              </div>
              <span className="px-2.5 py-1 text-xs font-mono font-bold bg-indigo-500/10 text-indigo-300 rounded-full border border-indigo-500/20">
                {archiveResults.length} {isHe ? 'פריטים' : 'Items'}
              </span>
            </div>

            <div className="space-y-4 overflow-y-auto max-h-[600px] pr-1 custom-scrollbar">
              {archiveResults.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">{isHe ? 'לא נמצאו פריטי ארכיון' : 'No Internet Archive records found'}</p>
              ) : (
                archiveResults.map((item) => (
                  <div
                    key={item.identifier}
                    className="bg-slate-950 border border-slate-800 hover:border-indigo-500/40 p-4 rounded-2xl transition-all flex items-center justify-between"
                  >
                    <div className="flex space-x-3 space-x-reverse items-center min-w-0 flex-1">
                      {item.thumbnail && (
                        <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex-shrink-0">
                          <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-xs text-white truncate hover:text-indigo-300">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                          {item.year ? `שנת ${item.year}` : item.creator || 'Archive item'}
                        </p>
                        <span className="inline-block px-1.5 py-0.2 text-[9px] font-mono bg-indigo-500/20 text-indigo-300 rounded mt-1">
                          {item.mediaType}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => onPlayMedia(item)}
                      className="ml-3 p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex-shrink-0 transition-all shadow cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
