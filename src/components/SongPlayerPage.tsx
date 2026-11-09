import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Heart,
  Download,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  Music2,
  FileText,
  ShieldCheck,
  Share2,
  User,
  Calendar,
  ShieldAlert,
  Sparkles,
  Flame,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile } from '../types';
import { TrackCoverArt, isAuthenticCover } from './TrackCoverArt';
import { ArtistProfileModal } from './ArtistProfileModal';
import { ArtistPortalModal } from './ArtistPortalModal';
import { ReportSongModal } from './ReportSongModal';
import { onAuthUserChanged, saveArtistTrackToFirebase, incrementTrackPlaysInFirebase } from '../services/firebaseService';
import { User as FirebaseUser } from 'firebase/auth';
import { getTrackInstantColor, prewarmTrackColor, useExtractedColor, getFormattedPlayCount } from '../services/colorService';
import { getStreamingMediaUrl, updateTrackColorInGitHubRepo } from '../services/githubStorageService';

const isHebrewText = (text: string) => /[\u0590-\u05FF]/.test(text);

export const ScrollingSongTitle: React.FC<{ title: string }> = ({ title }) => {
  const isHe = isHebrewText(title);
  const isLong = title.length > 20;

  if (!isLong) {
    return (
      <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight drop-shadow truncate text-center">
        {title}
      </h1>
    );
  }

  return (
    <div className="w-full overflow-hidden whitespace-nowrap relative py-1 flex justify-center">
      <div
        dir={isHe ? 'rtl' : 'ltr'}
        className={`inline-flex items-center ${isHe ? 'animate-marquee-rtl' : 'animate-marquee-ltr'}`}
      >
        <span className="text-lg sm:text-2xl font-black text-white tracking-tight drop-shadow px-3">
          {title}
        </span>
        <span className="text-white/60 opacity-70 px-2 font-bold">•</span>
        <span className="text-lg sm:text-2xl font-black text-white tracking-tight drop-shadow px-3">
          {title}
        </span>
        <span className="text-white/60 opacity-70 px-2 font-bold">•</span>
      </div>
    </div>
  );
};

interface SongPlayerPageProps {
  track: JamendoTrack;
  onBack: () => void;
  onFilterByArtist: (artistName: string) => void;
  isLiked: boolean;
  onToggleLike: (id: string) => void;
  lang: Language;
  allTracks?: JamendoTrack[];
  onPlayTrack?: (track: JamendoTrack) => void;
  onRemoveTrack?: (trackId: string) => void;
}

