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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, Album, ArtistProfile } from '../types';
import { TrackCoverArt, isAuthenticCover } from './TrackCoverArt';
import { getArtistStableTheme, getTrackInstantColor } from '../services/colorService';
import { getInstantSongPool, deduplicateTracks, isValidTrackWithOwner } from '../services/multiMusicService';
import { getStreamingMediaUrl, deleteTrackFromCloud } from '../services/cloudStorageService';
import { markSongAsDeleted } from '../services/deletedTracksService';
import { removeTrackFromStorage } from '../services/localTrackStorage';
import { deleteArtistTrackFromFirebase } from '../services/firebaseService';

interface ArtistProfileModalProps {
  artistName: string;
  isOpen: boolean;
  onClose: () => void;
  allTracks: JamendoTrack[];
  allArtists?: ArtistProfile[];
  onPlayTrack: (track: JamendoTrack) => void;
  lang: Language;
  onToggleLike?: (id: string) => void;
  likedSongIds?: string[];
  onOpenPortal?: () => void;
  currentTrack?: JamendoTrack;
  onRemoveTrack?: (trackId: string) => void;
}

export const ArtistProfileModal: React.FC<ArtistProfileModalProps> = ({
  artistName,
  isOpen,
  onClose,
  allTracks,
  allArtists = [],
  onPlayTrack,
  lang,
  currentTrack,
  onRemoveTrack,
}) => {
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
  const [avatarImgError, setAvatarImgError] = useState(false);

  const cleanQuery = (artistName || currentTrack?.artistName || '').toLowerCase().trim();
  const artistInfo = allArtists.find(a => (a.name || '').toLowerCase().trim() === cleanQuery);
  const effectiveArtistName = artistName || currentTrack?.artistName || artistInfo?.name || (isHe ? 'אמן' : 'Artist');

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
    const tArtist = (t.artistName || '').toLowerCase().trim();
    if (!tArtist) return false;
    return (
      tArtist === cleanQuery ||
      tArtist.includes(cleanQuery) ||
      cleanQuery.includes(tArtist) ||
      (cleanQuery.length > 3 && tArtist.slice(0, 4) === cleanQuery.slice(0, 4))
    );
  });

  if (artistTracks.length === 0 && currentTrack && isValidTrackWithOwner(currentTrack) && !deletedTrackIds.includes(currentTrack.id)) {
    artistTracks = [currentTrack];
  }

  // Profile modal opens even if track count is currently 0 (reliable loading)
  if (!isOpen || !effectiveArtistName) return null;

  // Retrieve albums for this artist, filtering out deleted tracks
  const artistAlbums: Album[] = (() => {
    try {
      const saved = localStorage.getItem('kolot_user_albums');
      if (!saved) return [];
      const parsed: Album[] = JSON.parse(saved);
      const validTrackIds = new Set(artistTracks.map((t) => t.id));
      return parsed
        .filter((a) => {
          const aArtist = (a.artistName || '').toLowerCase().trim();
          return aArtist === cleanQuery || cleanQuery.includes(aArtist) || aArtist.includes(cleanQuery);
        })
        .map((a) => ({
          ...a,
          trackIds: (a.trackIds || []).filter((id) => validTrackIds.has(id)),
        }))
        .filter((a) => a.trackIds.length > 0);
    } catch {
      return [];
    }
  })();

  const sampleTrack = artistTracks[0] || currentTrack || fullPool[0];

  const artistBio = artistInfo?.bio || '';

  // Dedicated artist avatar with authentic image resolution
  let rawAvatarUrl: string | undefined = artistInfo?.avatarUrl;

  if (!isAuthenticCover(rawAvatarUrl)) {
    const trackWithAvatar = artistTracks.find((t) => isAuthenticCover(t.artistAvatarUrl)) || (isAuthenticCover(currentTrack?.artistAvatarUrl) ? currentTrack : undefined);
    if (trackWithAvatar?.artistAvatarUrl) {
      rawAvatarUrl = trackWithAvatar.artistAvatarUrl;
    } else {
      try {
        const saved = localStorage.getItem('wikiarchive_artist_account') || localStorage.getItem('kolot_artist_account_v1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (
            parsed.name?.toLowerCase().trim() === cleanQuery &&
            parsed.avatarUrl &&
            isAuthenticCover(parsed.avatarUrl)
          ) {
            rawAvatarUrl = parsed.avatarUrl;
          }
        }
      } catch {}
    }
  }

  if (!isAuthenticCover(rawAvatarUrl)) {
    const trackWithCover = artistTracks.find((t) => isAuthenticCover(t.coverUrl)) || (isAuthenticCover(sampleTrack?.coverUrl) ? sampleTrack : undefined);
    if (trackWithCover?.coverUrl) {
      rawAvatarUrl = trackWithCover.coverUrl;
    }
  }

  const avatarUrl = rawAvatarUrl ? getStreamingMediaUrl(rawAvatarUrl) : undefined;
  // Permanent, 100% deterministic artist color palette
  const themeColor = getArtistStableTheme(effectiveArtistName, avatarUrl);

  const canDeleteTrack = (track: JamendoTrack) => {
    if (!onRemoveTrack) return false;
    try {
      const authRaw = localStorage.getItem('wikiarchive_cached_auth_user');
      const authUser = authRaw ? JSON.parse(authRaw) : null;
      if (!authUser) return false;

      const userEmail = authUser.email?.toLowerCase().trim() || '';
      const isMainAdmin = userEmail === 'danielbarber1246@gmail.com';

      // Main admin email (danielbarber1246@gmail.com) can manage unassigned songs or their own songs
      if (isMainAdmin) {
        if (!track.uploadedByEmail && !track.uploadedByUid) return true;
        if (track.uploadedByEmail?.toLowerCase().trim() === 'danielbarber1246@gmail.com') return true;
      }

      // Track uploaded by user email or uid
      if (track.uploadedByEmail && userEmail && track.uploadedByEmail.toLowerCase().trim() === userEmail) return true;
      if (track.uploadedByUid && track.uploadedByUid === authUser.uid) return true;

      // Or user owns artist profile
      const artistRaw = localStorage.getItem('kolot_artist_account_v1') || localStorage.getItem('wikiarchive_artist_account');
      if (artistRaw) {
        const artist = JSON.parse(artistRaw);
        if ((artist.uid === authUser.uid || artist.googleUid === authUser.uid) && (
          artist.name?.toLowerCase().trim() === cleanQuery ||
          artist.name?.toLowerCase().trim() === (track.artistName || '').toLowerCase().trim()
        )) {
          return true;
        }
      }
    } catch {}
    return false;
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
      deleteArtistTrackFromFirebase(trackId),
      deleteTrackFromCloud(trackId),
    ]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed inset-0 z-[120] w-screen h-screen bg-[#070b14] overflow-y-auto text-white custom-scrollbar flex flex-col"
      dir={isHe ? 'rtl' : 'ltr'}
    >
        {/* BACK BUTTON */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-50">
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

        {/* HERO HEADER: CLEAR ELEGANT LAYOUT */}
        <div className="relative w-full border-b border-white/10 bg-slate-950/80">
          <div
            className="relative w-full h-36 sm:h-44 overflow-hidden"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.6) 0%, rgba(7, 11, 20, 0.98) 85%)`,
            }}
          >
            <div
              className="absolute -top-12 left-1/4 w-80 h-80 rounded-full blur-[100px] opacity-60 pointer-events-none"
              style={{ background: `rgb(${themeColor.r}, ${themeColor.g}, ${themeColor.b})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#070b14]/50 to-[#070b14]" />
          </div>

          {/* PROFILE CARD */}
          <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 -mt-14 sm:-mt-16 pb-6 flex flex-col sm:flex-row items-center sm:items-end gap-4 sm:gap-6">
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-[#070b14] bg-slate-900 shadow-2xl overflow-hidden ring-2 ring-white/20 flex items-center justify-center">
                {avatarUrl && !avatarImgError ? (
                  <img
                    src={avatarUrl}
                    alt={effectiveArtistName}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarImgError(true)}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="w-full h-full rounded-full flex items-center justify-center text-white font-bold text-3xl shadow-inner select-none"
                    style={{
                      background: `linear-gradient(135deg, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.9), #0f172a)`,
                    }}
                  >
                    {effectiveArtistName?.[0] || <User className="w-10 h-10 text-white/90" />}
                  </div>
                )}
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

        {/* ALBUMS ROW IF CREATED */}
        {artistAlbums.length > 0 && (
          <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 w-full space-y-3">
            <h3 className="text-sm font-normal text-white flex items-center gap-2">
              <Disc className="w-4 h-4 text-white" />
              <span>{isHe ? 'אלבומים' : 'Albums'}</span>
            </h3>

            <div className="flex items-center gap-4 overflow-x-auto pb-2 custom-scrollbar">
              {artistAlbums.map((album) => (
                <div key={album.id} className="min-w-[150px] max-w-[170px] p-3 rounded-2xl bg-white/5 border border-white/15 shadow-xl space-y-2">
                  <div className="w-full aspect-square rounded-xl bg-neutral-900 overflow-hidden flex items-center justify-center border border-white/10">
                    {album.coverUrl ? (
                      <img src={album.coverUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Disc className="w-8 h-8 text-white/40" />
                    )}
                  </div>
                  <h4 className="font-normal text-xs text-white truncate">{album.title}</h4>
                  <p className="text-[10px] text-white/60 font-normal">{album.trackIds.length} {isHe ? 'שירים' : 'tracks'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ALL SONGS OF THE SINGER DIRECTLY UNDERNEATH */}
        <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 pb-12 w-full flex-1 space-y-5">
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
            {artistTracks.map((track) => {
              const trackColor = getTrackInstantColor(track);
              const hoverShadow = `0 0 25px rgba(${trackColor.r}, ${trackColor.g}, ${trackColor.b}, 0.35)`;
              return (
                <div
                  key={track.id}
                  onClick={() => {
                    onPlayTrack(track);
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
      </motion.div>
  );
};
