import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, SkipForward, SkipBack, X, Music, ExternalLink, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, ArchiveItem, Language } from '../types';
import { getStreamingMediaUrl } from '../services/cloudStorageService';
import { activateIosPlaybackSession } from '../services/iosAudioHelper';

interface AudioPlayerBarProps {
  currentTrack: JamendoTrack | ArchiveItem | null;
  onClose: () => void;
  lang: Language;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({ currentTrack, onClose, lang }) => {
  if (!currentTrack) return null;
  const isHe = lang === 'he';

  const audioRef = useRef<HTMLAudioElement>(null);
  const pausedResumeTimeRef = useRef<number | null>(null);
  const pendingRestoreTimeRef = useRef<number | null>(null);
  const isSwitchingTrackRef = useRef<boolean>(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAppHidden, setIsAppHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );

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

  const clearMediaSessionUiOnly = () => {
    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('stop', null);
        if (typeof navigator.mediaSession.setPositionState === 'function') {
          try {
            navigator.mediaSession.setPositionState();
          } catch {}
        }
      }
    } catch {}
  };

  const clearMediaSessionCompletely = (audioEl?: HTMLAudioElement | null, unloadAudio = false) => {
    try {
      if (audioEl) {
        audioEl.pause();
        if (unloadAudio) {
          audioEl.currentTime = 0;
          audioEl.removeAttribute('src');
          audioEl.load();
        }
      }
      clearMediaSessionUiOnly();
    } catch {}
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      const audio = audioRef.current;

      if (!hidden) {
        clearMediaSessionUiOnly();
        setIsAppHidden(false);
        if (audio && audioSrc && !audio.getAttribute('src')) {
          const resumeAt = pausedResumeTimeRef.current ?? 0;
          pausedResumeTimeRef.current = null;
          pendingRestoreTimeRef.current = resumeAt;
          audio.src = audioSrc;
          audio.load();
          setCurrentTime(resumeAt);
        }
        return;
      }

      const actuallyPlaying = Boolean(
        audio &&
          !audio.paused &&
          !audio.ended &&
          !audio.muted &&
          audio.volume > 0 &&
          Boolean(audio.getAttribute('src'))
      );
      if (!actuallyPlaying) {
        if (audio) {
          pausedResumeTimeRef.current = audio.ended ? 0 : audio.currentTime || 0;
          clearMediaSessionCompletely(audio, true);
        } else {
          clearMediaSessionUiOnly();
        }
        setIsPlaying(false);
      }
      setIsAppHidden(true);
    };

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        clearMediaSessionUiOnly();
        setIsAppHidden(false);
      }
    };

    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [audioSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    isSwitchingTrackRef.current = true;
    pausedResumeTimeRef.current = null;
    pendingRestoreTimeRef.current = null;
    if (audio.getAttribute('src') !== audioSrc) {
      audio.src = audioSrc;
    }
    audio.load();
    const timer = window.setTimeout(() => {
      isSwitchingTrackRef.current = false;
    }, 350);
    audio
      .play()
      .then(() => {
        isSwitchingTrackRef.current = false;
        setIsPlaying(true);
      })
      .catch(() => {
        isSwitchingTrackRef.current = false;
        setIsPlaying(false);
      });
    return () => window.clearTimeout(timer);
  }, [audioSrc]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    const audio = audioRef.current;
    const shouldExposeNotification =
      isAppHidden &&
      isPlaying &&
      Boolean(audio && !audio.paused && !audio.ended && !audio.muted && audio.volume > 0 && audio.getAttribute('src'));

    if (!shouldExposeNotification) {
      clearMediaSessionUiOnly();
      return;
    }

    try {
      const artwork: MediaImage[] = [];
      if (coverUrl) {
        try {
          const absUrl = new URL(coverUrl, window.location.origin).toString();
          artwork.push({ src: absUrl, sizes: '512x512', type: 'image/png' });
        } catch {}
      }
      if (artwork.length === 0) {
        artwork.push({ src: `${window.location.origin}/pwa-512x512.png`, sizes: '512x512', type: 'image/png' });
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Kolot Music',
        artist: subtitle || 'Kolot Music',
        album: 'Kolot Music',
        artwork,
      });
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler('play', () => {
        if (!audioRef.current?.getAttribute('src') && audioSrc) {
          pendingRestoreTimeRef.current = pausedResumeTimeRef.current;
          pausedResumeTimeRef.current = null;
          audioRef.current!.src = audioSrc;
          audioRef.current!.load();
        }
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (audioRef.current) {
          pausedResumeTimeRef.current = audioRef.current.currentTime || 0;
          clearMediaSessionCompletely(audioRef.current, true);
        } else {
          clearMediaSessionUiOnly();
        }
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        pausedResumeTimeRef.current = 0;
        clearMediaSessionCompletely(audioRef.current, true);
        setIsPlaying(false);
      });
    } catch {}
  }, [title, subtitle, coverUrl, audioSrc, isPlaying, isAppHidden]);

  useEffect(() => {
    const handlePageHide = () => {
      clearMediaSessionCompletely(audioRef.current, true);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      clearMediaSessionCompletely(audioRef.current, true);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    activateIosPlaybackSession();
    if (isPlaying && !audio.paused && !audio.ended) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if ((!audio.getAttribute('src') || audio.error || audio.networkState === 3) && audioSrc) {
        pendingRestoreTimeRef.current = pausedResumeTimeRef.current;
        pausedResumeTimeRef.current = null;
        audio.src = audioSrc;
        audio.load();
      }
      audio.muted = false;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
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
          playsInline
          preload="auto"
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => {
            const audio = audioRef.current;
            if (!audio) return;
            const dur = audio.duration || 0;
            setDuration(dur);
            if (pendingRestoreTimeRef.current !== null) {
              const restoreAt = Math.max(0, Math.min(dur || pendingRestoreTimeRef.current, pendingRestoreTimeRef.current));
              pendingRestoreTimeRef.current = null;
              try {
                audio.currentTime = restoreAt;
              } catch {}
              setCurrentTime(restoreAt);
            }
          }}
          onPlaying={() => {
            isSwitchingTrackRef.current = false;
            pausedResumeTimeRef.current = null;
            setIsPlaying(true);
          }}
          onPause={() => {
            if (isSwitchingTrackRef.current) return;
            setIsPlaying(false);
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
              const audio = audioRef.current;
              pausedResumeTimeRef.current = audio ? (audio.ended ? 0 : audio.currentTime || 0) : 0;
              clearMediaSessionCompletely(audio, true);
            } else {
              clearMediaSessionUiOnly();
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
              pausedResumeTimeRef.current = 0;
              clearMediaSessionCompletely(audioRef.current, true);
            } else {
              clearMediaSessionUiOnly();
            }
          }}
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
