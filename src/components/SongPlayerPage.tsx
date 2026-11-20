import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Heart,
  Download,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  Music2,
  Share2,
  User,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Captions,
  Check,
  Copy,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, SubtitleSegment } from '../types';
import { TrackCoverArt, isAuthenticCover } from './TrackCoverArt';
import { ArtistProfileModal } from './ArtistProfileModal';
import { ArtistPortalModal } from './ArtistPortalModal';
import { ReportSongModal } from './ReportSongModal';
import {
  AuthUser,
  onAuthUserChanged,
  loginWithGoogle,
  getEffectiveArtistAvatarForTrack,
  getGoogleAccountPhotoUrl,
} from '../services/authService';
import { useExtractedColor } from '../services/colorService';
import { getStreamingMediaUrl, updateTrackColorInCloud, incrementTrackPlaysInCloud, fetchSingleTrackFromCloud } from '../services/cloudStorageService';
import { trackEvent } from '../services/analyticsService';
import { getCachedArtistProfiles, fetchAllArtistProfiles, upsertMemoryArtistProfile, removeMemoryArtistProfile, updateMemoryTracksArtistAvatar, syncTrackSubtitlesInMemory } from '../services/multiMusicService';
import { ensureTrackSubtitlesInBackground, subscribeTrackSubtitles } from '../services/backgroundSubtitleManager';
import { generateSynchronizedLyrics } from '../aiLyricsGenerator';

const isHebrewText = (text: string) => /[\u0590-\u05FF]/.test(text);

