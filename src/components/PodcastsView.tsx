import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Play,
  Pause,
  Search,
  Download,
  RotateCcw,
  RotateCw,
  Sparkles,
  ExternalLink,
  X,
  Volume2,
  Clock,
  Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PodcastEpisode,
  PODCAST_CATEGORIES,
  CURATED_PODCASTS,
  fetchPodcastsFromArchive,
} from '../services/podcastService';
import { Language } from '../types';

interface PodcastsViewProps {
  lang: Language;
}

export const PodcastsView: React.FC<PodcastsViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [episodes, setEpisodes] = useState<PodcastEpisode[]>(CURATED_PODCASTS);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Active playing episode state
  const [activeEpisode, setActiveEpisode] = useState<PodcastEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    loadEpisodes(searchQuery, selectedCategory);
  }, [selectedCategory]);

  const loadEpisodes = async (query: string, category: string) => {
    setLoading(true);
    const data = await fetchPodcastsFromArchive(query, category);
    setEpisodes(data);
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    const data = await fetchPodcastsFromArchive(searchQuery, selectedCategory);
    setEpisodes(data);
    setLoading(false);
  };

  const playEpisode = (ep: PodcastEpisode) => {
    setActiveEpisode(ep);
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = ep.audioUrl;
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekRelative = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(audioRef.current.duration || 100, audioRef.current.currentTime + seconds)
      );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 pb-32">
      <audio
        ref={audioRef}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-violet-100 text-violet-600">
              <Mic className="w-6 h-6" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {isHe ? 'מאגר הפודקאסטים הפתוח' : 'Open Podcast Directory'}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            {isHe
              ? 'אלפי פרקי פודקאסט חופשיים להאזנה בכל נושא בחסות ארכיון האינטרנט Internet Archive'
              : 'Listen to thousands of free open podcast episodes across history, tech, and storytelling'}
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isHe ? 'חפש פודקאסט (למשל: היסטוריה, מדע, פילוסופיה)...' : 'Search podcast topics...'}
              className="w-full pl-4 pr-10 py-2.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-full bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
          >
            {isHe ? 'חיפוש' : 'Search'}
          </button>
        </form>
      </div>

      {/* Categories */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        {PODCAST_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              setSelectedCategory(cat.id);
              setSearchQuery('');
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
              selectedCategory === cat.id && !searchQuery
                ? 'bg-violet-600 text-white shadow-md'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {isHe ? cat.labelHe : cat.labelEn}
          </button>
        ))}
      </div>

      {/* Episodes Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-3xl border border-slate-200 p-5 animate-pulse space-y-4">
              <div className="flex gap-4">
                <div className="w-20 h-20 bg-slate-200 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4" />
                  <div className="h-3 bg-slate-200 rounded w-1/2" />
                </div>
              </div>
              <div className="h-10 bg-slate-100 rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {episodes.map((ep) => {
            const isThisPlaying = activeEpisode?.id === ep.id && isPlaying;
            return (
              <motion.div
                whileHover={{ y: -3 }}
                key={ep.id}
                className={`bg-white rounded-3xl border p-5 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between ${
                  activeEpisode?.id === ep.id ? 'border-violet-500 ring-2 ring-violet-500/20' : 'border-slate-200/90'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex gap-4 items-start">
                    <img
                      src={ep.coverUrl}
                      alt={ep.podcastTitle}
                      className="w-20 h-20 rounded-2xl object-cover bg-slate-100 flex-shrink-0 shadow"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
                        {ep.podcastTitle}
                      </span>
                      <h3 className="font-extrabold text-sm text-slate-900 mt-1 line-clamp-2">
                        {ep.title}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">{ep.creator}</p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                    {ep.description}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => playEpisode(ep)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                      isThisPlaying
                        ? 'bg-violet-600 text-white shadow-md'
                        : 'bg-violet-50 hover:bg-violet-600 hover:text-white text-violet-700'
                    }`}
                  >
                    {isThisPlaying ? (
                      <>
                        <Pause className="w-4 h-4 fill-current" />
                        <span>{isHe ? 'מופעל' : 'Playing'}</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        <span>{isHe ? 'האזן עכשיו' : 'Listen Now'}</span>
                      </>
                    )}
                  </button>

                  <a
                    href={ep.audioUrl}
                    download
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-all"
                    title={isHe ? 'הורד פרק MP3' : 'Download MP3'}
                  >
                    <Download className="w-4 h-4" />
                  </a>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Floating Bottom Audio Player Bar */}
      <AnimatePresence>
        {activeEpisode && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-4 left-4 right-4 max-w-4xl mx-auto z-50 bg-slate-950/90 backdrop-blur-2xl text-white rounded-3xl p-4 shadow-2xl border border-white/20 flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
              <img
                src={activeEpisode.coverUrl}
                alt=""
                className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
              />
              <div className="min-w-0">
                <h4 className="font-bold text-xs sm:text-sm truncate">{activeEpisode.title}</h4>
                <p className="text-[11px] text-white/60 truncate">{activeEpisode.podcastTitle}</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col items-center gap-1.5 w-full sm:w-auto flex-1 max-w-sm">
              <div className="flex items-center gap-5">
                <button
                  onClick={() => seekRelative(-15)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/80"
                  title="-15s"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={togglePlayPause}
                  className="w-10 h-10 rounded-full bg-white text-slate-900 flex items-center justify-center hover:bg-slate-100 transition shadow"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current translate-x-0.5" />}
                </button>

                <button
                  onClick={() => seekRelative(15)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/80"
                  title="+15s"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="w-full flex items-center gap-2 text-[10px] font-mono text-white/60">
                <span>{Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setCurrentTime(val);
                    if (audioRef.current) audioRef.current.currentTime = val;
                  }}
                  className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer accent-violet-400"
                />
                <span>{Math.floor(duration / 60)}:{(Math.floor(duration % 60)).toString().padStart(2, '0')}</span>
              </div>
            </div>

            {/* Close */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => {
                  if (audioRef.current) audioRef.current.pause();
                  setActiveEpisode(null);
                  setIsPlaying(false);
                }}
                className="p-2 rounded-full hover:bg-white/10 text-white/70"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
