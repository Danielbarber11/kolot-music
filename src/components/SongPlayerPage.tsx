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
  SlidersHorizontal,
  Moon,
  Bluetooth,
  Speaker,
  Headphones,
  Volume2,
  VolumeX,
  Gauge,
  RefreshCw,
  Mic2,
  X,
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
import { createLiveKaraokeController, LiveKaraokeController } from '../services/karaokeAudioService';
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
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const elapsedTimeRef = useRef<HTMLSpanElement>(null);
  const smoothClockRef = useRef<{
    clockTimeSec: number;
    lastPerfMs: number;
    isBuffering: boolean;
  }>({ clockTimeSec: 0, lastPerfMs: 0, isBuffering: false });
  const lastReactTimeSyncRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track.duration || 180);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<{ url: string; copied: boolean } | null>(null);
  const [favoriteAuthNotice, setFavoriteAuthNotice] = useState(false);
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);

  // Karaoke mode ("מצב קריוקי": removes lead vocals & replaces cover artwork with live lyrics)
  const [isKaraokeMode, setIsKaraokeMode] = useState(false);
  const [cloudKaraokeUrl, setCloudKaraokeUrl] = useState<string | undefined>(track.karaokeAudioUrl);
  const liveKaraokeRef = useRef<LiveKaraokeController | null>(null);
  const pendingResumeTimeRef = useRef<number | null>(null);
  const shouldAutoPlayAfterSwapRef = useRef<boolean>(false);

  // "כלים נוספים" (More Tools) panel state: Sleep Timer, Karaoke, Bluetooth & Audio Output, Speed/Volume
  const [isMoreToolsOpen, setIsMoreToolsOpen] = useState(false);
  const [moreToolsTab, setMoreToolsTab] = useState<'sleep' | 'karaoke' | 'bluetooth' | 'audio'>('sleep');

  // Sleep Timer state
  const [sleepEndTimestamp, setSleepEndTimestamp] = useState<number | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [sleepStopAtTrackEnd, setSleepStopAtTrackEnd] = useState(false);
  const [sleepFinishAction, setSleepFinishAction] = useState<'keep-open' | 'sleep-screen'>('keep-open');
  const [customSleepMinutes, setCustomSleepMinutes] = useState('20');
  const [sleepEndedBanner, setSleepEndedBanner] = useState(false);
  const [sleepBlackoutOverlay, setSleepBlackoutOverlay] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const activeLyricsLineRef = useRef<HTMLDivElement | null>(null);

  // Bluetooth & Audio Output state
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedSinkId, setSelectedSinkId] = useState<string>('');
  const [audioOutputMessage, setAudioOutputMessage] = useState<string | null>(null);
  const [bluetoothDeviceInfo, setBluetoothDeviceInfo] = useState<{
    name: string;
    batteryPercent?: number | null;
    connected: boolean;
  } | null>(null);
  const bluetoothServerRef = useRef<any>(null);
  const [isScanningBluetooth, setIsScanningBluetooth] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [volumeLevel, setVolumeLevel] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
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

  // Reset scroll & local UI ONLY when entering a different song (track.id changes), never on background subtitle updates!
  useEffect(() => {
    if (playerScrollRef.current) {
      playerScrollRef.current.scrollTop = 0;
    }
    setShareFeedback(null);
    setCopiedLink(false);
    setIsLyricsExpanded(false);
    setSleepEndedBanner(false);
    setSleepBlackoutOverlay(false);
    setIsKaraokeMode(false);
    setCloudKaraokeUrl(track.karaokeAudioUrl);
    pendingResumeTimeRef.current = null;
    shouldAutoPlayAfterSwapRef.current = false;
    if (liveKaraokeRef.current) {
      liveKaraokeRef.current.destroy();
      liveKaraokeRef.current = null;
    }
    smoothClockRef.current = {
      clockTimeSec: 0,
      lastPerfMs: typeof performance !== 'undefined' ? performance.now() : 0,
      isBuffering: false,
    };
    syncProgressDomImmediate(0, track.duration || 180, true);

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
      if (freshTrack.karaokeAudioUrl) {
        setCloudKaraokeUrl(freshTrack.karaokeAudioUrl);
      }
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
        setSubtitleLang((cur) => (cur === 'he' && !freshHe?.length && freshEn?.length ? 'en' : cur));
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
  }, [track.id]);

  // Keep subtitle segments in sync when parent updates track props without scrolling or resetting user tab
  useEffect(() => {
    setWhisperSegmentsHe(track.subtitleSegmentsHe || track.subtitleSegments);
    setWhisperSegmentsEn(track.subtitleSegmentsEn);
    setWhisperSegmentsOrig(track.subtitleSegmentsOrig);
    setWhisperLyricsHe(track.lyricsHe || track.lyrics);
    setWhisperLyricsEn(track.lyricsEn);
    setWhisperLyricsOrig(track.lyricsOrig);
    setDetectedLangLabel(track.detectedLanguageLabel);
  }, [
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

  // Keep publisher Karaoke availability synced with parent prop updates
  useEffect(() => {
    setCloudKaraokeUrl(track.karaokeAudioUrl);
    if (track.karaokeEnabled === false) {
      setIsKaraokeMode(false);
      if (liveKaraokeRef.current) {
        liveKaraokeRef.current.setEnabled(false);
      }
    }
  }, [track.karaokeAudioUrl, track.karaokeEnabled]);

  const syncedLyrics = React.useMemo(
    () => generateSynchronizedLyrics(effectiveTrackForLyrics, activeSegments, subtitleLang),
    [effectiveTrackForLyrics, activeSegments, subtitleLang]
  );

  // PlaybackRate-aware lookahead so highlighted phrase switches immediately as the singer finishes each line
  const subtitleSyncTime = Math.min(
    duration > 0 ? duration : 9999,
    Math.max(0, currentTime + 0.06 * (playbackRate || 1))
  );

  const activeLineIndex = React.useMemo(() => {
    const lines = syncedLyrics.lines;
    if (!lines.length) return -1;
    let matched = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const nextStart = i + 1 < lines.length ? lines[i + 1].startTime : l.endTime + 0.05;
      const effectiveEnd = Math.min(l.endTime, nextStart - 0.01);
      if (subtitleSyncTime >= l.startTime && subtitleSyncTime < Math.max(l.startTime + 0.05, effectiveEnd)) {
        matched = i;
      }
    }
    return matched;
  }, [syncedLyrics.lines, subtitleSyncTime]);

  useEffect(() => {
    if (isLyricsExpanded && activeLineIndex >= 0 && activeLyricsLineRef.current) {
      try {
        activeLyricsLineRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch {}
    }
  }, [activeLineIndex, isLyricsExpanded]);

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

  // Keep screen awake automatically whenever SongPlayerPage is open (unless dark sleep screen overlay is active)
  useEffect(() => {
    if (sleepBlackoutOverlay) {
      if (wakeLockRef.current && typeof wakeLockRef.current.release === 'function') {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const acquireWakeLock = async () => {
      try {
        const navAny = navigator as any;
        if (!cancelled && document.visibilityState === 'visible' && navAny?.wakeLock?.request && !wakeLockRef.current) {
          const sentinel = await navAny.wakeLock.request('screen');
          if (cancelled) {
            sentinel?.release?.().catch(() => {});
            return;
          }
          wakeLockRef.current = sentinel;
          sentinel?.addEventListener?.('release', () => {
            if (wakeLockRef.current === sentinel) {
              wakeLockRef.current = null;
            }
          });
        }
      } catch {}
    };

    void acquireWakeLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !sleepBlackoutOverlay) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current && typeof wakeLockRef.current.release === 'function') {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [sleepBlackoutOverlay]);

  const pregeneratedKaraokeUrl = cloudKaraokeUrl || track.karaokeAudioUrl;
  const hasPublisherKaraoke =
    (Boolean(pregeneratedKaraokeUrl) && track.karaokeEnabled !== false) ||
    track.karaokeEnabled === true;

  const effectiveAudioUrl =
    isKaraokeMode && hasPublisherKaraoke && pregeneratedKaraokeUrl
      ? getStreamingMediaUrl(pregeneratedKaraokeUrl)
      : getStreamingMediaUrl(track.audioUrl);
  const effectiveCoverUrl = getStreamingMediaUrl(track.coverUrl);
  const shouldUseAnonymousCors =
    !pregeneratedKaraokeUrl &&
    (effectiveAudioUrl.startsWith('/') || effectiveAudioUrl.includes('/api/storage/'));

  const handleToggleKaraokeMode = () => {
    if (!hasPublisherKaraoke) {
      setIsKaraokeMode(false);
      return;
    }
    const next = !isKaraokeMode;
    const audio = audioRef.current;

    if (pregeneratedKaraokeUrl) {
      if (audio) {
        pendingResumeTimeRef.current = audio.currentTime || currentTime || 0;
        shouldAutoPlayAfterSwapRef.current = isPlaying && !audio.paused;
      }
      setIsKaraokeMode(next);
      return;
    }

    // Fallback when publisher enabled karaoke on a track without a cached WAV yet: real-time Web Audio vocal removal
    if (audio) {
      if (!liveKaraokeRef.current) {
        liveKaraokeRef.current = createLiveKaraokeController(audio);
      }
      liveKaraokeRef.current?.setEnabled(next);
    }
    setIsKaraokeMode(next);
  };

  // Dynamic matching color extracted from track cover, saved bgColor hint, or genre (zero snap on mount)
  const extractedColor = useExtractedColor(effectiveCoverUrl, track.genre || 'Pop', track.bgColor);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !effectiveAudioUrl) return;
    const shouldResumeSwap = pendingResumeTimeRef.current !== null;
    const shouldAutoPlay = shouldResumeSwap ? shouldAutoPlayAfterSwapRef.current : true;

    audio.load();
    audio.playbackRate = playbackRate;
    audio.volume = isMuted ? 0 : volumeLevel;
    audio.muted = isMuted;

    if (shouldAutoPlay) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('Playback notice:', err);
            setIsPlaying(false);
          });
      }
    } else {
      setIsPlaying(false);
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
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        const actions: MediaSessionAction[] = [
          'play',
          'pause',
          'stop',
          'seekbackward',
          'seekforward',
          'seekto',
          'previoustrack',
          'nexttrack',
        ];
        actions.forEach((act) => {
          try {
            navigator.mediaSession.setActionHandler(act, null);
          } catch {}
        });
        try {
          if (typeof navigator.mediaSession.setPositionState === 'function') {
            navigator.mediaSession.setPositionState();
          }
        } catch {}
      }
    } catch {}
  };

  const handleExitPlayer = () => {
    clearMediaSessionCompletely(audioRef.current, true);
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
    const handlePageHide = () => {
      clearMediaSessionCompletely(audioRef.current, true);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      clearMediaSessionCompletely(audioRef.current, true);
      if (liveKaraokeRef.current) {
        liveKaraokeRef.current.destroy();
        liveKaraokeRef.current = null;
      }
      if (wakeLockRef.current && typeof wakeLockRef.current.release === 'function') {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      try {
        if (bluetoothServerRef.current?.connected) {
          bluetoothServerRef.current.disconnect();
        }
      } catch {}
    };
  }, []);

  // Sleep Timer Countdown & Gentle Fade-Out Engine
  const finishSleepTimer = React.useCallback(() => {
    const audio = audioRef.current;
    setSleepEndTimestamp(null);
    setSleepRemainingSec(null);
    setSleepStopAtTrackEnd(false);

    const finalizeStop = () => {
      clearMediaSessionCompletely(audio, false);
      setIsPlaying(false);
      if (audio) {
        audio.volume = isMuted ? 0 : volumeLevel;
      }
      if (wakeLockRef.current && typeof wakeLockRef.current.release === 'function') {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      setSleepEndedBanner(true);
      if (sleepFinishAction === 'sleep-screen') {
        setSleepBlackoutOverlay(true);
        try {
          // Allow standalone/installed PWA to attempt clean close if OS permits; otherwise keeps darkened ready state
          if (window.matchMedia?.('(display-mode: standalone)')?.matches) {
            window.close();
          }
        } catch {}
      }
    };

    if (!audio || audio.paused) {
      finalizeStop();
      return;
    }

    const startVol = audio.volume;
    const steps = 12;
    let step = 0;
    const fadeTimer = setInterval(() => {
      step += 1;
      try {
        audio.volume = Math.max(0, startVol * (1 - step / steps));
      } catch {}
      if (step >= steps) {
        clearInterval(fadeTimer);
        finalizeStop();
      }
    }, 160);
  }, [isMuted, volumeLevel, sleepFinishAction]);

  useEffect(() => {
    if (!sleepEndTimestamp) {
      setSleepRemainingSec(null);
      return;
    }
    const updateRemaining = () => {
      const diffSec = Math.ceil((sleepEndTimestamp - Date.now()) / 1000);
      if (diffSec <= 0) {
        finishSleepTimer();
      } else {
        setSleepRemainingSec(diffSec);
      }
    };
    updateRemaining();
    const timer = setInterval(updateRemaining, 500);
    return () => clearInterval(timer);
  }, [sleepEndTimestamp, finishSleepTimer]);

  const startSleepTimerMinutes = (minutes: number) => {
    const safeMin = Math.max(1, Math.min(240, Math.round(minutes)));
    setSleepStopAtTrackEnd(false);
    setSleepEndedBanner(false);
    setSleepBlackoutOverlay(false);
    setSleepEndTimestamp(Date.now() + safeMin * 60 * 1000);
    setSleepRemainingSec(safeMin * 60);
  };

  const cancelSleepTimer = () => {
    setSleepEndTimestamp(null);
    setSleepRemainingSec(null);
    setSleepStopAtTrackEnd(false);
    setSleepEndedBanner(false);
    setSleepBlackoutOverlay(false);
  };

  // Enumerate & Manage Audio Output Devices (Speakers / Headphones / Bluetooth)
  const refreshAudioOutputs = React.useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === 'audiooutput');
      setAudioOutputs(outputs);
    } catch {}
  }, []);

  useEffect(() => {
    refreshAudioOutputs();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.addEventListener !== 'function') return;
    md.addEventListener('devicechange', refreshAudioOutputs);
    return () => {
      md.removeEventListener('devicechange', refreshAudioOutputs);
    };
  }, [refreshAudioOutputs]);

  const handleSelectAudioOutputPicker = async () => {
    setAudioOutputMessage(null);
    try {
      const md: any = navigator.mediaDevices;
      const audio: any = audioRef.current;
      if (md && typeof md.selectAudioOutput === 'function') {
        const picked: MediaDeviceInfo = await md.selectAudioOutput();
        if (picked?.deviceId && audio && typeof audio.setSinkId === 'function') {
          await audio.setSinkId(picked.deviceId);
          setSelectedSinkId(picked.deviceId);
          setAudioOutputMessage(
            isHe
              ? `השמע הועבר אל: ${picked.label || 'התקן חיצוני'}`
              : `Audio routed to: ${picked.label || 'External device'}`
          );
          refreshAudioOutputs();
          return;
        }
      }
      await refreshAudioOutputs();
      setAudioOutputMessage(
        isHe
          ? 'במכשיר זה ניתן לבחור אוזניות/רמקול בלוטוס מתוך הרשימה מטה או מווילון פלט השמע של המכשיר.'
          : 'Select an output below or via your device Media Output / Bluetooth quick panel.'
      );
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') {
        setAudioOutputMessage(
          isHe
            ? 'בחירת פלט שמע ישירה אינה נתמכת בדפדפן זה — השתמש בפלט המדיה של המכשיר.'
            : 'Direct output picker is unavailable in this browser; use your OS media output tray.'
        );
      }
    }
  };

  const handleSetSinkId = async (deviceId: string, label?: string) => {
    setAudioOutputMessage(null);
    try {
      const audio: any = audioRef.current;
      if (audio && typeof audio.setSinkId === 'function') {
        await audio.setSinkId(deviceId);
        setSelectedSinkId(deviceId);
        setAudioOutputMessage(
          isHe
            ? `השמע מחובר ל: ${label || 'ברירת מחדל'}`
            : `Routed to: ${label || 'Default'}`
        );
      } else {
        setAudioOutputMessage(
          isHe
            ? 'בדפדפן נייד זה חיבור הבלוטוס מנוהל אוטומטית על ידי מערכת ההפעלה בעת חיבור האוזניות או הרמקול.'
            : 'Audio routing is managed automatically by your OS when Bluetooth devices connect.'
        );
      }
    } catch {
      setAudioOutputMessage(isHe ? 'לא ניתן להעביר שמע להתקן זה כרגע' : 'Could not route audio to this device.');
    }
  };

  const handleScanBluetoothDevice = async () => {
    setAudioOutputMessage(null);
    const navAny: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!navAny?.bluetooth || typeof navAny.bluetooth.requestDevice !== 'function') {
      setAudioOutputMessage(
        isHe
          ? 'סריקת Web Bluetooth אינה נתמכת בדפדפן זה. חבר את האוזניות או הרמקול בהגדרות ה-Bluetooth של המכשיר והשמע יעבור אוטומטית.'
          : 'Web Bluetooth is not supported in this browser. Pair in OS Bluetooth settings to stream automatically.'
      );
      return;
    }

    setIsScanningBluetooth(true);
    try {
      const device = await navAny.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      let batteryPercent: number | null = null;
      if (device?.gatt) {
        try {
          const server = await device.gatt.connect();
          bluetoothServerRef.current = server;
          try {
            const batterySvc = await server.getPrimaryService('battery_service');
            const batteryChar = await batterySvc.getCharacteristic('battery_level');
            const val = await batteryChar.readValue();
            batteryPercent = val.getUint8(0);
          } catch {}
        } catch {}
      }
      setBluetoothDeviceInfo({
        name: device?.name || (isHe ? 'התקן Bluetooth' : 'Bluetooth Device'),
        batteryPercent,
        connected: true,
      });
      setAudioOutputMessage(
        isHe
          ? `מחובר להתקן: ${device?.name || 'Bluetooth'}`
          : `Connected to: ${device?.name || 'Bluetooth'}`
      );
      await refreshAudioOutputs();
    } catch (err: any) {
      if (err?.name !== 'NotFoundError' && err?.name !== 'AbortError') {
        setAudioOutputMessage(
          isHe ? 'לא הושלם חיבור Bluetooth.' : 'Bluetooth connection did not complete.'
        );
      }
    } finally {
      setIsScanningBluetooth(false);
    }
  };

  const syncProgressDomImmediate = (timeSec: number, durSec: number, resetClock = false) => {
    const safeDur = durSec > 0 && Number.isFinite(durSec) ? durSec : 1;
    const clampedTime = Math.max(0, Math.min(safeDur, Number.isFinite(timeSec) ? timeSec : 0));
    const ratio = Math.min(1, Math.max(0, clampedTime / safeDur));
    const pct = ratio * 100;
    if (progressFillRef.current) {
      // Translate a full-width rounded-full fill inside overflow-hidden clip so BOTH ends stay cleanly rounded
      progressFillRef.current.style.transform = `translate3d(${(ratio - 1) * 100}%, 0, 0)`;
    }
    if (progressThumbRef.current) {
      progressThumbRef.current.style.left = `${pct}%`;
    }
    if (elapsedTimeRef.current) {
      elapsedTimeRef.current.textContent = formatClockTime(clampedTime);
    }
    if (resetClock) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      smoothClockRef.current = {
        clockTimeSec: clampedTime,
        lastPerfMs: now,
        isBuffering: false,
      };
    }
  };

  const syncMediaSessionPosition = (timeSec: number, durSec: number) => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        'mediaSession' in navigator &&
        typeof navigator.mediaSession.setPositionState === 'function' &&
        Number.isFinite(durSec) &&
        durSec > 0
      ) {
        navigator.mediaSession.setPositionState({
          duration: durSec,
          playbackRate: playbackRate || 1,
          position: Math.max(0, Math.min(durSec, Number.isFinite(timeSec) ? timeSec : 0)),
        });
      }
    } catch {}
  };

  const seekRelative = (seconds: number) => {
    if (audioRef.current) {
      const effectiveDur = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
      const targetTime = Math.max(
        0,
        Math.min(effectiveDur, audioRef.current.currentTime + seconds)
      );
      audioRef.current.currentTime = targetTime;
      syncProgressDomImmediate(targetTime, effectiveDur, true);
      syncMediaSessionPosition(targetTime, effectiveDur);
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
    syncProgressDomImmediate(newTime, effectiveDur, true);
    syncMediaSessionPosition(newTime, effectiveDur);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  // Sync dynamic <meta name="theme-color"> so Chrome / Samsung One UI notification & status bar absorb track colors
  useEffect(() => {
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) return;
    const rgbColor = `rgb(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b})`;
    metaTheme.setAttribute('content', rgbColor);
    return () => {
      metaTheme.setAttribute('content', '#000000');
    };
  }, [extractedColor.r, extractedColor.g, extractedColor.b]);

  // Native Mobile / Samsung OS Media Notification Controls (Lock screen & Colored Notification Shade)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }
    let cancelled = false;
    const origin = window.location.origin;

    const guessMimeType = (urlStr: string): string => {
      const clean = urlStr.split('?')[0].toLowerCase();
      if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
      if (clean.endsWith('.webp')) return 'image/webp';
      return 'image/png';
    };

    const createTintedArtworkPng = async (): Promise<string | null> => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const grad = ctx.createLinearGradient(0, 0, 512, 512);
        grad.addColorStop(0, `rgb(${extractedColor.r}, ${extractedColor.g}, ${extractedColor.b})`);
        grad.addColorStop(
          1,
          `rgb(${Math.max(12, Math.round(extractedColor.r * 0.45))}, ${Math.max(12, Math.round(extractedColor.g * 0.45))}, ${Math.max(18, Math.round(extractedColor.b * 0.45))})`
        );
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);

        if (effectiveCoverUrl && !effectiveCoverUrl.startsWith('blob:')) {
          const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = new URL(effectiveCoverUrl, origin).toString();
          });
          if (loaded && loaded.naturalWidth > 0 && loaded.naturalHeight > 0) {
            const scale = Math.max(512 / loaded.naturalWidth, 512 / loaded.naturalHeight);
            const w = loaded.naturalWidth * scale;
            const h = loaded.naturalHeight * scale;
            ctx.drawImage(loaded, (512 - w) / 2, (512 - h) / 2, w, h);
            return canvas.toDataURL('image/png');
          }
        }

        // Stylized fallback emblem on dynamic gradient color so Samsung still extracts song palette
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.beginPath();
        ctx.arc(256, 256, 150, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 132px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', 256, 260);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    };

    const applyMediaMetadata = async () => {
      const artwork: MediaImage[] = [];
      if (effectiveCoverUrl && !effectiveCoverUrl.startsWith('blob:')) {
        try {
          const absCover = new URL(effectiveCoverUrl, origin).toString();
          const mime = guessMimeType(absCover);
          artwork.push(
            { src: absCover, sizes: '512x512', type: mime },
            { src: absCover, sizes: '192x192', type: mime }
          );
        } catch {}
      }

      const rasterPng = await createTintedArtworkPng();
      if (cancelled) return;
      if (rasterPng) {
        // Put verified raster PNG first so Android/Samsung Bitmap decoder always extracts cover + palette colors
        artwork.unshift(
          { src: rasterPng, sizes: '512x512', type: 'image/png' },
          { src: rasterPng, sizes: '192x192', type: 'image/png' }
        );
      } else if (artwork.length === 0) {
        artwork.push(
          { src: `${origin}/pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${origin}/pwa-192x192.png`, sizes: '192x192', type: 'image/png' }
        );
      }

      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.name || 'Kolot Music',
          artist: track.artistName || 'Kolot Music',
          album: track.albumName || 'Kolot Music',
          artwork,
        });
      } catch {}
    };

    void applyMediaMetadata();

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        clearMediaSessionCompletely(audioRef.current, false);
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        seekRelative(-(details?.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        seekRelative(details?.seekOffset || 10);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (audioRef.current && typeof details?.seekTime === 'number' && Number.isFinite(details.seekTime)) {
          const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
          const t = Math.max(0, Math.min(d, details.seekTime));
          audioRef.current.currentTime = t;
          syncProgressDomImmediate(t, d, true);
          syncMediaSessionPosition(t, d);
          setCurrentTime(t);
        }
      });

      const idx = allTracks.findIndex((t) => t.id === track.id);
      if (onPlayTrack && idx >= 0 && allTracks.length > 1) {
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          const prev = allTracks[(idx - 1 + allTracks.length) % allTracks.length];
          if (prev) onPlayTrack(prev);
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          const next = allTracks[(idx + 1) % allTracks.length];
          if (next) onPlayTrack(next);
        });
      } else {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    } catch {}

    return () => {
      cancelled = true;
    };
  }, [
    track.id,
    track.name,
    track.artistName,
    track.albumName,
    effectiveCoverUrl,
    allTracks.length,
    extractedColor.r,
    extractedColor.g,
    extractedColor.b,
  ]);

  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        if (!audioRef.current?.getAttribute('src')) {
          navigator.mediaSession.playbackState = 'none';
          return;
        }
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      }
    } catch {}
  }, [isPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
      const d =
        audioRef.current.duration && Number.isFinite(audioRef.current.duration)
          ? audioRef.current.duration
          : duration;
      syncMediaSessionPosition(audioRef.current.currentTime || currentTime || 0, d);
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volumeLevel;
      audioRef.current.muted = isMuted;
    }
  }, [volumeLevel, isMuted]);

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
        const audioDur =
          audio.duration && Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : duration;
        const audioCur = audio.currentTime || 0;
        const sc = smoothClockRef.current;
        const dt = sc.lastPerfMs > 0 ? Math.min(0.1, Math.max(0, (nowMs - sc.lastPerfMs) / 1000)) : 0;
        sc.lastPerfMs = nowMs;

        if (!audio.paused && !audio.ended && !sc.isBuffering && audio.readyState >= 2) {
          const rate = audio.playbackRate || 1;
          sc.clockTimeSec += dt * rate;
          const drift = audioCur - sc.clockTimeSec;
          if (Math.abs(drift) > 0.08) {
            sc.clockTimeSec = audioCur;
          } else if (Math.abs(drift) > 0.02) {
            sc.clockTimeSec += drift * 0.25;
          }
          sc.clockTimeSec = Math.max(0, Math.min(audioDur, sc.clockTimeSec));
        } else {
          sc.clockTimeSec = audioCur;
        }

        syncProgressDomImmediate(sc.clockTimeSec, audioDur, false);
        if (nowMs - lastReactTimeSyncRef.current >= 40) {
          lastReactTimeSyncRef.current = nowMs;
          setCurrentTime(sc.clockTimeSec);
        }
      }
      if (isPlaying && !isScrubbing) {
        requestRef.current = requestAnimationFrame(tick);
      }
    };

    if (isPlaying && !isScrubbing) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      smoothClockRef.current.lastPerfMs = now;
      smoothClockRef.current.clockTimeSec = audioRef.current?.currentTime ?? smoothClockRef.current.clockTimeSec ?? 0;
      smoothClockRef.current.isBuffering = false;
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
        crossOrigin={shouldUseAnonymousCors ? 'anonymous' : undefined}
        preload="auto"
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          const dur = audio.duration && Number.isFinite(audio.duration) ? audio.duration : duration;
          if (audio.duration && Number.isFinite(audio.duration)) {
            setDuration(audio.duration);
          }
          if (pendingResumeTimeRef.current !== null) {
            const target = Math.max(0, Math.min(dur || 180, pendingResumeTimeRef.current));
            pendingResumeTimeRef.current = null;
            audio.currentTime = target;
            syncProgressDomImmediate(target, dur, true);
            syncMediaSessionPosition(target, dur);
            setCurrentTime(target);
            if (shouldAutoPlayAfterSwapRef.current) {
              audio.play().then(() => setIsPlaying(true)).catch(() => {});
            }
          } else {
            syncProgressDomImmediate(audio.currentTime || 0, dur, true);
            syncMediaSessionPosition(audio.currentTime || 0, dur);
          }
        }}
        onDurationChange={() => {
          if (audioRef.current?.duration && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
            if (pendingResumeTimeRef.current === null) {
              syncProgressDomImmediate(audioRef.current.currentTime || 0, audioRef.current.duration, true);
              syncMediaSessionPosition(audioRef.current.currentTime || 0, audioRef.current.duration);
            }
          }
        }}
        onWaiting={() => {
          smoothClockRef.current.isBuffering = true;
        }}
        onCanPlay={() => {
          smoothClockRef.current.isBuffering = false;
          smoothClockRef.current.lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
        }}
        onPlaying={() => {
          smoothClockRef.current.isBuffering = false;
          smoothClockRef.current.lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
        }}
        onPlay={() => {
          setIsPlaying(true);
          smoothClockRef.current.isBuffering = false;
          smoothClockRef.current.lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
          if (audioRef.current) {
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncMediaSessionPosition(audioRef.current.currentTime || 0, d);
          }
        }}
        onPause={() => {
          setIsPlaying(false);
          if (audioRef.current) {
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncMediaSessionPosition(audioRef.current.currentTime || 0, d);
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current && !isScrubbing && audioRef.current.paused) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d, true);
          }
        }}
        onSeeking={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d, true);
            syncMediaSessionPosition(t, d);
            setCurrentTime(t);
          }
        }}
        onSeeked={() => {
          if (audioRef.current) {
            const t = audioRef.current.currentTime;
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncProgressDomImmediate(t, d, true);
            syncMediaSessionPosition(t, d);
            setCurrentTime(t);
          }
        }}
        onEnded={() => {
          const d = audioRef.current?.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
          syncProgressDomImmediate(d, d, true);
          setCurrentTime(d);
          setIsPlaying(false);
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
          if (sleepStopAtTrackEnd) {
            finishSleepTimer();
          }
        }}
      />

      {/* FLOATING TOP BAR - FROSTED GLASS BACK BUTTON */}
      <div className="absolute top-3.5 sm:top-5 left-0 right-0 z-50 px-4 sm:px-8 flex items-center justify-start pointer-events-none" dir={isHe ? 'rtl' : 'ltr'}>
        <button
          type="button"
          onClick={handleExitPlayer}
          className="pointer-events-auto w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white border border-white/25 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl transition-all cursor-pointer active:scale-95"
          title={isHe ? 'חזור לרשימת השירים' : 'Back to Songs'}
        >
          {isHe ? <ArrowRight className="w-5 h-5 text-white" /> : <ArrowLeft className="w-5 h-5 text-white" />}
        </button>
      </div>

      {/* INNER SCROLL CONTAINER (min-h-0 + overflowAnchor:none ensures smooth desktop & mobile scrolling without snapping back to top) */}
      <div
        ref={playerScrollRef}
        style={{ overflowAnchor: 'none' }}
        className="relative z-10 flex-1 min-h-0 w-full overflow-y-auto custom-scrollbar overscroll-contain flex flex-col"
      >
        {/* SCREEN 1: MOBILE-ANCHORED BOTTOM CONTROLS + CENTERED ARTWORK/KARAOKE STAGE (FITS CLEANLY BEFORE SCROLLING) */}
        <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-between sm:justify-center px-4 pt-16 pb-5 sm:pt-14 sm:pb-12 gap-2.5 sm:gap-5 max-w-md mx-auto shrink-0">

        {/* 1. COVER ARTWORK IMAGE OR KARAOKE LIVE LYRICS STAGE (Slightly lowered toward vertical middle on mobile) */}
        {isKaraokeMode ? (
          <div className="w-full max-w-md h-[40dvh] sm:h-[42dvh] min-h-[210px] max-h-[330px] rounded-2xl sm:rounded-3xl bg-black/50 backdrop-blur-2xl border border-white/25 shadow-2xl p-4 sm:p-5 flex flex-col justify-between overflow-hidden shrink-0 mt-auto mb-3 sm:my-0">
            <div className="flex items-center justify-between gap-2 border-b border-white/15 pb-2 shrink-0" dir={isHe ? 'rtl' : 'ltr'}>
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Mic2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>{isHe ? 'מצב קריוקי חי' : 'Live Karaoke'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {((whisperSegmentsHe && whisperSegmentsHe.length > 0) ||
                  (whisperSegmentsEn && whisperSegmentsEn.length > 0)) && (
                  <div className="inline-flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setSubtitleLang('he')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${subtitleLang === 'he' ? 'bg-white text-black' : 'text-white/75'}`}
                    >
                      עב
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubtitleLang('en')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${subtitleLang === 'en' ? 'bg-white text-black' : 'text-white/75'}`}
                    >
                      EN
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleToggleKaraokeMode}
                  className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-white text-[10px] font-bold cursor-pointer transition-colors"
                >
                  {isHe ? 'סגור' : 'Off'}
                </button>
              </div>
            </div>

            {syncedLyrics.lines.length > 0 ? (() => {
              const nextLineIdx = syncedLyrics.lines.findIndex((l) => l.startTime > subtitleSyncTime);
              const anchorIdx =
                activeLineIndex >= 0
                  ? activeLineIndex
                  : nextLineIdx >= 0
                    ? nextLineIdx
                    : syncedLyrics.lines.length - 1;
              const visibleIndices = [anchorIdx - 1, anchorIdx, anchorIdx + 1, anchorIdx + 2].filter(
                (i) => i >= 0 && i < syncedLyrics.lines.length
              );
              return (
                <div className="flex-1 flex flex-col justify-center gap-2.5 overflow-hidden py-1">
                  {visibleIndices.map((idx) => {
                    const line = syncedLyrics.lines[idx];
                    const isCurr = idx === anchorIdx && activeLineIndex >= 0;
                    const lineRtl = isRtlSubtitleText(line.text, subtitleLang);
                    return (
                      <div
                        key={line.id}
                        dir={lineRtl ? 'rtl' : 'ltr'}
                        onClick={() => {
                          if (audioRef.current) {
                            const effDur = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
                            audioRef.current.currentTime = line.startTime;
                            syncProgressDomImmediate(line.startTime, effDur, true);
                            syncMediaSessionPosition(line.startTime, effDur);
                            setCurrentTime(line.startTime);
                          }
                        }}
                        className={`cursor-pointer text-center px-2 py-1 rounded-xl transition-all duration-150 ${
                          isCurr
                            ? 'bg-white/12 scale-[1.03] opacity-100'
                            : idx < anchorIdx
                              ? 'opacity-40 text-xs sm:text-sm'
                              : 'opacity-65 text-xs sm:text-sm hover:opacity-90'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-center gap-1.5 leading-snug">
                          {line.words.map((w, wIdx) => {
                            const wordActive = isCurr && subtitleSyncTime >= w.startTime && subtitleSyncTime <= w.endTime;
                            return (
                              <span
                                key={wIdx}
                                className={
                                  wordActive
                                    ? 'bg-white text-black font-black px-2 py-0.5 rounded-lg text-sm sm:text-base shadow-md'
                                    : isCurr
                                      ? 'text-white font-extrabold text-sm sm:text-base'
                                      : 'text-white/90 font-semibold'
                                }
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
              );
            })() : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-4 space-y-2">
                <Mic2 className="w-8 h-8 text-white/40" />
                <p className="text-xs sm:text-sm font-semibold text-white/80">
                  {isHe ? 'שירת הזמר מוסרת כעת במצב קריוקי' : 'Lead vocals removed in Karaoke Mode'}
                </p>
                <p className="text-[11px] text-white/55">
                  {isHe ? 'לשיר זה טרם נשמרו מילים מסונכרנות' : 'No synced lyrics saved for this song yet'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div
            className="w-40 h-40 sm:w-52 sm:h-52 md:w-56 md:h-56 max-h-[33dvh] max-w-[33dvh] aspect-square rounded-2xl sm:rounded-3xl p-2 bg-white/10 backdrop-blur-2xl border border-white/25 shadow-2xl flex items-center justify-center relative overflow-hidden group flex-shrink-0 mt-auto mb-3 sm:my-0"
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
        )}

        {/* BOTTOM PLAYER CONTROLS CLUSTER (Mobile: Song Title & Artist sit ABOVE Progress Bar; Desktop keeps original order) */}
        <div className="w-full mt-auto sm:mt-0 flex flex-col items-center gap-2.5 sm:gap-4 shrink-0">

        {/* 1 on Mobile / 3 on Desktop: SONG NAME & ARTIST NAME */}
        <div className="order-1 sm:order-3 text-center space-y-1 px-2 w-full pb-0.5 sm:pb-1 overflow-hidden flex flex-col items-center">
          <div className="w-full flex justify-center">
            <ScrollingSongTitle title={track.name} />
          </div>

          <div>
            <button
              type="button"
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

        {/* 2 on Mobile / 1 on Desktop: PROGRESS BAR */}
        <div className="order-2 sm:order-1 w-[88%] sm:w-full mx-auto space-y-1.5 px-1 sm:px-2">
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
            <div className="w-full h-2 group-hover:h-2.5 rounded-full bg-white/20 relative shadow-inner">
              <div className="w-full h-full rounded-full overflow-hidden">
                <div
                  ref={progressFillRef}
                  className="w-full h-full bg-white rounded-full will-change-transform"
                  style={{ transform: 'translate3d(-100%, 0, 0)' }}
                />
              </div>
              <div
                ref={progressThumbRef}
                className="w-4 h-4 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9),0_2px_4px_rgba(0,0,0,0.5)] absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group-hover:scale-125 transition-transform duration-100 ring-2 ring-black/10 will-change-[left]"
                style={{ left: '0%' }}
              />
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

        {/* 3 on Mobile / 2 on Desktop: PLAY BUTTON & CONTROLS ROW */}
        <div dir="ltr" className="order-3 sm:order-2 flex items-center justify-center gap-3 sm:gap-4 pt-0.5">
          <button
            type="button"
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
            type="button"
            onClick={() => seekRelative(-10)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
            aria-label={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
          >
            <SkipBack10Icon className="w-5.5 h-5.5 sm:w-6 sm:h-6" />
          </button>

          <motion.button
            type="button"
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
            type="button"
            onClick={() => seekRelative(10)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
            aria-label={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
          >
            <SkipForward10Icon className="w-5.5 h-5.5 sm:w-6 sm:h-6" />
          </button>

          <button
            type="button"
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

        {/* 4. MORE TOOLS TAB BUTTON ("כלים נוספים" - Speed, Sleep Timer, Karaoke, Bluetooth, Sound) */}
        <div className="order-4 w-full flex flex-col items-center gap-2 pt-0.5 pb-1">
          <button
            type="button"
            onClick={() => setIsMoreToolsOpen(true)}
            className="px-4 py-1.5 rounded-full bg-white/12 hover:bg-white/22 border border-white/25 backdrop-blur-xl text-xs font-bold text-white inline-flex items-center gap-2 shadow-lg transition-all cursor-pointer active:scale-95"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-white" />
            <span>{isHe ? 'כלים נוספים' : 'More Tools'}</span>
            {playbackRate !== 1 && (
              <span className="px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-mono tabular-nums">
                {playbackRate}x
              </span>
            )}
            {isKaraokeMode && (
              <Mic2 className="w-3.5 h-3.5 text-emerald-300" />
            )}
            {(sleepRemainingSec !== null || sleepStopAtTrackEnd) && (
              <span className="px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-mono tabular-nums">
                {sleepStopAtTrackEnd ? (isHe ? 'סוף שיר' : 'Track End') : formatClockTime(sleepRemainingSec || 0)}
              </span>
            )}
            {bluetoothDeviceInfo?.connected && (
              <Bluetooth className="w-3.5 h-3.5 text-sky-300" />
            )}
          </button>

          {sleepEndedBanner && (
            <div className="w-full max-w-sm px-3.5 py-2 rounded-2xl bg-black/70 border border-white/25 backdrop-blur-xl flex items-center justify-between gap-2 shadow-xl text-xs">
              <span className="font-semibold text-white">
                {isHe ? 'טיימר השינה הסתיים — הניגון נעצר' : 'Sleep timer finished — playback paused'}
              </span>
              <button
                type="button"
                onClick={() => setSleepEndedBanner(false)}
                className="p-1 rounded-full hover:bg-white/15 text-white/80 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        </div>

        {/* DESKTOP ONLY FLOATING SCROLL BUTTON TO SCREEN 2 (Hidden on mobile so initial player screen has no arrow) */}
        <button
          type="button"
          onClick={() => {
            if (playerScrollRef.current) {
              playerScrollRef.current.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' });
            }
          }}
          className="hidden sm:flex absolute bottom-3.5 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-xl items-center justify-center text-white/75 hover:text-white transition-colors cursor-pointer"
          title={isHe ? 'גלול למטה לכתוביות ופרטים' : 'Scroll down for subtitles & details'}
          aria-label={isHe ? 'גלול למטה לכתוביות ופרטים' : 'Scroll down for subtitles & details'}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* SCREEN 2: SUBTITLES CARD FIRST + TRACK DETAILS & SHARE (STRICTLY BELOW THE FOLD UNTIL SCROLLED) */}
      <div className="relative max-w-xl mx-auto w-full px-4 pt-6 pb-24 space-y-5 shrink-0">
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
            {isLyricsExpanded && (
              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="max-h-72 sm:max-h-80 overflow-y-auto pe-2 space-y-2.5 select-none custom-scrollbar scroll-smooth">
                  {syncedLyrics.lines.map((line, lIdx) => {
                    const isLineActive = lIdx === activeLineIndex;
                    const mm = Math.floor(line.startTime / 60);
                    const ss = Math.floor(line.startTime % 60).toString().padStart(2, '0');
                    const lineIsRtl = isRtlSubtitleText(line.text, subtitleLang);

                    return (
                      <div
                        key={line.id}
                        ref={isLineActive ? activeLyricsLineRef : undefined}
                        dir={lineIsRtl ? 'rtl' : 'ltr'}
                        onClick={() => {
                          if (audioRef.current) {
                            const effectiveDur = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
                            audioRef.current.currentTime = line.startTime;
                            syncProgressDomImmediate(line.startTime, effectiveDur, true);
                            syncMediaSessionPosition(line.startTime, effectiveDur);
                            setCurrentTime(line.startTime);
                          }
                        }}
                        className={`p-2.5 rounded-2xl transition-colors cursor-pointer flex items-start gap-2.5 leading-relaxed ${
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
                            const isWordActive = isLineActive && subtitleSyncTime >= w.startTime && subtitleSyncTime <= w.endTime;

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
              </div>
            )}
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

      {/* MORE TOOLS DRAWER / TAB ("כלים נוספים": טיימר שינה, בלוטוס ורמקולים, שמע ומהירות) */}
      <AnimatePresence>
        {isMoreToolsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMoreToolsOpen(false)}
            className="fixed inset-0 z-[155] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-3 sm:p-4"
            dir={isHe ? 'rtl' : 'ltr'}
          >
            <motion.div
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[88dvh] overflow-y-auto custom-scrollbar rounded-3xl bg-[#09090b] border border-white/20 p-5 sm:p-6 shadow-2xl space-y-5 text-white text-start"
            >
              {/* HEADER */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center">
                    <SlidersHorizontal className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      {isHe ? 'כלים נוספים' : 'More Tools'}
                    </h3>
                    <p className="text-[11px] text-white/55">
                      {isHe ? 'מצב קריוקי AI, טיימר שינה, Bluetooth והגדרות שמע' : 'AI Karaoke, Sleep Timer, Bluetooth & Audio Controls'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMoreToolsOpen(false)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
                  aria-label={isHe ? 'סגור' : 'Close'}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* QUICK PLAYBACK SPEED BAR IN "כלים נוספים" (Syncs Audio & Subtitles to Chosen Speed) */}
              <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/12 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setMoreToolsTab('audio')}
                    className="font-bold text-white flex items-center gap-2 cursor-pointer hover:text-white/80"
                  >
                    <Gauge className="w-4 h-4 text-white" />
                    <span>{isHe ? 'מהירות השמעה (מסונכרן לכתוביות)' : 'Playback Speed (Synced to Subtitles)'}</span>
                  </button>
                  <span className="font-mono text-xs font-bold text-black bg-white px-2 py-0.5 rounded-full">
                    {playbackRate}x
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1.5" dir="ltr">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setPlaybackRate(rate)}
                      className={`py-1.5 rounded-xl text-[11px] font-mono border transition-all cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-white text-black border-white font-bold shadow'
                          : 'bg-white/[0.05] text-white/80 border-white/10 hover:bg-white/15'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              {/* TABS INSIDE "כלים נוספים" */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-2xl bg-white/[0.05] border border-white/10 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setMoreToolsTab('karaoke')}
                  className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    moreToolsTab === 'karaoke' ? 'bg-white text-black shadow' : 'text-white/75 hover:text-white'
                  }`}
                >
                  <Mic2 className="w-3.5 h-3.5" />
                  <span>{isHe ? 'מצב קריוקי' : 'Karaoke'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMoreToolsTab('sleep')}
                  className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    moreToolsTab === 'sleep' ? 'bg-white text-black shadow' : 'text-white/75 hover:text-white'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>{isHe ? 'טיימר שינה' : 'Sleep Timer'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreToolsTab('bluetooth');
                    refreshAudioOutputs();
                  }}
                  className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    moreToolsTab === 'bluetooth' ? 'bg-white text-black shadow' : 'text-white/75 hover:text-white'
                  }`}
                >
                  <Bluetooth className="w-3.5 h-3.5" />
                  <span>{isHe ? 'בלוטוס ושמע' : 'Bluetooth'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMoreToolsTab('audio')}
                  className={`py-2 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    moreToolsTab === 'audio' ? 'bg-white text-black shadow' : 'text-white/75 hover:text-white'
                  }`}
                >
                  <Gauge className="w-3.5 h-3.5" />
                  <span>{isHe ? 'מהירות ועוצמה' : 'Sound & Speed'}</span>
                </button>
              </div>

              {/* TAB 0: PUBLISHER-CONTROLLED KARAOKE MODE */}
              {moreToolsTab === 'karaoke' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-white/[0.06] border border-white/15 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Mic2 className={`w-4 h-4 ${hasPublisherKaraoke ? 'text-emerald-300' : 'text-white/40'}`} />
                          <span>{isHe ? 'מצב קריוקי (מנגינה ללא זמר)' : 'Karaoke Mode (Instrumental)'}</span>
                        </h4>
                        <p className="text-[11px] text-white/65 leading-relaxed">
                          {hasPublisherKaraoke
                            ? (isHe
                                ? 'מוציא את שירת הזמר ומשאיר את המנגינה בלבד, ומציג את המילים המסונכרנות במקום תמונת השיר.'
                                : 'Removes lead vocals leaving only the instrumental backing track, with live synced lyrics.')
                            : (isHe
                                ? 'מפרסם השיר לא הפעיל עדיין מצב קריוקי לשיר זה. יוצר השיר יכול להפעיל וליצור קריוקי בעריכת השיר בפרופיל.'
                                : 'The track publisher has not enabled or generated Karaoke Mode for this release yet.')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!hasPublisherKaraoke}
                        onClick={handleToggleKaraokeMode}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                          isKaraokeMode && hasPublisherKaraoke
                            ? 'bg-emerald-400 text-black hover:bg-emerald-300'
                            : 'bg-white text-black hover:bg-neutral-200'
                        }`}
                      >
                        {isKaraokeMode && hasPublisherKaraoke
                          ? (isHe ? 'כבה קריוקי' : 'Turn Off')
                          : (isHe ? 'הפעל קריוקי' : 'Turn On')}
                      </button>
                    </div>

                    <div className="pt-2 border-t border-white/10 text-[11px] text-white/70 flex items-center justify-between gap-2">
                      <span>
                        {!hasPublisherKaraoke
                          ? (isHe ? 'מצב קריוקי מנוהל על ידי חשבון מפרסם השיר' : 'Publisher-controlled karaoke')
                          : pregeneratedKaraokeUrl
                            ? (isHe ? 'פסקול קריוקי אינסטרומנטלי מוכן ושמור בענן' : 'Publisher karaoke instrumental ready in cloud')
                            : (isHe ? 'הפרדת זמר פעילה לשיר זה' : 'Vocal removal enabled by publisher')}
                      </span>
                      <span className={`font-bold ${isKaraokeMode && hasPublisherKaraoke ? 'text-emerald-300' : 'text-white/50'}`}>
                        {!hasPublisherKaraoke
                          ? (isHe ? 'לא הופעל' : 'Unavailable')
                          : isKaraokeMode
                            ? (isHe ? 'פעיל' : 'Active')
                            : (isHe ? 'מוכן' : 'Ready')}
                      </span>
                    </div>
                  </div>

                  {hasPublisherKaraoke &&
                    ((whisperSegmentsHe && whisperSegmentsHe.length > 0) ||
                      (whisperSegmentsEn && whisperSegmentsEn.length > 0) ||
                      (whisperSegmentsOrig && whisperSegmentsOrig.length > 0)) && (
                    <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2">
                      <span className="text-xs font-semibold text-white/80 block">
                        {isHe ? 'שפת מילות הקריוקי על המסך:' : 'Karaoke Lyrics Language:'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSubtitleLang('he')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-colors ${
                            subtitleLang === 'he' ? 'bg-white text-black border-white' : 'bg-white/5 text-white/75 border-white/10'
                          }`}
                        >
                          עברית
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubtitleLang('en')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-colors ${
                            subtitleLang === 'en' ? 'bg-white text-black border-white' : 'bg-white/5 text-white/75 border-white/10'
                          }`}
                        >
                          English
                        </button>
                        {whisperSegmentsOrig && whisperSegmentsOrig.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSubtitleLang('orig')}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer border transition-colors ${
                              subtitleLang === 'orig' ? 'bg-white text-black border-white' : 'bg-white/5 text-white/75 border-white/10'
                            }`}
                          >
                            {detectedLangLabel || (isHe ? 'שפת המקור' : 'Original')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 1: SLEEP TIMER */}
              {moreToolsTab === 'sleep' && (
                <div className="space-y-4">
                  {(sleepRemainingSec !== null || sleepStopAtTrackEnd) && (
                    <div className="p-3.5 rounded-2xl bg-white/10 border border-white/25 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Moon className="w-4 h-4 text-white" />
                        <div className="text-xs">
                          <div className="font-bold text-white">
                            {sleepStopAtTrackEnd
                              ? isHe ? 'השיר ייעצר בסיום השיר הנוכחי' : 'Stops at end of track'
                              : isHe
                                ? `זמן שנותר לכיבוי: ${formatClockTime(sleepRemainingSec || 0)}`
                                : `Remaining: ${formatClockTime(sleepRemainingSec || 0)}`}
                          </div>
                          <div className="text-[11px] text-white/60">
                            {isHe ? 'הניגון ייעצר בהדרגה עם תום הטיימר' : 'Music fades out cleanly when finished'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={cancelSleepTimer}
                        className="px-3 py-1.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-neutral-200 transition-colors cursor-pointer shrink-0"
                      >
                        {isHe ? 'בטל' : 'Cancel'}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    {[5, 10, 15, 30, 45, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => startSleepTimerMinutes(mins)}
                        className="py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/15 text-xs font-semibold text-white transition-all cursor-pointer"
                      >
                        {isHe ? `${mins} דקות` : `${mins} min`}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSleepEndTimestamp(null);
                      setSleepRemainingSec(null);
                      setSleepEndedBanner(false);
                      setSleepBlackoutOverlay(false);
                      setSleepStopAtTrackEnd(true);
                    }}
                    className={`w-full py-2.5 px-4 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                      sleepStopAtTrackEnd
                        ? 'bg-white text-black border-white'
                        : 'bg-white/[0.06] hover:bg-white/[0.14] border-white/15 text-white'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                    <span>{isHe ? 'עצור אוטומטית בסיום השיר הנוכחי' : 'Stop at end of current song'}</span>
                  </button>

                  {/* Custom Minutes */}
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={customSleepMinutes}
                      onChange={(e) => setCustomSleepMinutes(e.target.value)}
                      className="w-24 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white text-center focus:outline-none focus:border-white/50"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => startSleepTimerMinutes(Number(customSleepMinutes) || 15)}
                      className="flex-1 py-2 px-4 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs font-bold transition-colors cursor-pointer"
                    >
                      {isHe ? 'הפעל טיימר מותאם אישית (דקות)' : 'Start Custom Timer (min)'}
                    </button>
                  </div>

                  {/* Action when Timer Ends */}
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2">
                    <p className="text-[11px] font-semibold text-white/80">
                      {isHe ? 'פעולה בסיום הטיימר:' : 'When timer ends:'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSleepFinishAction('keep-open')}
                        className={`p-2.5 rounded-xl border text-xs text-start transition-all cursor-pointer ${
                          sleepFinishAction === 'keep-open'
                            ? 'bg-white text-black border-white'
                            : 'bg-white/[0.04] text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="font-bold">
                          {isHe ? 'עצור שיר והשאר פתוח (מומלץ)' : 'Stop & Keep App Ready'}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${sleepFinishAction === 'keep-open' ? 'text-black/75' : 'text-white/55'}`}>
                          {isHe ? 'השיר נעצר, ההתראה נסגרת, והמכשיר נרדם — וכשקמים האפליקציה מחכה פתוחה.' : 'Stops music cleanly so your device sleeps and app stays ready.'}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSleepFinishAction('sleep-screen')}
                        className={`p-2.5 rounded-xl border text-xs text-start transition-all cursor-pointer ${
                          sleepFinishAction === 'sleep-screen'
                            ? 'bg-white text-black border-white'
                            : 'bg-white/[0.04] text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="font-bold">
                          {isHe ? 'עצור + סגירה / מסך שינה מוחשך' : 'Stop + Close / Blackout'}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${sleepFinishAction === 'sleep-screen' ? 'text-black/75' : 'text-white/55'}`}>
                          {isHe ? 'מנקה התראה ומחשיך את המסך או סוגר חלון במצב אפליקציה.' : 'Dims screen or closes standalone window when supported.'}
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: BLUETOOTH & AUDIO OUTPUT */}
              {moreToolsTab === 'bluetooth' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={handleScanBluetoothDevice}
                      disabled={isScanningBluetooth}
                      className="py-3 px-4 rounded-2xl bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Bluetooth className="w-4 h-4" />
                      <span>
                        {isScanningBluetooth
                          ? isHe ? 'מחפש התקנים...' : 'Scanning...'
                          : isHe ? 'חבר התקן Bluetooth (אוזניות / רמקול)' : 'Connect Bluetooth'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSelectAudioOutputPicker}
                      className="py-3 px-4 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Speaker className="w-4 h-4" />
                      <span>{isHe ? 'בחר פלט רמקול / אוזניות' : 'Select Audio Output'}</span>
                    </button>
                  </div>

                  {bluetoothDeviceInfo && (
                    <div className="p-3.5 rounded-2xl bg-white/[0.07] border border-white/20 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Headphones className="w-5 h-5 text-white" />
                        <div className="text-xs">
                          <div className="font-bold text-white">{bluetoothDeviceInfo.name}</div>
                          <div className="text-[11px] text-white/65">
                            {typeof bluetoothDeviceInfo.batteryPercent === 'number'
                              ? isHe
                                ? `מחובר • סוללה ${bluetoothDeviceInfo.batteryPercent}%`
                                : `Connected • Battery ${bluetoothDeviceInfo.batteryPercent}%`
                              : isHe ? 'התקן Bluetooth פעיל' : 'Bluetooth Device Connected'}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            bluetoothServerRef.current?.disconnect();
                          } catch {}
                          bluetoothServerRef.current = null;
                          setBluetoothDeviceInfo(null);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs text-white cursor-pointer"
                      >
                        {isHe ? 'נתק' : 'Disconnect'}
                      </button>
                    </div>
                  )}

                  {audioOutputMessage && (
                    <div className="p-3 rounded-xl bg-white/[0.06] border border-white/15 text-xs text-white/85 leading-relaxed">
                      {audioOutputMessage}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white/75">
                        {isHe ? 'התקני שמע מזוהים במכשיר:' : 'Detected Audio Outputs:'}
                      </span>
                      <button
                        type="button"
                        onClick={refreshAudioOutputs}
                        className="text-[11px] text-white/70 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{isHe ? 'רענן' : 'Refresh'}</span>
                      </button>
                    </div>

                    {audioOutputs.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                        {audioOutputs.map((dev, i) => {
                          const isSelected = selectedSinkId === dev.deviceId || (!selectedSinkId && dev.deviceId === 'default');
                          const label = dev.label || (isHe ? `פלט שמע ${i + 1}` : `Audio Output ${i + 1}`);
                          return (
                            <button
                              key={dev.deviceId || i}
                              type="button"
                              onClick={() => handleSetSinkId(dev.deviceId, label)}
                              className={`w-full px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                isSelected
                                  ? 'bg-white text-black border-white font-bold'
                                  : 'bg-white/[0.04] hover:bg-white/[0.1] border-white/10 text-white'
                              }`}
                            >
                              <span className="truncate">{label}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-white/55 leading-relaxed bg-white/[0.03] p-3 rounded-xl border border-white/10">
                        {isHe
                          ? 'חיבור אוזניות ורמקולי Bluetooth פועל מיידית גם דרך הגדרות השמע של המכשיר או וילון פלט המדיה.'
                          : 'Connect Bluetooth headphones or speakers via your device Bluetooth / Media Output settings and audio switches seamlessly.'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: PLAYBACK SPEED & VOLUME */}
              {moreToolsTab === 'audio' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white flex items-center gap-2">
                        {isMuted || volumeLevel === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        <span>{isHe ? 'עוצמת שמע' : 'Volume'}</span>
                      </span>
                      <span className="font-mono text-white/80">
                        {isMuted ? '0%' : `${Math.round(volumeLevel * 100)}%`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsMuted((prev) => !prev)}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-white cursor-pointer"
                      >
                        {isMuted ? (isHe ? 'בטל השתקה' : 'Unmute') : (isHe ? 'השתק' : 'Mute')}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        dir="ltr"
                        value={isMuted ? 0 : volumeLevel}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setVolumeLevel(v);
                          if (v > 0 && isMuted) setIsMuted(false);
                        }}
                        className="flex-1 accent-white cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-white flex items-center gap-2">
                        <Gauge className="w-4 h-4" />
                        <span>{isHe ? 'מהירות ניגון' : 'Playback Speed'}</span>
                      </span>
                      <span className="font-mono text-white/80">{playbackRate}x</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                      {[0.75, 0.9, 1, 1.15, 1.25, 1.5].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => setPlaybackRate(rate)}
                          className={`py-2 rounded-xl text-xs font-mono border transition-all cursor-pointer ${
                            playbackRate === rate
                              ? 'bg-white text-black border-white font-bold'
                              : 'bg-white/[0.05] text-white/80 border-white/10 hover:bg-white/15'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DARK SLEEP MODE SCREEN OVERLAY (when "מסך שינה מוחשך" option was chosen) */}
      {sleepBlackoutOverlay && (
        <div
          onClick={() => {
            setSleepBlackoutOverlay(false);
            setSleepEndedBanner(false);
          }}
          className="fixed inset-0 z-[250] bg-black flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none"
          dir={isHe ? 'rtl' : 'ltr'}
        >
          <Moon className="w-10 h-10 text-white/35 mb-4" />
          <p className="text-sm font-semibold text-white/60">
            {isHe ? 'טיימר השינה הסתיים • הנגינה נעצרה' : 'Sleep timer ended • Music stopped'}
          </p>
          <p className="text-xs text-white/35 mt-2">
            {isHe ? 'לחץ בכל מקום על המסך כדי לחזור לאפליקציה' : 'Tap anywhere to return to the player'}
          </p>
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