const isRtlSubtitleText = (text: string, subLang: 'he' | 'en' | 'orig'): boolean => {
  const rtlCount = (text.match(/[\u0590-\u05FF\u0600-\u06FF]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  if (subLang === 'en') {
    return rtlCount > 0 && latinCount === 0;
  }
  if (rtlCount === 0 && latinCount > 0) return false;
  if (subLang === 'he') {
    return rtlCount >= latinCount;
  }
  return rtlCount > latinCount;
};

const formatClockTime = (seconds: number): string => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, '0')}`;
};

const SkipBack10Icon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 3v5h5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <text
      x="12"
      y="14.7"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
      fontSize="7.8"
      fontWeight="400"
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      10
    </text>
  </svg>
);

const SkipForward10Icon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M21 3v5h-5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <text
      x="12"
      y="14.7"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
      fontSize="7.8"
      fontWeight="400"
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      10
    </text>
  </svg>
);

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
  onRequireAuth?: () => void;
  lang: Language;
  allTracks?: JamendoTrack[];
  allArtists?: ArtistProfile[];
  onPlayTrack?: (track: JamendoTrack) => void;
  onRemoveTrack?: (trackId: string) => void;
}

export const SongPlayerPage: React.FC<SongPlayerPageProps> = ({
  track,
  onBack,
  onFilterByArtist,
  isLiked,
  onToggleLike,
  onRequireAuth,
  lang,
  allTracks = [],
  allArtists = [],
  onPlayTrack,
  onRemoveTrack,
}) => {
  const isHe = lang === 'he';

  const playerScrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const elapsedTimeRef = useRef<HTMLSpanElement>(null);
  const lastReactTimeSyncRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track.duration || 180);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<{ url: string; copied: boolean } | null>(null);
  const [favoriteAuthNotice, setFavoriteAuthNotice] = useState(false);
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const [isArtistProfileOpen, setIsArtistProfileOpen] = useState(false);
  const [isArtistPortalOpen, setIsArtistPortalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loadedArtists, setLoadedArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());
  const effectiveArtists = allArtists.length > 0 ? allArtists : loadedArtists;

  useEffect(() => {
    if (allArtists.length === 0 && loadedArtists.length === 0) {
      fetchAllArtistProfiles()
        .then((profiles) => {
          if (profiles?.length) setLoadedArtists(profiles);
        })
        .catch(() => {});
    }
  }, [allArtists.length]);

  const [subtitleLang, setSubtitleLang] = useState<'he' | 'en' | 'orig'>(() =>
    track.subtitleSegmentsHe?.length
      ? 'he'
      : track.subtitleSegmentsEn?.length && !track.subtitleSegmentsHe?.length
        ? 'en'
        : isHe
          ? 'he'
          : 'en'
  );
  const [whisperSegmentsHe, setWhisperSegmentsHe] = useState<SubtitleSegment[] | undefined>(
    track.subtitleSegmentsHe || track.subtitleSegments
  );
  const [whisperSegmentsEn, setWhisperSegmentsEn] = useState<SubtitleSegment[] | undefined>(
    track.subtitleSegmentsEn
  );
  const [whisperSegmentsOrig, setWhisperSegmentsOrig] = useState<SubtitleSegment[] | undefined>(
    track.subtitleSegmentsOrig
  );
  const [whisperLyricsHe, setWhisperLyricsHe] = useState<string | undefined>(track.lyricsHe || track.lyrics);
  const [whisperLyricsEn, setWhisperLyricsEn] = useState<string | undefined>(track.lyricsEn);
  const [whisperLyricsOrig, setWhisperLyricsOrig] = useState<string | undefined>(track.lyricsOrig);
  const [detectedLangLabel, setDetectedLangLabel] = useState<string | undefined>(track.detectedLanguageLabel);

  useEffect(() => {
    if (playerScrollRef.current) {
      playerScrollRef.current.scrollTop = 0;
    }
    setShareFeedback(null);
    setCopiedLink(false);

    const hasHe = !!(track.subtitleSegmentsHe?.length || track.subtitleSegments?.length);
    const hasEn = !!track.subtitleSegmentsEn?.length;
    setWhisperSegmentsHe(track.subtitleSegmentsHe || track.subtitleSegments);
    setWhisperSegmentsEn(track.subtitleSegmentsEn);
    setWhisperSegmentsOrig(track.subtitleSegmentsOrig);
    setWhisperLyricsHe(track.lyricsHe || track.lyrics);
    setWhisperLyricsEn(track.lyricsEn);
    setWhisperLyricsOrig(track.lyricsOrig);
    setDetectedLangLabel(track.detectedLanguageLabel);
    setSubtitleLang(!hasHe && hasEn ? 'en' : 'he');

    if (!track.id) return;
    let cancelled = false;

    const applyFreshTrackSubs = (freshTrack: JamendoTrack) => {
      if (cancelled || freshTrack.id !== track.id) return;
      const freshHe = freshTrack.subtitleSegmentsHe || freshTrack.subtitleSegments;
      const freshEn = freshTrack.subtitleSegmentsEn;
      const freshOrig = freshTrack.subtitleSegmentsOrig;
      const freshHasSubs = !!(
        freshHe?.length ||
        freshEn?.length ||
        freshOrig?.length ||
        freshTrack.lyricsHe?.trim() ||
        freshTrack.lyricsEn?.trim() ||
        freshTrack.lyricsOrig?.trim() ||
        freshTrack.lyrics?.trim()
      );
      if (freshHasSubs) {
        setWhisperSegmentsHe(freshHe);
        setWhisperSegmentsEn(freshEn);
        setWhisperSegmentsOrig(freshOrig);
        setWhisperLyricsHe(freshTrack.lyricsHe || freshTrack.lyrics);
        setWhisperLyricsEn(freshTrack.lyricsEn);
        setWhisperLyricsOrig(freshTrack.lyricsOrig);
        setDetectedLangLabel(freshTrack.detectedLanguageLabel);
        if (!freshHe?.length && freshEn?.length) {
          setSubtitleLang('en');
        }
      }
    };

    const unsubLive = subscribeTrackSubtitles(track.id, (updatedTrack) => {
      applyFreshTrackSubs(updatedTrack);
    });

    fetchSingleTrackFromCloud(track.id)
      .then((freshTrack) => {
        if (cancelled || !freshTrack || freshTrack.id !== track.id) return;
        syncTrackSubtitlesInMemory(freshTrack);
        applyFreshTrackSubs(freshTrack);
        // Collaborative auto-resume if another user left incomplete subtitles OR track still lacks subtitles
        if (!freshTrack.subtitlesDisabled) {
          void ensureTrackSubtitlesInBackground(freshTrack, isHe ? 'he' : 'en');
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubLive();
    };
  }, [
    track.id,
    track.subtitleSegments,
    track.subtitleSegmentsHe,
    track.subtitleSegmentsEn,
    track.subtitleSegmentsOrig,
    track.lyrics,
    track.lyricsHe,
    track.lyricsEn,
    track.lyricsOrig,
    track.detectedLanguageLabel,
  ]);

  const activeSegments =
    subtitleLang === 'orig'
      ? whisperSegmentsOrig && whisperSegmentsOrig.length > 0
        ? whisperSegmentsOrig
        : whisperSegmentsHe || whisperSegmentsEn
      : subtitleLang === 'en'
        ? whisperSegmentsEn && whisperSegmentsEn.length > 0
          ? whisperSegmentsEn
          : whisperSegmentsHe
        : whisperSegmentsHe && whisperSegmentsHe.length > 0
          ? whisperSegmentsHe
          : whisperSegmentsEn;

  const activeLyricsText =
    subtitleLang === 'orig'
      ? whisperLyricsOrig || whisperLyricsHe || whisperLyricsEn || track.lyrics
      : subtitleLang === 'en'
        ? whisperLyricsEn || whisperLyricsHe || track.lyrics
        : whisperLyricsHe || whisperLyricsEn || track.lyrics;

  const effectiveTrackForLyrics = React.useMemo(
    () => ({
      ...track,
      subtitleSegments: activeSegments,
      subtitleSegmentsHe: whisperSegmentsHe,
      subtitleSegmentsEn: whisperSegmentsEn,
      subtitleSegmentsOrig: whisperSegmentsOrig,
      lyrics: activeLyricsText,
      lyricsHe: whisperLyricsHe,
      lyricsEn: whisperLyricsEn,
      lyricsOrig: whisperLyricsOrig,
    }),
    [track, activeSegments, whisperSegmentsHe, whisperSegmentsEn, whisperSegmentsOrig, activeLyricsText, whisperLyricsHe, whisperLyricsEn, whisperLyricsOrig]
  );

  const syncedLyrics = React.useMemo(
    () => generateSynchronizedLyrics(effectiveTrackForLyrics, activeSegments, subtitleLang),
    [effectiveTrackForLyrics, activeSegments, subtitleLang]
  );
  const activeLineIndex = syncedLyrics.lines.findIndex(
    (line) => currentTime >= line.startTime && currentTime <= line.endTime
  );

  useEffect(() => {
    const unsub = onAuthUserChanged((user) => {
      setAuthUser(user);
      if (user) setFavoriteAuthNotice(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (track.id) {
      incrementTrackPlaysInCloud(track).catch(() => {});
    }
  }, [track.id]);

  const effectiveAudioUrl = getStreamingMediaUrl(track.audioUrl);
  const effectiveCoverUrl = getStreamingMediaUrl(track.coverUrl);

  // Dynamic matching color extracted from track cover, saved bgColor hint, or genre (zero snap on mount)
  const extractedColor = useExtractedColor(effectiveCoverUrl, track.genre || 'Pop', track.bgColor);

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

  // Collaborative global background subtitle runner: starts when track plays if missing or incomplete in R2,
  // and keeps running even after the user exits this player screen so R2 receives full-song subtitles!
  useEffect(() => {
    if (!isPlaying || !track.id || !effectiveAudioUrl || track.subtitlesDisabled) return;
    const trackSnapshot: JamendoTrack = {
      ...track,
      audioUrl: effectiveAudioUrl,
      duration: track.duration || duration || 180,
      subtitleSegments: activeSegments || track.subtitleSegments,
      subtitleSegmentsHe: whisperSegmentsHe || track.subtitleSegmentsHe,
      subtitleSegmentsEn: whisperSegmentsEn || track.subtitleSegmentsEn,
      subtitleSegmentsOrig: whisperSegmentsOrig || track.subtitleSegmentsOrig,
      lyricsHe: whisperLyricsHe || track.lyricsHe,
      lyricsEn: whisperLyricsEn || track.lyricsEn,
      lyricsOrig: whisperLyricsOrig || track.lyricsOrig,
    };
    void ensureTrackSubtitlesInBackground(trackSnapshot, isHe ? 'he' : 'en');
  }, [
    isPlaying,
    track.id,
    track.subtitlesDisabled,
    track.subtitlesIncomplete,
    track.subtitlesCompletedUpTo,
    effectiveAudioUrl,
  ]);

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

  const syncProgressDomImmediate = (timeSec: number, durSec: number) => {
    const safeDur = durSec > 0 && Number.isFinite(durSec) ? durSec : 1;
    const pct = Math.min(100, Math.max(0, (timeSec / safeDur) * 100));
    if (progressFillRef.current) {
      progressFillRef.current.style.width = `${pct}%`;
    }
    if (elapsedTimeRef.current) {
      elapsedTimeRef.current.textContent = formatClockTime(timeSec);
    }
  };

  const seekRelative = (seconds: number) => {
    if (audioRef.current) {
      const effectiveDur = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
      const targetTime = Math.max(
        0,
        Math.min(effectiveDur, audioRef.current.currentTime + seconds)
      );
      audioRef.current.currentTime = targetTime;
      syncProgressDomImmediate(targetTime, effectiveDur);
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
    const effectiveDur = audioRef.current?.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : (duration || 1);
    const newTime = ratio * effectiveDur;
    syncProgressDomImmediate(newTime, effectiveDur);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const buildTrackShareUrl = (): string => {
    const shareUrl = new URL(window.location.origin + window.location.pathname);
    shareUrl.searchParams.set('song', track.id);
    return shareUrl.toString();
  };

  const copyTextSafely = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyTrackLink = async () => {
    const urlString = buildTrackShareUrl();
    trackEvent('share_song', {
      track_id: track.id,
      track_name: track.name,
      artist_name: track.artistName,
    });

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${track.name} - ${track.artistName}`,
          text: isHe
            ? `האזן לשיר "${track.name}" מאת ${track.artistName} ב-Kolot Music`
            : `Listen to "${track.name}" by ${track.artistName} on Kolot Music`,
          url: urlString,
        });
        setCopiedLink(true);
        setShareFeedback({ url: urlString, copied: true });
        setTimeout(() => setCopiedLink(false), 2500);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
      }
    }

    const copied = await copyTextSafely(urlString);
    setShareFeedback({ url: urlString, copied });
    if (copied) {
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
    if (track.id && track.bgColor !== activeBgColor) {
      track.bgColor = activeBgColor;
      updateTrackColorInCloud(track.id, activeBgColor, track).catch(() => {});
    }
  }, [track.id, activeBgColor]);

  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const tick = (nowMs: number) => {
      if (!active) return;
      const audio = audioRef.current;
      if (audio && !isScrubbing) {
        const audioDur = audio.duration && Number.isFinite(audio.duration) ? audio.duration : duration;
        const audioCur = audio.currentTime || 0;
        syncProgressDomImmediate(audioCur, audioDur);
        if (nowMs - lastReactTimeSyncRef.current >= 75) {
          lastReactTimeSyncRef.current = nowMs;
          setCurrentTime(audioCur);
        }
      }
      if (isPlaying && !isScrubbing) {
        requestRef.current = requestAnimationFrame(tick);
      }
    };

    if (isPlaying && !isScrubbing) {
      requestRef.current = requestAnimationFrame(tick);
    } else if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    return () => {
      active = false;
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };
  }, [isPlaying, isScrubbing, duration]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] w-full h-[100dvh] bg-[#09090b] overflow-hidden text-white flex flex-col m-0 p-0 border-0"
      style={dynamicBgStyle}
    >
      {/* Immersive Dynamic Artwork Background — decoupled from scroll container to prevent backdrop-blur scroll banding */}
      {track.coverUrl ? (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <img
            src={effectiveCoverUrl}
            alt=""
            loading="eager"
            decoding="async"
            className="w-full h-full object-cover blur-3xl scale-150 saturate-200 contrast-125 opacity-75"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgba(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b}, 0.22) 0%, rgba(${Math.round(extractedColor.r * 0.52)}, ${Math.round(extractedColor.g * 0.52)}, ${Math.round(extractedColor.b * 0.52)}, 0.56) 50%, rgba(${Math.round(extractedColor.r * 0.25)}, ${Math.round(extractedColor.g * 0.25)}, ${Math.round(extractedColor.b * 0.25)}, 0.92) 100%)`,
            }}
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 pointer-events-none z-0"
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
          if (audioRef.current?.duration && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onDurationChange={() => {
          if (audioRef.current?.duration && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (audioRef.current && !isScrubbing) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d);
          }
        }}
        onSeeking={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d);
            setCurrentTime(t);
          }
        }}
        onSeeked={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d);
            setCurrentTime(t);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
        }}
      />

      {/* FLOATING TOP BAR - FROSTED GLASS BACK BUTTON */}
      <div className="absolute top-3.5 sm:top-5 left-0 right-0 z-50 px-4 sm:px-8 flex items-center justify-start pointer-events-none" dir={isHe ? 'rtl' : 'ltr'}>
        <button
          onClick={handleExitPlayer}
          className="pointer-events-auto w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white border border-white/25 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl transition-all cursor-pointer active:scale-95"
          title={isHe ? 'חזור לרשימת השירים' : 'Back to Songs'}
        >
          {isHe ? <ArrowRight className="w-5 h-5 text-white" /> : <ArrowLeft className="w-5 h-5 text-white" />}
        </button>
      </div>

      {/* INNER SCROLL CONTAINER */}
      <div
        ref={playerScrollRef}
        className="relative z-10 flex-1 w-full overflow-y-auto custom-scrollbar overscroll-contain flex flex-col"
      >
        {/* SCREEN 1: COMPACT PLAYER MAIN CONTROLS */}
        <div className="relative flex flex-col items-center px-4 pt-16 pb-4 gap-4 sm:gap-5 max-w-md mx-auto w-full shrink-0">

        {/* 1. COVER ARTWORK IMAGE */}
        <div
          className="w-44 h-44 sm:w-52 sm:h-52 md:w-56 md:h-56 max-h-[34vh] max-w-[34vh] aspect-square rounded-2xl sm:rounded-3xl p-2 bg-white/10 backdrop-blur-2xl border border-white/25 shadow-2xl flex items-center justify-center relative overflow-hidden group flex-shrink-0"
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
                ref={progressFillRef}
                className="h-full bg-white rounded-full relative will-change-[width]"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="w-4 h-4 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9),0_2px_4px_rgba(0,0,0,0.5)] absolute top-1/2 -translate-y-1/2 left-full -translate-x-1/2 group-hover:scale-125 transition-transform duration-100 ring-2 ring-black/10" />
              </div>
            </div>
          </div>

          <div dir="ltr" className="flex justify-between text-xs font-mono font-bold text-white/90 px-1 select-none">
            <span ref={elapsedTimeRef}>
              {formatClockTime(currentTime)}
            </span>
            <span>
              {formatClockTime(duration)}
            </span>
          </div>
        </div>

        {/* 3. PLAY BUTTON & CONTROLS ROW (dir="ltr" — Profile Avatar on Left, Heart on Right) */}
        <div dir="ltr" className="flex items-center justify-center gap-3 sm:gap-4 pt-1">
          <button
            onClick={handleOpenArtistProfile}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center p-1 transition-all shadow-lg cursor-pointer"
            title={isHe ? `עמוד אמן - ${track.artistName}` : `Artist - ${track.artistName}`}
          >
            {(() => {
              const resolvedArtistPhoto =
                getEffectiveArtistAvatarForTrack(track, effectiveArtists) ||
                (authUser && track.uploadedByUid === authUser.uid
                  ? getGoogleAccountPhotoUrl(authUser)
                  : undefined);
              if (resolvedArtistPhoto && isAuthenticCover(resolvedArtistPhoto)) {
                return (
                  <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center shadow-sm">
                    <img
                      src={getStreamingMediaUrl(resolvedArtistPhoto)}
                      alt={track.artistName}
                      referrerPolicy="no-referrer"
                      loading="eager"
                      decoding="async"
                      className="w-full h-full rounded-full object-cover"
                    />
                  </div>
                );
              }
              return (
                <div className="w-full h-full rounded-full bg-neutral-900 border border-white/15 text-white font-black text-xs flex items-center justify-center shadow-inner">
                  <User className="w-4 h-4 text-white" />
                </div>
              );
            })()}
          </button>

          <button
            onClick={() => seekRelative(-10)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
            aria-label={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
          >
            <SkipBack10Icon className="w-5.5 h-5.5 sm:w-6 sm:h-6" />
          </button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={togglePlayPause}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white hover:bg-slate-100 text-slate-950 flex items-center justify-center shadow-2xl transition-all cursor-pointer ring-4 ring-white/25 active:scale-95"
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
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
            aria-label={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
          >
            <SkipForward10Icon className="w-5.5 h-5.5 sm:w-6 sm:h-6" />
          </button>

          <button
            onClick={() => {
              if (!authUser) {
                setFavoriteAuthNotice(true);
                setTimeout(() => setFavoriteAuthNotice(false), 5000);
                onRequireAuth?.();
                return;
              }
              onToggleLike(track.id);
            }}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border border-white/25 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-xl text-white transition-all shadow-lg cursor-pointer active:scale-95"
            title={isLiked ? (isHe ? 'הסר ממועדפים' : 'Unlike') : (isHe ? 'הוסף למועדפים' : 'Like')}
          >
            <Heart
              className={`w-5 h-5 sm:w-5.5 sm:h-5.5 transition-colors ${
                isLiked ? 'fill-white text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]' : 'text-white/80 fill-transparent'
              }`}
            />
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
              {track.featuredArtist && <span className="text-white/80 font-semibold text-xs"> (Feat. {track.featuredArtist})</span>}
              <ArrowUpRight className="w-3.5 h-3.5 text-white" />
            </button>
          </div>

          {favoriteAuthNotice && (
            <div className="w-full max-w-sm px-3.5 py-2 rounded-2xl bg-black/65 border border-white/25 backdrop-blur-xl text-center space-y-1.5 shadow-xl">
              <p className="text-[11px] font-bold text-white">
                {isHe ? 'הוספה למועדפים זמינה למשתמשים מחוברים בלבד' : 'Favorites require a signed-in account'}
              </p>
              <button
                type="button"
                onClick={() => {
                  loginWithGoogle()
                    .then((u) => {
                      if (u) {
                        setAuthUser(u);
                        setFavoriteAuthNotice(false);
                      }
                    })
                    .catch(() => {});
                }}
                className="px-3 py-1 rounded-full bg-white text-black font-bold text-[11px] hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                {isHe ? 'התחבר עם Google' : 'Sign in with Google'}
              </button>
            </div>
          )}

        </div>
      </div>

      {/* SCREEN 2: SUBTITLES CARD FIRST + TRACK DETAILS & SHARE */}
      <div className="relative max-w-xl mx-auto w-full px-4 pt-2 pb-24 space-y-5 shrink-0">
        {/* COLLAPSIBLE SUBTITLES & LYRICS CARD (ONLY SHOWN WHEN SONG HAS SUBTITLES SAVED IN STORAGE) */}
        {(syncedLyrics.isWhisperSynced || syncedLyrics.lines.length > 0) && (
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.08] backdrop-blur-2xl border border-white/20 space-y-3 shadow-2xl transform-gpu isolate transition-colors">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsLyricsExpanded(!isLyricsExpanded)}
                className="flex-1 flex items-center justify-between text-right cursor-pointer select-none group min-w-0"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
                    <Captions className="w-4 h-4 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-white flex items-center gap-2 truncate">
                      <span>{isHe ? 'כתוביות ומילות השיר' : 'Subtitles & Lyrics'}</span>
                    </h3>
                    {!isLyricsExpanded && (() => {
                      const previewTxt =
                        (activeLineIndex >= 0 && syncedLyrics.lines[activeLineIndex]
                          ? syncedLyrics.lines[activeLineIndex].words.map((w) => w.text).join(' ')
                          : syncedLyrics.previewText) || (isHe ? 'לחץ להצגה' : 'Click to view');
                      const previewRtl = isRtlSubtitleText(previewTxt, subtitleLang);
                      return (
                        <p
                          dir={previewRtl ? 'rtl' : 'ltr'}
                          className={`text-xs text-white/80 truncate max-w-[220px] sm:max-w-[320px] pt-0.5 ${
                            previewRtl ? 'text-right' : 'text-left'
                          }`}
                        >
                          {previewTxt}
                        </p>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2.5 py-1 rounded-full bg-white/10 text-white/90 text-[10px] font-bold border border-white/15">
                    {isLyricsExpanded ? (isHe ? 'סגור' : 'Collapse') : (isHe ? 'פתח כתוביות' : 'Expand')}
                  </span>
                  {isLyricsExpanded ? (
                    <ChevronUp className="w-5 h-5 text-white/80 group-hover:text-white" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-white/80 group-hover:text-white" />
                  )}
                </div>
              </button>
            </div>

            {((whisperSegmentsHe && whisperSegmentsHe.length > 0) ||
              (whisperSegmentsEn && whisperSegmentsEn.length > 0) ||
              (whisperSegmentsOrig && whisperSegmentsOrig.length > 0) ||
              syncedLyrics.isWhisperSynced) && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  {((whisperSegmentsHe && whisperSegmentsHe.length > 0) ||
                    (whisperSegmentsEn && whisperSegmentsEn.length > 0) ||
                    (whisperSegmentsOrig && whisperSegmentsOrig.length > 0)) && (
                    <div className="inline-flex items-center flex-wrap gap-0.5 rounded-xl bg-white/5 border border-white/15 p-0.5 text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setSubtitleLang('he')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          subtitleLang === 'he' ? 'bg-white text-black' : 'text-white/75 hover:text-white'
                        }`}
                      >
                        עברית
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubtitleLang('en')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          subtitleLang === 'en' ? 'bg-white text-black' : 'text-white/75 hover:text-white'
                        }`}
                      >
                        English
                      </button>
                      {whisperSegmentsOrig && whisperSegmentsOrig.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSubtitleLang('orig')}
                          className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                            subtitleLang === 'orig' ? 'bg-white text-black' : 'text-white/75 hover:text-white'
                          }`}
                        >
                          {detectedLangLabel || (isHe ? 'שפת המקור' : 'Original')}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {syncedLyrics.isWhisperSynced && (
                  <span className="text-[10px] font-bold text-white/90 bg-white/10 border border-white/20 px-2.5 py-1 rounded-lg">
                    {isHe ? 'כתוביות מסונכרנות' : 'Synced Subtitles'}
                  </span>
                )}
              </div>
            )}

            {/* EXPANDED SCROLLABLE LYRICS CONTAINER */}
            <AnimatePresence>
              {isLyricsExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden pt-3 border-t border-white/10 space-y-3"
                >
                  <div className="max-h-72 sm:max-h-80 overflow-y-auto pe-2 space-y-2.5 select-none custom-scrollbar scroll-smooth">
                    {syncedLyrics.lines.map((line, lIdx) => {
                      const isLineActive = lIdx === activeLineIndex;
                      const mm = Math.floor(line.startTime / 60);
                      const ss = Math.floor(line.startTime % 60).toString().padStart(2, '0');
                      const lineIsRtl = isRtlSubtitleText(line.text, subtitleLang);

                      return (
                        <div
                          key={line.id}
                          dir={lineIsRtl ? 'rtl' : 'ltr'}
                          onClick={() => {
                            if (audioRef.current) {
                              const effectiveDur = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
                              audioRef.current.currentTime = line.startTime;
                              syncProgressDomImmediate(line.startTime, effectiveDur);
                              setCurrentTime(line.startTime);
                            }
                          }}
                          className={`p-2.5 rounded-2xl transition-all cursor-pointer flex items-start gap-2.5 leading-relaxed ${
                            isLineActive
                              ? 'bg-white/15 border border-white/25 shadow-lg'
                              : 'hover:bg-white/5'
                          }`}
                        >
                          <span className="text-[10px] font-mono text-white/70 bg-white/5 px-1.5 py-0.5 rounded mt-1 shrink-0">
                            {mm}:{ss}
                          </span>
                          <div
                            dir={lineIsRtl ? 'rtl' : 'ltr'}
                            className={`flex flex-wrap items-center justify-start gap-1.5 flex-1 ${
                              lineIsRtl ? 'text-right' : 'text-left'
                            }`}
                          >
                            {line.words.map((w, wIdx) => {
                              const isWordActive = currentTime >= w.startTime && currentTime <= w.endTime;

                              return (
                                <span
                                  key={wIdx}
                                  className={`text-xs sm:text-sm transition-all duration-100 ${
                                    isWordActive
                                      ? 'bg-white text-black font-black px-2 py-0.5 rounded-lg shadow-md scale-105 inline-block'
                                      : 'text-white font-medium hover:text-white/80'
                                  }`}
                                >
                                  {w.text}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-white/50 text-center">
                    {isHe ? 'לחץ על כל שורת כתובית כדי לקפוץ אליה בשיר' : 'Click any subtitle line to jump to that moment'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="p-5 sm:p-6 rounded-3xl bg-white/[0.08] backdrop-blur-2xl border border-white/20 space-y-4 shadow-2xl transform-gpu isolate">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/15 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Music2 className="w-4 h-4 text-white" />
              <span>{isHe ? 'פרטי היצירה והזמר' : 'Track & Artist Details'}</span>
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              {/* AI BADGE POSITIONED RIGHT NEXT TO REPORT BUTTON */}
              {track.isAiGenerated && (
                <span
                  className="px-2.5 py-1 rounded-full bg-purple-500/20 backdrop-blur-xl text-purple-200 border border-purple-400/40 font-bold text-xs tracking-wider uppercase inline-flex items-center gap-1 shadow-md shrink-0 select-none"
                  title={isHe ? 'שיר שנוצר בבינה מלאכותית' : 'AI Generated Song'}
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                  <span>AI</span>
                </span>
              )}

              {/* REPORT BUTTON (🚩) */}
              <button
                onClick={() => setIsReportModalOpen(true)}
                className="px-3 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/35 backdrop-blur-xl text-rose-200 border border-rose-500/40 text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-md"
                title={isHe ? 'דווח על שיר זה' : 'Report Song'}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-300" />
                <span>{isHe ? 'דווח' : 'Report'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyTrackLink}
                className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl text-white border border-white/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                title={isHe ? 'שתף קישור לשיר' : 'Share Song Link'}
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{copiedLink ? (isHe ? 'הועתק' : 'Copied') : (isHe ? 'שתף' : 'Share')}</span>
              </button>
            </div>
          </div>

          {shareFeedback && !shareFeedback.copied && (
            <div className="p-3 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/20 flex items-center gap-2">
              <input
                type="text"
                readOnly
                dir="ltr"
                value={shareFeedback.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-white/10 border border-white/15 rounded-xl px-3 py-1.5 text-[11px] font-mono text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyTextSafely(shareFeedback.url);
                  if (ok) {
                    setShareFeedback({ url: shareFeedback.url, copied: true });
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2500);
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-white text-black font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{isHe ? 'העתק' : 'Copy'}</span>
              </button>
            </div>
          )}

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
                className="font-bold text-white hover:text-white/80 text-sm truncate block text-start cursor-pointer underline decoration-dotted"
              >
                {track.artistName}
              </button>
            </div>

            {track.featuredArtist && (
              <div>
                <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'זמר אורח:' : 'Featured Artist:'}</span>
                <span className="font-bold text-white/90 text-xs truncate block">{track.featuredArtist}</span>
              </div>
            )}

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
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'צפיות:' : 'Views:'}</span>
              <span className="font-bold text-white/90 tabular-nums">{(track.viewsCount ?? 0).toLocaleString()}</span>
            </div>

            {track.writers && (
              <div className="col-span-2 sm:col-span-3 pt-1 border-t border-white/10">
                <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'כותבים ומלחינים:' : 'Writers & Composers:'}</span>
                <span className="font-bold text-white/90 text-xs truncate block">{track.writers}</span>
              </div>
            )}
            <div>
              <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'סטטוס זכויות:' : 'Rights Status:'}</span>
              <span className="font-bold text-white truncate block">{track.legalStatus || (isHe ? 'מאושר להאזנה' : 'Licensed')}</span>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* SHARE FEEDBACK TOAST */}
      {copiedLink && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-2.5 rounded-full bg-white text-black font-black text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Share2 className="w-4 h-4 text-black" />
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
            artistUid={track.uploadedByUid}
            isOpen={isArtistProfileOpen}
            onClose={() => setIsArtistProfileOpen(false)}
            allTracks={Array.isArray(allTracks) ? allTracks : []}
            allArtists={effectiveArtists}
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
        }}
        lang={lang}
        onTrackPublished={(newTrack) => {
          if (onPlayTrack) {
            onPlayTrack(newTrack);
          }
        }}
        onArtistUpdated={(updatedArtist) => {
          upsertMemoryArtistProfile(updatedArtist);
          const cleanUpdatedUid = (updatedArtist.googleUid || updatedArtist.id || '').replace(/^artist_/, '').toLowerCase().trim();
          updateMemoryTracksArtistAvatar(cleanUpdatedUid, updatedArtist.avatarUrl, updatedArtist.name);
          setLoadedArtists((prev) => {
            const idx = prev.findIndex((a) => (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim() === cleanUpdatedUid);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...updatedArtist };
              return next;
            }
            return [updatedArtist, ...prev];
          });
        }}
        allTracks={allTracks}
        onAccountDeleted={(deletedUid) => {
          const cleanDeleted = deletedUid.replace(/^artist_/, '').toLowerCase().trim();
          removeMemoryArtistProfile(deletedUid);
          setLoadedArtists((prev) =>
            prev.filter((a) => (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim() !== cleanDeleted)
          );
        }}
        onRemoveTrack={onRemoveTrack}
      />
    </motion.div>
  );
};
