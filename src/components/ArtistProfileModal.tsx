import React, { useState, useEffect } from 'react';
import {
  Music,
  Play,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  User,
  Trash2,
  Disc,
  Ticket,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, Album, ArtistProfile } from '../types';
import { getArtistConcertShows, formatConcertDate } from '../utils/concertUtils';
import { TrackCoverArt, isAuthenticCover } from './TrackCoverArt';
import { getArtistStableTheme, getTrackInstantColor, useExtractedColor } from '../services/colorService';
import { getInstantSongPool, deduplicateTracks, isValidTrackWithOwner, getCachedAlbums, fetchRealAlbums, ALBUMS_UPDATED_EVENT, getCachedArtistProfiles, fetchAllArtistProfiles } from '../services/multiMusicService';
import { AlbumModal } from './AlbumModal';
import { deleteTrackFromCloud, getStreamingMediaUrl } from '../services/cloudStorageService';
import { markSongAsDeleted } from '../services/deletedTracksService';
import { removeTrackFromStorage } from '../services/localTrackStorage';
import {
  getEffectiveArtistAvatarForTrack,
  getCurrentAuthUser,
  upgradeGooglePhotoQuality,
  onAuthUserChanged,
} from '../services/authService';

interface ArtistProfileModalProps {
  artistName: string;
  artistUid?: string;
  isOpen: boolean;
  onClose: () => void;
  allTracks: JamendoTrack[];
  allArtists?: ArtistProfile[];
  allAlbums?: Album[];
  onPlayTrack: (track: JamendoTrack, albumContext?: Album | null) => void;
  lang: Language;
  onToggleLike?: (id: string) => void;
  likedSongIds?: string[];
  onOpenPortal?: () => void;
  currentTrack?: JamendoTrack;
  onRemoveTrack?: (trackId: string) => void;
}

