import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipForward, SkipBack, X, Music, ExternalLink, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, ArchiveItem, Language } from '../types';
import { getStreamingMediaUrl } from '../services/cloudStorageService';

interface AudioPlayerBarProps {
  currentTrack: JamendoTrack | ArchiveItem | null;
  onClose: () => void;
  lang: Language;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({ currentTrack, onClose, lang }) => {
  if (!currentTrack) return null;
  const isHe = lang === 'he';

  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const title = 'name' in currentTrack ? currentTrack.name : currentTrack.title;
  const subtitle = 'artistName' in currentTrack ? currentTrack.artistName : currentTrack.creator || 'Internet Archive';
  const rawCoverUrl =
    'coverUrl' in currentTrack
      ? currentTrack.coverUrl
      : currentTrack.thumbnail || '';
  const coverUrl = getStreamingMediaUrl(rawCoverUrl);

  const rawAudioSrc =
    'audioUrl' in currentTrack
      ? currentTrack.audioUrl
      : currentTrack.directMediaUrl || `https://archive.org/download/${currentTrack.identifier}/${currentTrack.identifier}.mp3`;
  const audioSrc = getStreamingMediaUrl(rawAudioSrc);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }, [currentTrack]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[460px] z-50 bg-[#141722]/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-3 shadow-2xl shadow-black/80 flex flex-col gap-2"
      >
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Track Info & Main Actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-slate-900 border border-white/10 flex-shrink-0 shadow-md">
              <img src={coverUrl} alt={title} className="w-full h-full object-cover" />
              {isPlaying && (
                <div className="absolute inset-0 bg-indigo-600/30 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold text-white truncate leading-tight">{title}</h4>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Play/Pause Button */}
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md hover:bg-indigo-500 transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-0.5" />}
            </motion.button>

            {/* Mute Button */}
            <button
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.muted = !isMuted;
                  setIsMuted(!isMuted);
                }
              }}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Close */}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress Scrub Slider */}
        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
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
            className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span>{formatTime(duration)}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