export const SongPlayerPage: React.FC<SongPlayerPageProps> = ({
  track,
  onBack,
  onFilterByArtist,
  isLiked,
  onToggleLike,
  lang,
  allTracks = [],
  onPlayTrack,
  onRemoveTrack,
}) => {
  const isHe = lang === 'he';

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track.duration || 180);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isArtistProfileOpen, setIsArtistProfileOpen] = useState(false);
  const [isArtistPortalOpen, setIsArtistPortalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [activeArtistProfile, setActiveArtistProfile] = useState<ArtistProfile | null>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_artist_account');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const unsub = onAuthUserChanged((user) => {
      setAuthUser(user);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (track.id) {
      incrementTrackPlaysInFirebase(track.id).catch(() => {});
    }
  }, [track.id]);

  const effectiveAudioUrl = getStreamingMediaUrl(track.audioUrl);
  const effectiveCoverUrl = getStreamingMediaUrl(track.coverUrl);

  // Dynamic matching color extracted from track cover or genre
  const extractedColor = useExtractedColor(effectiveCoverUrl, track.genre || 'Pop');

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.load();
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('Playback notice:', err);
            setIsPlaying(false);
          });
      }
    }
  }, [effectiveAudioUrl]);

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

  const handleExitPlayer = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    onBack();
  };

  const handleOpenArtistProfile = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
    setIsArtistProfileOpen(true);
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const seekRelative = (seconds: number) => {
    if (audioRef.current) {
      const targetTime = Math.max(
        0,
        Math.min(audioRef.current.duration || duration, audioRef.current.currentTime + seconds)
      );
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const handleSeekEvent = (clientX: number) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const width = rect.width;
    if (width <= 0) return;
    const clickX = Math.max(0, Math.min(width, clientX - rect.left));
    const ratio = clickX / width;
    const newTime = ratio * (duration || 1);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleCopyTrackLink = async () => {
    try {
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set('song', track.id);
      const urlString = shareUrl.toString();

      if (navigator.share) {
        try {
          await navigator.share({
            title: `${track.name} - ${track.artistName}`,
            text: `האזן לשיר "${track.name}" מאת ${track.artistName} ב-Kolot Music`,
            url: urlString,
          });
          return;
        } catch {}
      }

      await navigator.clipboard.writeText(urlString);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const activeBgColor = `linear-gradient(180deg, rgb(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b}) 0%, rgb(${Math.round(
    extractedColor.r * 0.75
  )}, ${Math.round(extractedColor.g * 0.75)}, ${Math.round(
    extractedColor.b * 0.75
  )}) 35%, rgb(${Math.round(
    extractedColor.r * 0.45
  )}, ${Math.round(extractedColor.g * 0.45)}, ${Math.round(
    extractedColor.b * 0.45
  )}) 70%, rgb(${Math.round(
    extractedColor.r * 0.3
  )}, ${Math.round(extractedColor.g * 0.3)}, ${Math.round(
    extractedColor.b * 0.3
  )}) 100%)`;

  const dynamicBgStyle: React.CSSProperties = {
    background: activeBgColor,
  };

  useEffect(() => {
    if (track.id) {
      track.bgColor = activeBgColor;
      updateTrackColorInGitHubRepo(track.id, activeBgColor, track).catch(() => {});
      saveArtistTrackToFirebase(track).catch(() => {});
    }
  }, [track.id, activeBgColor]);

  const requestRef = useRef<number | null>(null);

  const updateProgress = () => {
    if (audioRef.current && isPlaying && !isScrubbing) {
      setCurrentTime(audioRef.current.currentTime);
      requestRef.current = requestAnimationFrame(updateProgress);
    }
  };

  useEffect(() => {
    if (isPlaying && !isScrubbing) {
      requestRef.current = requestAnimationFrame(updateProgress);
    } else if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, isScrubbing]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] w-screen h-screen overflow-y-auto text-white flex flex-col custom-scrollbar transition-colors duration-700 m-0 p-0 border-0"
      style={dynamicBgStyle}
    >
      {/* Immersive Dynamic Artwork Background - FIXED so it continues seamlessly when scrolling down */}
      {track.coverUrl ? (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <img
            src={effectiveCoverUrl}
            alt=""
            className="w-full h-full object-cover blur-3xl scale-150 saturate-200 contrast-125 transition-all duration-700 opacity-75"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at 50% 30%, rgba(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b}, 0.25) 0%, rgba(${Math.round(extractedColor.r * 0.6)}, ${Math.round(extractedColor.g * 0.6)}, ${Math.round(extractedColor.b * 0.6)}, 0.55) 55%, rgba(${Math.round(extractedColor.r * 0.35)}, ${Math.round(extractedColor.g * 0.35)}, ${Math.round(extractedColor.b * 0.35)}, 0.8) 100%)`,
            }}
          />
          {/* Seamless bottom continuation gradient matching the cover artwork colors */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/2"
            style={{
              background: `linear-gradient(to bottom, transparent 0%, rgba(${Math.round(extractedColor.r * 0.35)}, ${Math.round(extractedColor.g * 0.35)}, ${Math.round(extractedColor.b * 0.35)}, 0.5) 50%, rgba(${Math.round(extractedColor.r * 0.25)}, ${Math.round(extractedColor.g * 0.25)}, ${Math.round(extractedColor.b * 0.25)}, 0.95) 100%)`,
            }}
          />
        </div>
      ) : (
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            background: `radial-gradient(circle at 50% 25%, rgb(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b}) 0%, rgb(${Math.round(extractedColor.r * 0.6)}, ${Math.round(extractedColor.g * 0.6)}, ${Math.round(extractedColor.b * 0.6)}) 50%, rgb(${Math.round(extractedColor.r * 0.35)}, ${Math.round(extractedColor.g * 0.35)}, ${Math.round(extractedColor.b * 0.35)}) 100%)`,
          }}
        />
      )}

      <audio
        ref={audioRef}
        src={effectiveAudioUrl}
        preload="auto"
        onLoadedMetadata={() => {
          if (audioRef.current?.duration) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
        }}
      />

      {/* FLOATING TOP BAR - BACK BUTTON IN CLEAN WHITE */}
      <div className="fixed top-3.5 sm:top-5 left-0 right-0 z-50 px-4 sm:px-8 flex items-center justify-start pointer-events-none" dir={isHe ? 'rtl' : 'ltr'}>
        <button
          onClick={handleExitPlayer}
          className="pointer-events-auto w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white border border-white/25 bg-white/10 hover:bg-white/20 backdrop-blur-2xl shadow-xl transition-all cursor-pointer active:scale-95"
          title={isHe ? 'חזור לרשימת השירים' : 'Back to Songs'}
        >
          {isHe ? <ArrowRight className="w-5 h-5 text-white drop-shadow" /> : <ArrowLeft className="w-5 h-5 text-white drop-shadow" />}
        </button>
      </div>

      {/* SCREEN 1: PLAYER MAIN CONTROLS */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-between px-4 pt-16 pb-8 max-w-md mx-auto w-full">
        <div className="h-2 flex-shrink-0" />

        {/* 1. COVER ARTWORK IMAGE */}
        <div
          className="w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 max-h-[32vh] max-w-[32vh] aspect-square rounded-2xl sm:rounded-3xl p-2 bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl flex items-center justify-center relative overflow-hidden group flex-shrink-0"
          style={
            extractedColor
              ? {
                  boxShadow: `0 20px 50px -10px rgba(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b}, 0.55)`,
                }
              : undefined
          }
        >
          <div className="w-full h-full rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl">
            <TrackCoverArt
              coverUrl={track.coverUrl}
              artistName={track.artistName}
              trackName={track.name}
              genre={track.genre}
              showHoverPlay={false}
              priority={true}
            />
          </div>
        </div>

        {/* 2. PROGRESS BAR */}
        <div className="w-full space-y-1.5 px-2">
          <div
            ref={progressBarRef}
            dir="ltr"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setIsScrubbing(true);
              handleSeekEvent(e.clientX);
            }}
            onPointerMove={(e) => {
              if (isScrubbing) {
                handleSeekEvent(e.clientX);
              }
            }}
            onPointerUp={() => setIsScrubbing(false)}
            onPointerCancel={() => setIsScrubbing(false)}
            className="w-full py-2.5 cursor-pointer group select-none touch-none"
          >
            <div className="w-full h-2 group-hover:h-2.5 rounded-full bg-white/20 relative shadow-inner overflow-visible">
              <div
                className="h-full bg-white rounded-full relative"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9),0_2px_4px_rgba(0,0,0,0.5)] absolute top-1/2 -translate-y-1/2 left-full -translate-x-1/2 group-hover:scale-125 transition-transform duration-100 ring-2 ring-black/10" />
              </div>
            </div>
          </div>

          <div className="flex justify-between text-xs font-mono font-bold text-white/90 px-1 select-none">
            <span>
              {Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60)).toString().padStart(2, '0')}
            </span>
            <span>
              {Math.floor(duration / 60)}:{(Math.floor(duration % 60)).toString().padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* 3. PLAY BUTTON & CONTROLS ROW */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 pt-1">
          <button
            onClick={() => onToggleLike(track.id)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-white/20 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white transition-colors shadow-lg cursor-pointer active:scale-95"
            title={isLiked ? (isHe ? 'הסר ממועדפים' : 'Unlike') : (isHe ? 'הוסף למועדפים' : 'Like')}
          >
            <Heart
              className={`w-5 h-5 sm:w-5.5 sm:h-5.5 transition-colors ${
                isLiked ? 'fill-white text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]' : 'text-white/80 fill-transparent'
              }`}
            />
          </button>

          <button
            onClick={() => seekRelative(-10)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/20 flex flex-col items-center justify-center transition-colors shadow-lg cursor-pointer"
            title="-10s"
          >
            <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-[8px] sm:text-[9px] font-mono font-bold mt-0.5">-10s</span>
          </button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={togglePlayPause}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white hover:bg-slate-100 text-slate-950 flex items-center justify-center shadow-2xl transition-all cursor-pointer ring-4 ring-white/20 active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
            ) : (
              <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current translate-x-0.5" />
            )}
          </motion.button>

          <button
            onClick={() => seekRelative(10)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/20 flex flex-col items-center justify-center transition-colors shadow-lg cursor-pointer"
            title="+10s"
          >
            <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-[8px] sm:text-[9px] font-mono font-bold mt-0.5">+10s</span>
          </button>

          <button
            onClick={handleOpenArtistProfile}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/20 flex items-center justify-center p-1.5 transition-colors shadow-lg cursor-pointer"
            title={isHe ? `עמוד אמן - ${track.artistName}` : `Artist - ${track.artistName}`}
          >
            {track.artistAvatarUrl && isAuthenticCover(track.artistAvatarUrl) ? (
              <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center shadow-sm">
                <img
                  src={track.artistAvatarUrl}
                  alt={track.artistName}
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
            ) : authUser && (track.uploadedByUid === authUser.uid || track.artistName === authUser.displayName) && authUser.photoURL ? (
              <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center shadow-sm">
                <img
                  src={authUser.photoURL}
                  alt={track.artistName}
                  className="w-full h-full rounded-full object-cover"
                />
              </div>
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black text-xs flex items-center justify-center shadow-inner">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
          </button>
        </div>

        {/* 4. SONG NAME & ARTIST NAME */}
        <div className="text-center space-y-1.5 px-2 w-full pb-2 overflow-hidden flex flex-col items-center">
          <div className="w-full flex justify-center">
            <ScrollingSongTitle title={track.name} />
          </div>

          <div>
            <button
              onClick={handleOpenArtistProfile}
              className="text-xs sm:text-sm font-bold text-white hover:text-white/80 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{track.artistName}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* SCREEN 2: DETAILS & REPORT BUTTON */}
      <div className="relative z-10 max-w-xl mx-auto w-full px-4 pt-4 pb-20 space-y-6">
        <div className="p-6 rounded-3xl bg-white/10 backdrop-blur-2xl border border-white/15 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Music2 className="w-4 h-4 text-white" />
              <span>{isHe ? 'פרטי היצירה והזמר' : 'Track & Artist Details'}</span>
            </h3>

            <div className="flex items-center gap-2">
              {/* AI BADGE POSITIONED RIGHT NEXT TO REPORT BUTTON */}
              {track.isAiGenerated && (
                <span
                  className="px-2.5 py-1 rounded-full bg-purple-500/25 text-purple-200 border border-purple-400/50 font-bold text-xs tracking-wider uppercase inline-flex items-center gap-1 shadow-md shrink-0 select-none"
                  title={isHe ? 'שיר שנוצר בבינה מלאכותית' : 'AI Generated Song'}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                  <span>AI</span>
                </span>
              )}

              {/* REPORT BUTTON (🚩) */}
              <button
                onClick={() => setIsReportModalOpen(true)}
                className="px-3 py-1.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                title={isHe ? 'דווח על שיר זה' : 'Report Song'}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>{isHe ? 'דווח' : 'Report'}</span>
              </button>

              <button
                onClick={handleCopyTrackLink}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 border border-white/20 transition-all cursor-pointer"
                title={isHe ? 'שתף קישור לשיר' : 'Share Song Link'}
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'שם השיר:' : 'Track Title:'}</span>
              <span className="font-bold text-white text-sm truncate block">{track.name}</span>
            </div>
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'זמר / אמן מבצע:' : 'Artist / Singer:'}</span>
              <button
                type="button"
                onClick={handleOpenArtistProfile}
                className="font-bold text-emerald-400 hover:text-emerald-300 text-sm truncate block text-start cursor-pointer underline decoration-dotted"
              >
                {track.artistName}
              </button>
            </div>
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'אלבום / אוסף:' : 'Album:'}</span>
              <span className="font-bold text-white/90 truncate block">{track.albumName || (isHe ? 'סינגל' : 'Single')}</span>
            </div>
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'סגנון מוזיקלי:' : 'Genre:'}</span>
              <span className="font-bold text-white/90">{track.genre || (isHe ? 'ללא סגנון' : 'General')}</span>
            </div>
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'שנת הוצאה:' : 'Release Year:'}</span>
              <span className="font-bold text-white/90">{track.publishedDate || new Date().getFullYear().toString()}</span>
            </div>
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'סטטוס זכויות:' : 'Rights Status:'}</span>
              <span className="font-bold text-emerald-400 truncate block">{track.legalStatus || (isHe ? 'מאושר להאזנה' : 'Licensed')}</span>
            </div>
          </div>
        </div>

        {/* LYRICS / מילות השיר */}
        <div className="p-6 rounded-3xl bg-white/10 backdrop-blur-2xl border border-white/15 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>{isHe ? 'מילות השיר' : 'Lyrics'}</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
              {track.lyrics && track.lyrics !== 'מילות השיר נוצרות ומסונכרנות אוטומטית על גבי המכשיר'
                ? (isHe ? 'מילים מקוריות' : 'Original Lyrics')
                : (isHe ? 'מופעל אוטומטי' : 'Auto Enabled')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-white/90 leading-relaxed whitespace-pre-line font-normal">
            {track.lyrics && track.lyrics !== 'מילות השיר נוצרות ומסונכרנות אוטומטית על גבי המכשיר'
              ? track.lyrics
              : (isHe
                  ? '✨ מילות השיר מופעלות ומסונכרנות באופן אוטומטי על גבי המכשיר שלך בעת השמעת השיר.'
                  : '✨ Lyrics are automatically generated and synchronized on your device during playback.')}
          </p>
        </div>
      </div>

      {/* SHARE FEEDBACK TOAST */}
      {copiedLink && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-2.5 rounded-full bg-emerald-500 text-slate-950 font-black text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Share2 className="w-4 h-4 text-slate-950" />
          <span>{isHe ? 'הקישור לשיר הועתק בהצלחה! ✓' : 'Song link copied! ✓'}</span>
        </div>
      )}

      {/* REPORT MODAL */}
      <ReportSongModal
        track={track}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        lang={lang}
      />

      {/* ARTIST PROFILE MODAL */}
      <AnimatePresence>
        {isArtistProfileOpen && (
          <ArtistProfileModal
            artistName={track.artistName}
            isOpen={isArtistProfileOpen}
            onClose={() => setIsArtistProfileOpen(false)}
            allTracks={Array.isArray(allTracks) ? allTracks : []}
            currentTrack={track}
            onPlayTrack={(newTrack: JamendoTrack) => {
              setIsArtistProfileOpen(false);
              if (onPlayTrack) {
                onPlayTrack(newTrack);
              }
            }}
            lang={lang}
            onToggleLike={onToggleLike}
            likedSongIds={isLiked ? [track.id] : []}
            onRemoveTrack={onRemoveTrack}
          />
        )}
      </AnimatePresence>

      {/* ARTIST PORTAL MODAL */}
      <ArtistPortalModal
        isOpen={isArtistPortalOpen}
        onClose={() => {
          setIsArtistPortalOpen(false);
          try {
            const saved = localStorage.getItem('wikiarchive_artist_account');
            setActiveArtistProfile(saved ? JSON.parse(saved) : null);
          } catch {
            // ignore
          }
        }}
        lang={lang}
        onTrackPublished={(newTrack) => {
          if (onPlayTrack) {
            onPlayTrack(newTrack);
          }
        }}
        allTracks={allTracks}
        onRemoveTrack={onRemoveTrack}
      />
    </motion.div>
  );
};
