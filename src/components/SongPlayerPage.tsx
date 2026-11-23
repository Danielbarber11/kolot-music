import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Heart,
  ArrowRight,
  ArrowLeft,
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
  Disc,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, SubtitleSegment, Album } from '../types';
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
import {
  getStreamingMediaUrl,
  updateTrackColorInCloud,
  incrementTrackPlaysInCloud,
  fetchSingleTrackFromCloud,
  isTrackViewIncrementPending,
  waitForPendingTrackViewIncrement,
} from '../services/cloudStorageService';
import { trackEvent } from '../services/analyticsService';
import {
  getCachedArtistProfiles,
  fetchAllArtistProfiles,
  upsertMemoryArtistProfile,
  removeMemoryArtistProfile,
  updateMemoryTracksArtistAvatar,
  syncTrackSubtitlesInMemory,
  syncTrackViewFromServer,
} from '../services/multiMusicService';
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
      <h1 className="text-[22px] sm:text-2xl font-black text-white tracking-tight drop-shadow truncate text-center">
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
        <span className="text-[22px] sm:text-2xl font-black text-white tracking-tight drop-shadow px-3">
          {title}
        </span>
        <span className="text-white/60 opacity-70 px-2 font-bold">•</span>
        <span className="text-[22px] sm:text-2xl font-black text-white tracking-tight drop-shadow px-3">
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
  allAlbums?: Album[];
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
  allAlbums = [],
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
  const wakeLockRef = useRef<any>(null);
  const lyricsScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLyricsLineRef = useRef<HTMLDivElement | null>(null);
  const albumQueueScrollRef = useRef<HTMLDivElement | null>(null);
  const currentAlbumRowRef = useRef<HTMLButtonElement | null>(null);
  const pausedResumeTimeRef = useRef<number | null>(null);
  const pendingRestoreTimeRef = useRef<number | null>(null);
  const isSwitchingTrackRef = useRef<boolean>(false);
  const [isAppHidden, setIsAppHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false
  );
  const [isArtistProfileOpen, setIsArtistProfileOpen] = useState(false);
  const [isArtistPortalOpen, setIsArtistPortalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loadedArtists, setLoadedArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());
  const effectiveArtists = allArtists.length > 0 ? allArtists : loadedArtists;

  const albumQueueData = React.useMemo(() => {
    const invalidAlbumNames = new Set([
      '',
      'single',
      'single release',
      'unknown album',
      'סינגל',
      'סינגל עצמאי',
      'ללא אלבום',
      'independent single',
      'none',
    ]);
    const cleanAlbumName = (track.albumName || '').trim();
    const lowerAlbum = cleanAlbumName.toLowerCase();
    const hasRealAlbumName =
      Boolean(cleanAlbumName) &&
      !invalidAlbumNames.has(lowerAlbum) &&
      !lowerAlbum.startsWith('סינגל') &&
      !lowerAlbum.startsWith('single');

    const matchedAlbum = (allAlbums || []).find((alb) => {
      if (Array.isArray(alb.trackIds) && alb.trackIds.includes(track.id)) return true;
      if (!hasRealAlbumName) return false;
      const albTitleLower = (alb.title || '').trim().toLowerCase();
      if (albTitleLower !== lowerAlbum) return false;
      const albArtistLower = (alb.artistName || '').trim().toLowerCase();
      const trkArtistLower = (track.artistName || '').trim().toLowerCase();
      return (
        !albArtistLower ||
        !trkArtistLower ||
        albArtistLower === trkArtistLower ||
        (alb.uploadedByUid && alb.uploadedByUid === track.uploadedByUid)
      );
    });

    const queueMap = new Map<string, JamendoTrack>();
    const tracksById = new Map<string, JamendoTrack>();
    (allTracks || []).forEach((t) => {
      if (t?.id) tracksById.set(t.id, t);
    });
    tracksById.set(track.id, track);

    if (matchedAlbum && Array.isArray(matchedAlbum.trackIds)) {
      matchedAlbum.trackIds.forEach((id) => {
        const found = tracksById.get(id);
        if (found && !queueMap.has(found.id)) {
          queueMap.set(found.id, found);
        }
      });
    }

    if (hasRealAlbumName) {
      const trkOwner = (track.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
      const trkArtist = (track.artistName || '').trim().toLowerCase();
      (allTracks || []).forEach((candidate) => {
        if (!candidate?.id || queueMap.has(candidate.id)) return;
        const candAlb = (candidate.albumName || '').trim().toLowerCase();
        if (candAlb !== lowerAlbum) return;
        const candOwner = (candidate.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
        const candArtist = (candidate.artistName || '').trim().toLowerCase();
        if (
          (trkOwner && candOwner && trkOwner === candOwner) ||
          (trkArtist && candArtist && trkArtist === candArtist)
        ) {
          queueMap.set(candidate.id, candidate);
        }
      });
      if (!queueMap.has(track.id)) {
        queueMap.set(track.id, track);
      }
    }

    const orderedTracks = Array.from(queueMap.values());
    const currentIndex = orderedTracks.findIndex((t) => t.id === track.id);
    const displayAlbumTitle = matchedAlbum?.title || (hasRealAlbumName ? cleanAlbumName : '');

    return {
      orderedTracks,
      currentIndex,
      displayAlbumTitle,
      hasAlbumQueue: orderedTracks.length > 1 && Boolean(displayAlbumTitle),
    };
  }, [track, allTracks, allAlbums]);

  useEffect(() => {
    if (!albumQueueData.hasAlbumQueue || albumQueueData.currentIndex < 0) return;
    const rafId = requestAnimationFrame(() => {
      const container = albumQueueScrollRef.current;
      const rowEl = currentAlbumRowRef.current;
      if (!container || !rowEl) return;
      try {
        const containerRect = container.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const targetTop = Math.max(0, rowRect.top - containerRect.top + container.scrollTop);
        container.scrollTop = targetTop;
      } catch {}
    });
    return () => cancelAnimationFrame(rafId);
  }, [track.id, albumQueueData.hasAlbumQueue, albumQueueData.currentIndex]);

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
      .then(async (freshTrack) => {
        if (cancelled || !freshTrack || freshTrack.id !== track.id) return;
        syncTrackSubtitlesInMemory(freshTrack);
        applyFreshTrackSubs(freshTrack);
        if (isTrackViewIncrementPending(track.id)) {
          await waitForPendingTrackViewIncrement(track.id);
        } else if (typeof freshTrack.viewsCount === 'number') {
          syncTrackViewFromServer(track.id, Number(freshTrack.viewsCount), true);
        }
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

  const syncedLyrics = React.useMemo(
    () => generateSynchronizedLyrics(effectiveTrackForLyrics, activeSegments, subtitleLang),
    [effectiveTrackForLyrics, activeSegments, subtitleLang]
  );

  // Lookahead so highlighted phrase switches immediately as the singer finishes each line
  const subtitleSyncTime = Math.min(
    duration > 0 ? duration : 9999,
    Math.max(0, currentTime + 0.06)
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

  // Upcoming line gets a clean rounded outline while waiting during instrumental/silence gaps
  const upcomingLineIndex = React.useMemo(() => {
    if (activeLineIndex >= 0 || !syncedLyrics.lines.length) return -1;
    return syncedLyrics.lines.findIndex((l) => l.startTime > subtitleSyncTime);
  }, [activeLineIndex, syncedLyrics.lines, subtitleSyncTime]);

  const targetLyricsLineIndex = activeLineIndex >= 0 ? activeLineIndex : upcomingLineIndex;

  useEffect(() => {
    if (!isLyricsExpanded || targetLyricsLineIndex < 0) return;
    const rafId = requestAnimationFrame(() => {
      const container = lyricsScrollContainerRef.current;
      const targetEl = activeLyricsLineRef.current;
      if (!container || !targetEl) return;
      try {
        const containerRect = container.getBoundingClientRect();
        const elRect = targetEl.getBoundingClientRect();
        const elTopWithinScroll = elRect.top - containerRect.top + container.scrollTop;
        const idealCenterTop = elTopWithinScroll - container.clientHeight / 2 + elRect.height / 2;
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
        const clampedTop = Math.max(0, Math.min(maxTop, idealCenterTop));
        container.scrollTo({ top: clampedTop, behavior: 'smooth' });
      } catch {}
    });
    return () => cancelAnimationFrame(rafId);
  }, [targetLyricsLineIndex, isLyricsExpanded]);

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

  // Keep screen awake automatically whenever SongPlayerPage is open
  useEffect(() => {
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
      if (document.visibilityState === 'visible') {
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
  }, []);

  const effectiveAudioUrl = getStreamingMediaUrl(track.audioUrl);
  const effectiveCoverUrl = getStreamingMediaUrl(track.coverUrl);
  const shouldUseAnonymousCors =
    effectiveAudioUrl.startsWith('/') || effectiveAudioUrl.includes('/api/storage/');

  // Dynamic matching color extracted from track cover, saved bgColor hint, or genre (zero snap on mount)
  const extractedColor = useExtractedColor(effectiveCoverUrl, track.genre || 'Pop', track.bgColor);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncVisibilityAndMediaSession = () => {
      const hidden = document.visibilityState === 'hidden';
      const audio = audioRef.current;

      if (!hidden) {
        clearMediaSessionUiOnly();
        setIsAppHidden(false);
        // If src was detached while paused in the background, restore it silently at the saved timestamp
        if (audio && effectiveAudioUrl && !audio.getAttribute('src')) {
          const resumeAt = pausedResumeTimeRef.current ?? 0;
          pausedResumeTimeRef.current = null;
          pendingRestoreTimeRef.current = resumeAt;
          audio.src = effectiveAudioUrl;
          audio.load();
          syncProgressDomImmediate(resumeAt, duration, true);
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

    const handleWindowFocus = () => {
      if (document.visibilityState === 'visible') {
        clearMediaSessionUiOnly();
        setIsAppHidden(false);
      }
    };

    document.addEventListener('visibilitychange', syncVisibilityAndMediaSession);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibilityAndMediaSession);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [effectiveAudioUrl, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !effectiveAudioUrl) return;
    const shouldAutoPlay = true;

    isSwitchingTrackRef.current = true;
    pausedResumeTimeRef.current = null;
    pendingRestoreTimeRef.current = null;

    if (audio.getAttribute('src') !== effectiveAudioUrl) {
      audio.src = effectiveAudioUrl;
    }
    audio.load();
    audio.playbackRate = 1;
    audio.volume = 1;
    audio.muted = false;

    const clearSwitchTimer = window.setTimeout(() => {
      isSwitchingTrackRef.current = false;
    }, 350);

    if (shouldAutoPlay) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            isSwitchingTrackRef.current = false;
            setIsPlaying(true);
          })
          .catch((err) => {
            isSwitchingTrackRef.current = false;
            console.warn('Playback notice:', err);
            setIsPlaying(false);
          });
      }
    } else {
      isSwitchingTrackRef.current = false;
      setIsPlaying(false);
    }

    return () => {
      window.clearTimeout(clearSwitchTimer);
    };
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
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying && !audio.paused) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (!audio.getAttribute('src') && effectiveAudioUrl) {
        pendingRestoreTimeRef.current = pausedResumeTimeRef.current;
        pausedResumeTimeRef.current = null;
        audio.src = effectiveAudioUrl;
        audio.load();
      }
      audio.muted = false;
      if (audio.volume <= 0) audio.volume = 1;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const clearMediaSessionUiOnly = () => {
    try {
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
      if (wakeLockRef.current && typeof wakeLockRef.current.release === 'function') {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

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
      const audio = audioRef.current;
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
      if (!audio || audio.paused || audio.ended || !audio.getAttribute('src')) return;
      if (
        typeof navigator !== 'undefined' &&
        'mediaSession' in navigator &&
        typeof navigator.mediaSession.setPositionState === 'function' &&
        Number.isFinite(durSec) &&
        durSec > 0
      ) {
        navigator.mediaSession.setPositionState({
          duration: durSec,
          playbackRate: 1,
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

  // Allow transparent / edge-to-edge top status bar inside player (restore #000000 on exit)
  useEffect(() => {
    const existingThemeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    const previousContent = existingThemeMeta?.getAttribute('content') || '#000000';
    if (existingThemeMeta && existingThemeMeta.parentNode) {
      existingThemeMeta.parentNode.removeChild(existingThemeMeta);
    }

    return () => {
      const currentMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (currentMeta) {
        currentMeta.setAttribute('content', previousContent);
      } else {
        const restored = document.createElement('meta');
        restored.name = 'theme-color';
        restored.content = previousContent;
        document.head.appendChild(restored);
      }
    };
  }, []);

  // Native Mobile / Samsung OS Media Notification Controls — active ONLY when outside the app AND audio is actively playing
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
      if (cancelled || document.visibilityState !== 'hidden') return;
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
        if (!audioRef.current?.getAttribute('src') && effectiveAudioUrl) {
          pendingRestoreTimeRef.current = pausedResumeTimeRef.current;
          pausedResumeTimeRef.current = null;
          audioRef.current!.src = effectiveAudioUrl;
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
    isAppHidden,
    isPlaying,
    track.id,
    track.name,
    track.artistName,
    track.albumName,
    effectiveCoverUrl,
    effectiveAudioUrl,
    allTracks.length,
    extractedColor.r,
    extractedColor.g,
    extractedColor.b,
  ]);

  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        const audio = audioRef.current;
        if (
          !isAppHidden ||
          !isPlaying ||
          !audio ||
          audio.paused ||
          audio.ended ||
          audio.muted ||
          audio.volume <= 0 ||
          !audio.getAttribute('src')
        ) {
          clearMediaSessionUiOnly();
          return;
        }
        navigator.mediaSession.playbackState = 'playing';
        const d =
          audio.duration && Number.isFinite(audio.duration)
            ? audio.duration
            : duration;
        syncMediaSessionPosition(audio.currentTime || currentTime || 0, d);
      }
    } catch {}
  }, [isPlaying, isAppHidden]);

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
      className="fixed inset-0 z-[100] w-full min-h-[100dvh] bg-[#09090b] overflow-hidden text-white flex flex-col m-0 p-0 border-0"
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
          if (pendingRestoreTimeRef.current !== null) {
            const restoreAt = Math.max(0, Math.min(dur, pendingRestoreTimeRef.current));
            pendingRestoreTimeRef.current = null;
            try {
              audio.currentTime = restoreAt;
            } catch {}
            syncProgressDomImmediate(restoreAt, dur, true);
            setCurrentTime(restoreAt);
            return;
          }
          syncProgressDomImmediate(audio.currentTime || 0, dur, true);
          syncMediaSessionPosition(audio.currentTime || 0, dur);
        }}
        onDurationChange={() => {
          if (audioRef.current?.duration && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
            syncProgressDomImmediate(audioRef.current.currentTime || 0, audioRef.current.duration, true);
            syncMediaSessionPosition(audioRef.current.currentTime || 0, audioRef.current.duration);
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
          isSwitchingTrackRef.current = false;
          pausedResumeTimeRef.current = null;
          smoothClockRef.current.isBuffering = false;
          smoothClockRef.current.lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
          setIsPlaying(true);
        }}
        onPlay={() => {
          isSwitchingTrackRef.current = false;
          pausedResumeTimeRef.current = null;
          setIsPlaying(true);
          smoothClockRef.current.isBuffering = false;
          smoothClockRef.current.lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
          if (audioRef.current) {
            const d = audioRef.current.duration && Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : duration;
            syncMediaSessionPosition(audioRef.current.currentTime || 0, d);
          }
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
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            pausedResumeTimeRef.current = 0;
            clearMediaSessionCompletely(audioRef.current, true);
          } else {
            clearMediaSessionUiOnly();
          }
        }}
      />

      {/* FLOATING TOP BAR - FROSTED GLASS BACK BUTTON */}
      <div className="absolute top-[max(0.875rem,calc(env(safe-area-inset-top)+0.4rem))] sm:top-5 left-0 right-0 z-50 px-5 sm:px-8 flex items-center justify-start pointer-events-none" dir={isHe ? 'rtl' : 'ltr'}>
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
        {/* SCREEN 1: SPOTIFY / YOUTUBE MUSIC PROPORTIONS ON MOBILE (FITS CLEANLY BEFORE SCROLLING) */}
        <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-between px-6 pt-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] pb-[max(2.25rem,calc(env(safe-area-inset-bottom)+1.5rem))] sm:justify-center sm:pt-14 sm:pb-12 gap-4 sm:gap-6 max-w-md mx-auto shrink-0">

        {/* 1. COVER ARTWORK IMAGE */}
        <div className="flex-1 w-full flex items-center justify-center py-1 sm:flex-none">
          <div
            className="w-[min(82vw,340px)] max-h-[42dvh] max-w-[42dvh] sm:w-64 sm:h-64 md:w-72 md:h-72 aspect-square rounded-2xl sm:rounded-3xl p-1.5 bg-white/10 backdrop-blur-2xl border border-white/25 shadow-2xl flex items-center justify-center relative overflow-hidden group flex-shrink-0"
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
        </div>

        {/* BOTTOM PLAYER CONTROLS CLUSTER (Mobile: Song Title above Progress Bar & full-width controls) */}
        <div className="w-full flex flex-col items-center gap-3.5 sm:gap-4 shrink-0">

        {/* 1 on Mobile / 3 on Desktop: SONG NAME */}
        <div className="order-1 sm:order-3 text-center space-y-1 px-2 w-full pb-0.5 sm:pb-1 overflow-hidden flex flex-col items-center">
          <div className="w-full flex justify-center">
            <ScrollingSongTitle title={track.name} />
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
        <div className="order-2 sm:order-1 w-full mx-auto space-y-1.5 px-0 sm:px-2">
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

          <div dir="ltr" className="flex justify-between text-xs font-mono font-bold text-white/90 px-0.5 select-none">
            <span ref={elapsedTimeRef}>
              {formatClockTime(currentTime)}
            </span>
            <span>
              {formatClockTime(duration)}
            </span>
          </div>
        </div>

        {/* 3 on Mobile / 2 on Desktop: PLAY BUTTON & CONTROLS ROW */}
        <div dir="ltr" className="order-3 sm:order-2 w-full max-w-[360px] flex items-center justify-between pt-1 pb-1">
          <button
            type="button"
            onClick={handleOpenArtistProfile}
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center p-1 transition-all shadow-lg cursor-pointer"
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
                  <User className="w-5 h-5 text-white" />
                </div>
              );
            })()}
          </button>

          <button
            type="button"
            onClick={() => seekRelative(-10)}
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
            aria-label={isHe ? '10 שניות אחורה' : 'Back 10 seconds'}
          >
            <SkipBack10Icon className="w-6 h-6" />
          </button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            onClick={togglePlayPause}
            className="w-[68px] h-[68px] sm:w-16 sm:h-16 rounded-full bg-white hover:bg-slate-100 text-slate-950 flex items-center justify-center shadow-2xl transition-all cursor-pointer ring-4 ring-white/25 active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current translate-x-0.5" />
            )}
          </motion.button>

          <button
            type="button"
            onClick={() => seekRelative(10)}
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-xl active:scale-95 text-white border border-white/25 flex items-center justify-center transition-all shadow-lg cursor-pointer"
            title={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
            aria-label={isHe ? '10 שניות קדימה' : 'Forward 10 seconds'}
          >
            <SkipForward10Icon className="w-6 h-6" />
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
            className="w-12 h-12 rounded-full border border-white/25 flex items-center justify-center bg-white/10 hover:bg-white/20 backdrop-blur-xl text-white transition-all shadow-lg cursor-pointer active:scale-95"
            title={isLiked ? (isHe ? 'הסר ממועדפים' : 'Unlike') : (isHe ? 'הוסף למועדפים' : 'Like')}
          >
            <Heart
              className={`w-6 h-6 transition-colors ${
                isLiked ? 'fill-white text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]' : 'text-white/80 fill-transparent'
              }`}
            />
          </button>
        </div>

        </div>
      </div>

      {/* SCREEN 2: ALBUM QUEUE ("הבא בתור") FIRST WHEN IN AN ALBUM -> TRACK DETAILS -> SUBTITLES CARD */}
      <div className="relative max-w-xl mx-auto w-full px-4 pt-6 pb-24 space-y-5 shrink-0">
        {albumQueueData.hasAlbumQueue && (
          <div className="p-4 sm:p-5 rounded-3xl bg-white/[0.08] backdrop-blur-2xl border border-white/20 space-y-3 shadow-2xl transform-gpu isolate">
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/15">
              <div className="flex items-center gap-2 min-w-0">
                <Disc className="w-4 h-4 text-white shrink-0" />
                <h3 className="text-sm font-bold text-white truncate">
                  {isHe ? `הבא בתור • ${albumQueueData.displayAlbumTitle}` : `Up Next • ${albumQueueData.displayAlbumTitle}`}
                </h3>
              </div>
              <span className="text-[11px] font-mono text-white/75 shrink-0 tabular-nums bg-white/10 px-2.5 py-0.5 rounded-full border border-white/15">
                {albumQueueData.currentIndex + 1} / {albumQueueData.orderedTracks.length}
              </span>
            </div>

            <div
              ref={albumQueueScrollRef}
              className="max-h-[280px] overflow-y-auto overscroll-contain custom-scrollbar space-y-2 pe-0.5"
            >
              {albumQueueData.orderedTracks.map((item, idx) => {
                const isCurrent = item.id === track.id;
                const isPrevious = albumQueueData.currentIndex >= 0 && idx < albumQueueData.currentIndex;
                return (
                  <button
                    key={item.id}
                    ref={isCurrent ? currentAlbumRowRef : undefined}
                    type="button"
                    onClick={() => {
                      if (!isCurrent && onPlayTrack) {
                        onPlayTrack(item);
                        playerScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className={`w-full h-[64px] px-3 rounded-2xl border transition-all flex items-center gap-3 text-start shrink-0 ${
                      isCurrent
                        ? 'bg-white/20 border-white/50 shadow-lg cursor-default'
                        : isPrevious
                          ? 'bg-white/[0.04] hover:bg-white/[0.11] border-white/10 opacity-75 hover:opacity-100 cursor-pointer group'
                          : 'bg-white/[0.07] hover:bg-white/[0.15] border-white/15 hover:border-white/30 cursor-pointer group'
                    }`}
                  >
                    <span className="text-[11px] font-mono text-white/60 w-5 text-center shrink-0 tabular-nums">
                      {idx + 1}
                    </span>

                    <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 border border-white/15 bg-black">
                      <TrackCoverArt
                        coverUrl={item.coverUrl}
                        artistName={item.artistName}
                        trackName={item.name}
                        genre={item.genre}
                        showHoverPlay={false}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span className="truncate">{item.name}</span>
                      </div>
                      <div className="text-[11px] text-white/65 truncate flex items-center gap-1.5 mt-0.5">
                        <span className="truncate">{item.artistName}</span>
                        {item.duration > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-mono tabular-nums">{formatClockTime(item.duration)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {isCurrent ? (
                      <span className="px-2.5 py-1 rounded-full bg-white text-black font-bold text-[10px] shrink-0">
                        {isHe ? 'עכשיו' : 'Now'}
                      </span>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10 group-hover:bg-white text-white group-hover:text-black flex items-center justify-center shrink-0 transition-colors">
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
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

            {track.writers && (
              <div className="col-span-2 sm:col-span-3 pt-1 border-t border-white/10">
                <span className="text-white/60 block font-bold text-[10px]">{isHe ? 'כותבים ומלחינים:' : 'Writers & Composers:'}</span>
                <span className="font-bold text-white/90 text-xs truncate block">{track.writers}</span>
              </div>
            )}
          </div>
        </div>

        {/* COLLAPSIBLE SUBTITLES & LYRICS CARD (BELOW TRACK DETAILS) */}
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
                          : upcomingLineIndex >= 0 && syncedLyrics.lines[upcomingLineIndex]
                            ? syncedLyrics.lines[upcomingLineIndex].words.map((w) => w.text).join(' ')
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
                <div
                  ref={lyricsScrollContainerRef}
                  className="max-h-72 sm:max-h-80 overflow-y-auto pe-2 space-y-2.5 select-none custom-scrollbar"
                >
                  {syncedLyrics.lines.map((line, lIdx) => {
                    const isLineActive = lIdx === activeLineIndex;
                    const isLineUpcoming = !isLineActive && lIdx === upcomingLineIndex;
                    const mm = Math.floor(line.startTime / 60);
                    const ss = Math.floor(line.startTime % 60).toString().padStart(2, '0');
                    const lineIsRtl = isRtlSubtitleText(line.text, subtitleLang);

                    return (
                      <div
                        key={line.id}
                        ref={isLineActive || isLineUpcoming ? activeLyricsLineRef : undefined}
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
                            : isLineUpcoming
                              ? 'bg-white/[0.04]'
                              : 'hover:bg-white/5'
                        }`}
                      >
                        <span className="text-[10px] font-mono text-white/70 bg-white/5 px-1.5 py-0.5 rounded mt-1 shrink-0">
                          {mm}:{ss}
                        </span>
                        <p
                          dir={lineIsRtl ? 'rtl' : 'ltr'}
                          className={`flex-1 text-xs sm:text-sm leading-relaxed transition-all duration-150 ${
                            lineIsRtl ? 'text-right' : 'text-left'
                          } ${
                            isLineActive
                              ? 'bg-white text-black font-black px-2.5 py-1 rounded-xl shadow-md'
                              : isLineUpcoming
                                ? 'border-2 border-white/80 bg-transparent text-white font-bold px-2.5 py-1 rounded-xl'
                                : 'text-white font-medium hover:text-white/85 px-1'
                          }`}
                        >
                          {line.text}
                        </p>
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