export const ArtistProfileModal: React.FC<ArtistProfileModalProps> = ({
  artistName,
  artistUid,
  isOpen,
  onClose,
  allTracks,
  allArtists = [],
  allAlbums = [],
  onPlayTrack,
  lang,
  onToggleLike,
  likedSongIds = [],
  currentTrack,
  onRemoveTrack,
}) => {
  const profileScrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && profileScrollRef.current) {
      profileScrollRef.current.scrollTop = 0;
    }
  }, [isOpen, artistName, artistUid]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const isHe = lang === 'he';

  const [deletedTrackIds, setDeletedTrackIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const [loadedArtists, setLoadedArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());
  const [loadedAlbums, setLoadedAlbums] = useState<Album[]>(() => getCachedAlbums());
  const [selectedAlbumForView, setSelectedAlbumForView] = useState<Album | null>(null);
  const [failedAlbumCoverIds, setFailedAlbumCoverIds] = useState<Record<string, boolean>>({});
  const [currentUid, setCurrentUid] = useState<string | null>(() => getCurrentAuthUser()?.uid || null);

  useEffect(() => {
    const unsub = onAuthUserChanged((user) => {
      setCurrentUid(user?.uid || null);
    });
    const handleAlbumsUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ albums?: Album[] }>)?.detail;
      setLoadedAlbums(Array.isArray(detail?.albums) ? detail.albums : getCachedAlbums());
    };
    window.addEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);
    return () => {
      unsub();
      window.removeEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchAllArtistProfiles()
        .then((profiles) => {
          if (Array.isArray(profiles) && profiles.length > 0) {
            setLoadedArtists(profiles);
          }
        })
        .catch(() => {});
      fetchRealAlbums()
        .then((albums) => {
          if (Array.isArray(albums) && albums.length > 0) {
            setLoadedAlbums(albums);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, artistName, artistUid]);

  // Merge passed allArtists with cached/fetched artist profiles
  const mergedArtists = React.useMemo(() => {
    const map = new Map<string, ArtistProfile>();
    [...getCachedArtistProfiles(), ...loadedArtists, ...allArtists].forEach((a) => {
      if (!a) return;
      const key = (a.googleUid || a.id || a.name || '').replace(/^artist_/, '').toLowerCase().trim();
      if (!key) return;
      const prev = map.get(key);
      map.set(key, prev ? { ...prev, ...a, avatarUrl: a.avatarUrl || prev.avatarUrl, bio: a.bio || prev.bio } : a);
    });
    return Array.from(map.values());
  }, [allArtists, loadedArtists]);

  const rawUid = (artistUid || currentTrack?.uploadedByUid || '').trim();
  const cleanTargetUid = rawUid.replace(/^artist_/, '').toLowerCase().trim();
  const cleanTargetEmail = (currentTrack?.uploadedByEmail || '').toLowerCase().trim();
  const cleanQuery = (artistName || currentTrack?.artistName || '').toLowerCase().trim();

  // Resolve artist account by UID / Email FIRST, then normalized artist name
  const artistInfo =
    (cleanTargetUid
      ? mergedArtists.find((a) => {
          const aId = (a.id || '').replace(/^artist_/, '').toLowerCase().trim();
          const aGoogleUid = (a.googleUid || '').replace(/^artist_/, '').toLowerCase().trim();
          return aId === cleanTargetUid || aGoogleUid === cleanTargetUid;
        })
      : undefined) ||
    (cleanTargetEmail
      ? mergedArtists.find((a) => (a.googleEmail || '').toLowerCase().trim() === cleanTargetEmail)
      : undefined) ||
    (cleanQuery
      ? mergedArtists.find((a) => (a.name || '').toLowerCase().trim() === cleanQuery)
      : undefined);

  const effectiveArtistName = artistInfo?.name || artistName || currentTrack?.artistName || (isHe ? 'אמן' : 'Artist');
  const effectiveCleanName = effectiveArtistName.toLowerCase().trim();

  // Canonical UID & email set for the resolved artist
  const canonicalUid = (artistInfo?.googleUid || artistInfo?.id || rawUid || '').replace(/^artist_/, '').toLowerCase().trim();
  const canonicalEmail = (artistInfo?.googleEmail || cleanTargetEmail || '').toLowerCase().trim();

  // Merge currentTrack, allTracks, and instant song pool strictly filtering for valid owner tracks
  const poolBase = Array.isArray(allTracks) ? allTracks : [];
  const fullPool = deduplicateTracks([
    ...(currentTrack ? [currentTrack] : []),
    ...poolBase,
    ...getInstantSongPool(),
  ]).filter(isValidTrackWithOwner);

  let artistTracks = fullPool.filter((t) => {
    if (!isValidTrackWithOwner(t)) return false;
    if (deletedTrackIds.includes(t.id)) return false;

    const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    const tEmail = (t.uploadedByEmail || '').toLowerCase().trim();
    const tArtist = (t.artistName || '').toLowerCase().trim();

    // 1. Direct match by artist account UID or Email
    if (canonicalUid && tUid && tUid === canonicalUid) return true;
    if (canonicalEmail && tEmail && tEmail === canonicalEmail) return true;

    // 2. Fallback match by artist name (skip if track is explicitly owned by another account UID)
    if (canonicalUid && tUid && tUid !== canonicalUid) return false;
    if (!tArtist) return false;
    const queries = [cleanQuery, effectiveCleanName].filter(Boolean);
    return queries.some(
      (q) =>
        tArtist === q ||
        tArtist.includes(q) ||
        q.includes(tArtist) ||
        (q.length > 3 && tArtist.slice(0, 4) === q.slice(0, 4))
    );
  });

  if (artistTracks.length === 0 && currentTrack && isValidTrackWithOwner(currentTrack) && !deletedTrackIds.includes(currentTrack.id)) {
    artistTracks = [currentTrack];
  }

  const sampleTrack = artistTracks[0] || currentTrack || fullPool[0];

  const artistBio = artistInfo?.bio || sampleTrack?.artistBio || '';

  // Dedicated artist avatar resolution: ArtistProfile avatar -> Track artistAvatarUrl (never invent an avatar from song coverUrl)
  let rawAvatarUrl: string | undefined = artistInfo?.avatarUrl;

  if (!isAuthenticCover(rawAvatarUrl) && sampleTrack) {
    rawAvatarUrl = getEffectiveArtistAvatarForTrack(sampleTrack, mergedArtists);
  }

  if (!isAuthenticCover(rawAvatarUrl)) {
    const trackWithAvatar =
      artistTracks.find((t) => isAuthenticCover(t.artistAvatarUrl)) ||
      (isAuthenticCover(currentTrack?.artistAvatarUrl) ? currentTrack : undefined);
    if (trackWithAvatar?.artistAvatarUrl) {
      rawAvatarUrl = trackWithAvatar.artistAvatarUrl;
    }
  }

  const avatarUrl = rawAvatarUrl ? upgradeGooglePhotoQuality(getStreamingMediaUrl(rawAvatarUrl)) || getStreamingMediaUrl(rawAvatarUrl) : undefined;
  const avatarImgError = !!avatarUrl && failedAvatarUrl === avatarUrl;
  const themeColor = useExtractedColor(avatarUrl, artistInfo?.genre || sampleTrack?.genre || 'Pop', sampleTrack?.bgColor);

  // Profile modal opens even if track count is currently 0 (reliable loading)
  if (!isOpen || !effectiveArtistName) return null;

  // Retrieve albums for this artist from cloud session albums + track albumName tags
  const artistAlbums: Album[] = (() => {
    try {
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
      const validTrackIds = new Set(artistTracks.map((t) => t.id));
      const albumMap = new Map<string, Album>();

      const merged = [...getCachedAlbums(), ...loadedAlbums, ...allAlbums];
      merged.forEach((a) => {
        if (!a?.id || !a?.title) return;
        const cleanTitle = a.title.trim();
        const lowerTitle = cleanTitle.toLowerCase();
        if (invalidAlbumNames.has(lowerTitle) || lowerTitle.startsWith('סינגל') || lowerTitle.startsWith('single')) return;

        const aUid = (a.uploadedByUid || a.artistId || '').replace(/^artist_/, '').toLowerCase().trim();
        const aArtist = (a.artistName || '').toLowerCase().trim();
        const ownerMatches =
          (canonicalUid && aUid && canonicalUid === aUid) ||
          (!aUid && effectiveCleanName && aArtist === effectiveCleanName) ||
          (effectiveCleanName && aArtist && (aArtist === effectiveCleanName || aArtist === cleanQuery));
        if (!ownerMatches) return;

        const matchedTrackIds = new Set<string>(
          (a.trackIds || []).filter((id) => validTrackIds.has(id))
        );
        artistTracks.forEach((t) => {
          if (t.albumName && t.albumName.trim().toLowerCase() === lowerTitle) {
            matchedTrackIds.add(t.id);
          }
        });

        const key = `${aUid || aArtist}::${lowerTitle}`;
        const prev = albumMap.get(key);
        const combinedIds = Array.from(new Set([...(prev?.trackIds || []), ...Array.from(matchedTrackIds)]));
        const firstTrackCover = artistTracks.find((t) => combinedIds.includes(t.id) && t.coverUrl)?.coverUrl;
        albumMap.set(key, {
          ...(prev || {}),
          ...a,
          coverUrl: a.coverUrl || prev?.coverUrl || firstTrackCover,
          trackIds: combinedIds,
        });
      });

      artistTracks.forEach((t) => {
        const cleanAlb = (t.albumName || '').trim();
        const lowerAlb = cleanAlb.toLowerCase();
        if (!cleanAlb || invalidAlbumNames.has(lowerAlb) || lowerAlb.startsWith('סינגל') || lowerAlb.startsWith('single')) return;
        const tUid = (t.uploadedByUid || canonicalUid || '').replace(/^artist_/, '').toLowerCase().trim();
        const tArtist = (t.artistName || effectiveArtistName || '').toLowerCase().trim();
        const key = `${tUid || tArtist}::${lowerAlb}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `album-${t.id}`,
            title: cleanAlb,
            artistName: t.artistName || effectiveArtistName,
            artistId: t.uploadedByUid || canonicalUid,
            uploadedByUid: t.uploadedByUid || canonicalUid,
            coverUrl: t.coverUrl,
            trackIds: [t.id],
            createdDate: t.publishedDate || new Date().toISOString().split('T')[0],
          });
        } else {
          const existing = albumMap.get(key)!;
          if (!existing.trackIds.includes(t.id)) {
            existing.trackIds = [...existing.trackIds, t.id];
          }
          if (!existing.coverUrl && t.coverUrl) {
            existing.coverUrl = t.coverUrl;
          }
        }
      });

      return Array.from(albumMap.values()).filter((a) => a.trackIds.length > 0);
    } catch {
      return [];
    }
  })();

  const canDeleteTrack = (track: JamendoTrack) => {
    if (!onRemoveTrack || !currentUid) return false;
    const cleanCurrent = currentUid.replace(/^artist_/, '').toLowerCase().trim();
    const trackUid = (track.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    return !!(trackUid && cleanCurrent && trackUid === cleanCurrent);
  };

  const handleDeleteTrack = async (track: JamendoTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    const trackId = track.id;

    if (!canDeleteTrack(track)) return;

    if (confirmDeleteId !== trackId) {
      setConfirmDeleteId(trackId);
      setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === trackId ? null : cur));
      }, 4000);
      return;
    }

    // Permanent delete
    markSongAsDeleted(trackId);
    setConfirmDeleteId(null);
    setDeletedTrackIds((prev) => [...prev, trackId]);

    if (onRemoveTrack) {
      onRemoveTrack(trackId);
    }

    await Promise.allSettled([
      removeTrackFromStorage(trackId),
      deleteTrackFromCloud(trackId),
    ]);
  };

  return (
    <motion.div
      ref={profileScrollRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[120] w-full h-[100dvh] bg-[#070b14] overflow-y-auto text-white custom-scrollbar flex flex-col"
      dir={isHe ? 'rtl' : 'ltr'}
    >
      {/* SEAMLESS AMBIENT TOP COLOR WASH — FADES SMOOTHLY INTO #070B14 WITH ZERO DIVIDER LINE */}
      <div className="relative w-full flex-1 flex flex-col bg-[#070b14]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[340px] sm:h-[380px] transition-all duration-500"
          style={{
            background: `radial-gradient(ellipse 85% 65% at 50% 0%, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.52) 0%, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.24) 45%, rgba(7, 11, 20, 0) 100%), linear-gradient(180deg, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.34) 0%, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.1) 58%, rgba(7, 11, 20, 0) 100%)`,
          }}
        />

        {/* BACK BUTTON */}
        <div className="absolute top-4 start-4 sm:top-6 sm:start-6 z-50">
          <button
            onClick={onClose}
            aria-label={isHe ? 'חזור' : 'Back'}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white border border-white/20 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl cursor-pointer active:scale-95 transition-all"
            title={isHe ? 'חזור' : 'Back'}
          >
            {isHe ? (
              <ArrowRight className="w-5 h-5 text-white" />
            ) : (
              <ArrowLeft className="w-5 h-5 text-white" />
            )}
          </button>
        </div>

        {/* HERO HEADER: SEAMLESS COLOR BLEND WITHOUT HORIZONTAL LINE */}
        <div className="relative z-10 w-full pt-20 sm:pt-24">
          {/* PROFILE CARD */}
          <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-6">
            <div className="relative flex-shrink-0">
              <div
                className="p-1.5 rounded-full bg-white/[0.12] backdrop-blur-2xl border border-white/35 transition-shadow duration-500"
                style={{
                  boxShadow: `0 10px 38px rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.45)`,
                }}
              >
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-black/40 border border-white/20 overflow-hidden flex items-center justify-center">
                  {avatarUrl && !avatarImgError ? (
                    <img
                      src={avatarUrl}
                      alt={effectiveArtistName}
                      loading="eager"
                      decoding="sync"
                      referrerPolicy="no-referrer"
                      onError={() => setFailedAvatarUrl(avatarUrl)}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full bg-white/[0.06] flex items-center justify-center text-white font-normal text-3xl select-none">
                      {effectiveArtistName?.[0] || <User className="w-10 h-10 text-white/90" />}
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/20 via-transparent to-transparent" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5 text-center sm:text-right flex-1 min-w-0 pb-1">
              <h1 className="text-2xl sm:text-4xl font-normal text-white tracking-tight drop-shadow-md truncate leading-tight">
                {effectiveArtistName}
              </h1>

              {/* CLEAN SUBTITLE: NUMBER OF SONGS • NUMBER OF ALBUMS (NO GENRE) */}
              <p className="text-xs sm:text-sm text-white/80 font-normal">
                {artistTracks.length} {isHe ? 'שירים' : 'tracks'}
                {artistAlbums.length > 0 && ` • ${artistAlbums.length} ${isHe ? 'אלבומים' : 'albums'}`}
              </p>

              {artistBio && (
                <p className="text-xs text-white/60 max-w-xl font-normal leading-relaxed pt-1 line-clamp-2">
                  {artistBio}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* UPCOMING CONCERT TICKETS FOR ARTIST (IF SET) */}
        {(() => {
          const shows = getArtistConcertShows(artistInfo, sampleTrack);
          if (shows.length === 0) return null;
          return (
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 pt-6 w-full space-y-3">
              <h3 className="text-sm font-normal text-white flex items-center gap-2">
                <Ticket className="w-4 h-4 text-white" />
                <span>{isHe ? 'כרטיסים להופעות' : 'Concert Tickets'}</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {shows.map((show) => (
                  <div
                    key={show.id}
                    className="rounded-2xl bg-white/[0.06] border border-white/15 p-4 flex items-center justify-between gap-4 shadow-xl"
                  >
                    <div className="min-w-0 space-y-1">
                      <h4 className="font-bold text-sm text-white truncate">{show.title}</h4>
                      {(show.date || show.venue) && (
                        <p className="text-xs text-white/70 flex items-center gap-1.5 tabular-nums truncate">
                          <Calendar className="w-3.5 h-3.5 text-white/60 shrink-0" />
                          <span className="truncate">
                            {show.date ? formatConcertDate(show.date, isHe) : ''}
                            {show.date && show.venue ? ' · ' : ''}
                            {show.venue || ''}
                          </span>
                        </p>
                      )}
                    </div>
                    <a
                      href={show.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[42px] px-4 py-2 rounded-full bg-white hover:bg-neutral-200 text-black font-bold text-xs flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors"
                    >
                      <span>{isHe ? 'להזמנה ופרטים נוספים' : 'Tickets & Details'}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-black shrink-0" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ALBUMS ROW IF CREATED */}
        {artistAlbums.length > 0 && (
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 pt-6 w-full space-y-3">
            <h3 className="text-sm font-normal text-white flex items-center gap-2">
              <Disc className="w-4 h-4 text-white" />
              <span>{isHe ? 'אלבומים' : 'Albums'}</span>
            </h3>

            <div className="flex items-center gap-4 overflow-x-auto pb-2 custom-scrollbar">
              {artistAlbums.map((album) => {
                const resolvedCover = getStreamingMediaUrl(
                  album.coverUrl || artistTracks.find((t) => album.trackIds.includes(t.id) && t.coverUrl)?.coverUrl
                );
                const isCoverBroken = !!failedAlbumCoverIds[album.id];
                return (
                  <button
                    key={album.id}
                    type="button"
                    onClick={() => setSelectedAlbumForView(album)}
                    className="group min-w-[150px] max-w-[170px] shrink-0 p-3 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 hover:border-white/30 shadow-xl space-y-2 text-start cursor-pointer transition-all"
                  >
                    <div className="w-full aspect-square rounded-xl bg-neutral-900 overflow-hidden flex items-center justify-center border border-white/10 relative">
                      {resolvedCover && !isCoverBroken ? (
                        <img
                          src={resolvedCover}
                          alt={album.title}
                          onError={() => setFailedAlbumCoverIds((prev) => ({ ...prev, [album.id]: true }))}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <Disc className="w-8 h-8 text-white/40" />
                      )}
                      <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <span className="px-2.5 py-1 rounded-full bg-white text-black text-[10px] font-bold shadow">
                          {isHe ? 'צפה באלבום' : 'Open Album'}
                        </span>
                      </div>
                    </div>
                    <h4 className="font-semibold text-xs text-white truncate">{album.title}</h4>
                    <p className="text-[10px] text-white/60 font-normal">
                      {album.trackIds.length} {isHe ? 'שירים' : 'tracks'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ALL SONGS OF THE SINGER DIRECTLY UNDERNEATH */}
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 pt-6 pb-12 w-full flex-1 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="text-base sm:text-lg font-normal text-white flex items-center gap-2">
              <Music className="w-4 h-4 text-white" />
              <span>{isHe ? `כל השירים של ${effectiveArtistName}` : `Songs by ${effectiveArtistName}`}</span>
            </h2>
            <span className="text-xs font-normal text-white/70 bg-white/10 px-3 py-1 rounded-full border border-white/15">
              {artistTracks.length} {isHe ? 'שירים' : 'tracks'}
            </span>
          </div>

          {artistTracks.length === 0 ? (
            <div className="py-14 text-center text-white/50 bg-white/[0.03] rounded-3xl border border-white/10 p-8 space-y-3">
              <Music className="w-10 h-10 mx-auto text-white/30" />
              <p className="text-sm font-medium text-white/80">{isHe ? 'טרם הועלו שירים עבור אמן זה' : 'No songs uploaded yet for this artist'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {artistTracks.map((track, idx) => {
              const trackColor = getTrackInstantColor(track);
              const hoverShadow = `0 0 25px rgba(${trackColor.r}, ${trackColor.g}, ${trackColor.b}, 0.35)`;
              return (
                <div
                  key={track.id}
                  onClick={() => {
                    onPlayTrack(track, null);
                    onClose();
                  }}
                  style={{
                    boxShadow: 'none',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = hoverShadow;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                  className="group bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-2xl border border-white/10 hover:border-white/25 rounded-2xl p-2.5 transition-shadow duration-300 cursor-pointer flex flex-col justify-between text-white relative"
                >
                  <div>
                    <div className="mb-2 shadow-inner aspect-square rounded-xl overflow-hidden relative">
                      <TrackCoverArt
                        coverUrl={track.coverUrl}
                        artistName={track.artistName}
                        trackName={track.name}
                        genre={track.genre}
                        priority={idx < 8}
                      />

                      {/* Top Corner Delete Button for authorized owner only */}
                      {canDeleteTrack(track) && (
                        <div className="absolute top-1.5 left-1.5 z-10">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteTrack(track, e)}
                            className={`p-1.5 rounded-lg text-white backdrop-blur-md shadow-lg cursor-pointer transition-all border ${
                              confirmDeleteId === track.id
                                ? 'bg-rose-600 border-rose-400 animate-pulse'
                                : 'bg-black/80 hover:bg-rose-600 border-white/20'
                            }`}
                            title={
                              confirmDeleteId === track.id
                                ? isHe
                                  ? 'לחץ שוב לאישור מחיקה'
                                  : 'Click again to confirm delete'
                                : isHe
                                ? 'מחק שיר'
                                : 'Delete track'
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5 text-white" />
                          </button>
                        </div>
                      )}

                      {track.isAiGenerated && (
                        <div className="absolute bottom-1.5 right-1.5 z-10">
                          <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-normal text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                            <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                            AI
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <h3 className="font-normal text-xs text-white group-hover:text-white/90 transition-colors line-clamp-1 flex-1">
                        {track.name}
                      </h3>
                      {track.isAiGenerated && (
                        <span className="px-1 py-0.2 rounded bg-purple-500/25 border border-purple-400/40 text-purple-300 text-[9px] font-normal shrink-0">
                          AI
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-normal text-white/60 truncate mt-0.5">
                      {track.artistName}
                    </p>
                  </div>

                  <div className="px-0.5 pt-1.5 mt-1.5 border-t border-white/10 flex items-center justify-between text-[9px] text-white/50 font-normal">
                    <span className="text-white/60 font-normal truncate">{track.genre || 'Music'}</span>
                    <Play className="w-3.5 h-3.5 text-white flex-shrink-0" />
                  </div>

                  {/* Explicit Delete Button at bottom of card if owner is authorized */}
                  {canDeleteTrack(track) && (
                    <div className="pt-2 mt-1">
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTrack(track, e)}
                        className={`w-full py-1 px-2 rounded-lg text-[10px] font-normal flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          confirmDeleteId === track.id
                            ? 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-400 animate-pulse shadow-md'
                            : 'bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/25'
                        }`}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{confirmDeleteId === track.id ? (isHe ? 'בטוח למחוק?' : 'Confirm Delete?') : (isHe ? 'מחק שיר' : 'Delete')}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </main>
      </div>

      {/* ALBUM DETAIL MODAL */}
      <AlbumModal
        isOpen={!!selectedAlbumForView}
        onClose={() => setSelectedAlbumForView(null)}
        album={selectedAlbumForView}
        allTracks={fullPool}
        onPlayTrack={(track, albCtx) => {
          setSelectedAlbumForView(null);
          onPlayTrack(track, albCtx ?? selectedAlbumForView);
          onClose();
        }}
        lang={lang}
        onToggleLike={(trackId) => onToggleLike?.(trackId)}
        likedSongIds={likedSongIds}
        onOpenArtistProfile={() => setSelectedAlbumForView(null)}
      />
    </motion.div>
  );
};
