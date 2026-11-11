import React from 'react';
import { X, Play, Heart, Disc, Music, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, Album } from '../types';
import { TrackCoverArt } from './TrackCoverArt';
import { getStreamingMediaUrl } from '../services/cloudStorageService';

import { Logo } from './Logo';

interface AlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  album: Album | null;
  allTracks: JamendoTrack[];
  onPlayTrack: (track: JamendoTrack) => void;
  lang: Language;
  onToggleLike: (trackId: string) => void;
  likedSongIds: string[];
  onOpenArtistProfile?: (artistName: string) => void;
}

export const AlbumModal: React.FC<AlbumModalProps> = ({
  isOpen,
  onClose,
  album,
  allTracks,
  onPlayTrack,
  lang,
  onToggleLike,
  likedSongIds,
  onOpenArtistProfile,
}) => {
  if (!isOpen || !album) return null;
  const isHe = lang === 'he';

  // Find all tracks belonging to this album with multi-criteria matching
  const explicitMatches = allTracks.filter((t) => {
    if (album.trackIds && album.trackIds.length > 0 && album.trackIds.includes(t.id)) {
      return true;
    }
    if (t.albumName && album.title && t.albumName.toLowerCase().trim() === album.title.toLowerCase().trim()) {
      return true;
    }
    if (album.artistName && t.artistName && t.artistName.toLowerCase().trim() === album.artistName.toLowerCase().trim()) {
      if (t.albumName && t.albumName.toLowerCase().trim() === album.title.toLowerCase().trim()) {
        return true;
      }
    }
    return false;
  });

  // Fallback: If no explicit album name match, load top tracks by that artist
  const albumTracks = explicitMatches.length > 0
    ? explicitMatches
    : allTracks.filter((t) => album.artistName && t.artistName?.toLowerCase().trim() === album.artistName.toLowerCase().trim()).slice(0, 10);

  const effectiveCover = getStreamingMediaUrl(
    album.coverUrl || albumTracks[0]?.coverUrl || undefined
  );

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-2xl overflow-y-auto custom-scrollbar"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative w-full max-w-4xl bg-[#121212]/95 border border-white/15 rounded-3xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col my-auto"
        >
          {/* TOP BAR / CLOSE BUTTON */}
          <div className="p-4 sm:p-6 pb-0 flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-2 text-white/60 text-xs">
              <Disc className="w-4 h-4 text-white" />
              <span>{isHe ? 'תצוגת אלבום' : 'Album View'}</span>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer border border-white/15 shadow-md"
              title={isHe ? 'סגור' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ALBUM HEADER SECTION */}
          <div className="p-6 sm:p-8 flex flex-col sm:flex-row items-center sm:items-end gap-6 border-b border-white/10 bg-gradient-to-b from-white/5 to-transparent">
            {/* Album Cover Art (Square 1:1) */}
            <div className="w-44 h-44 sm:w-52 sm:h-52 shrink-0 rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-950 via-purple-900 to-black border border-white/20 shadow-[0_12px_35px_rgba(0,0,0,0.8)] relative flex items-center justify-center">
              {effectiveCover ? (
                <img
                  src={effectiveCover}
                  alt={album.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-800/40 via-indigo-900/60 to-black/90 text-white/90 p-4 text-center select-none relative overflow-hidden">
                  <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <div className="absolute inset-2 rounded-full border border-white/40" />
                    <div className="absolute inset-6 rounded-full border border-white/30" />
                    <div className="absolute inset-10 rounded-full border border-white/20" />
                  </div>
                  <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-xl border border-white/25 flex items-center justify-center mb-3 shadow-2xl">
                    <Disc className="w-9 h-9 text-purple-300" />
                  </div>
                  <span className="text-xs font-black text-white truncate max-w-full px-2">{album.title}</span>
                  <span className="text-[10px] font-bold text-purple-300/80 tracking-widest uppercase mt-0.5">{isHe ? 'אלבום מוזיקלי' : 'Music Album'}</span>
                </div>
              )}
            </div>

            {/* Album Metadata & Action */}
            <div className="flex-1 text-center sm:text-start space-y-3 min-w-0">
              <span className="px-3 py-1 rounded-full bg-white/10 text-white/80 border border-white/15 text-xs font-medium inline-block">
                {isHe ? 'אלבום מוזיקלי' : 'Music Album'}
              </span>

              <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow truncate">
                {album.title}
              </h1>

              {album.artistName && (
                <p
                  onClick={() => {
                    if (onOpenArtistProfile) {
                      onOpenArtistProfile(album.artistName);
                      onClose();
                    }
                  }}
                  className="text-sm sm:text-base text-white/80 font-medium hover:underline hover:text-white cursor-pointer inline-flex items-center gap-1.5"
                >
                  <User className="w-4 h-4 text-white/60" />
                  <span>{album.artistName}</span>
                </p>
              )}

              <div className="flex items-center justify-center sm:justify-start gap-4 text-xs text-white/60 pt-1">
                <span>
                  {albumTracks.length} {isHe ? 'שירים באלבום' : 'tracks in album'}
                </span>
              </div>

              {/* Play All Album Button */}
              {albumTracks.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => {
                      onPlayTrack(albumTracks[0]);
                    }}
                    className="px-6 py-3 rounded-full bg-white hover:bg-white/90 text-black font-bold text-sm flex items-center justify-center gap-2.5 shadow-xl transition-transform active:scale-95 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-black text-black" />
                    <span>{isHe ? 'נגן אלבום' : 'Play Album'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ALBUM TRACKS LIST */}
          <div className="p-4 sm:p-8 flex-1 overflow-y-auto custom-scrollbar">
            <h2 className="text-sm font-bold text-white/80 mb-4 flex items-center gap-2">
              <Music className="w-4 h-4 text-white/60" />
              <span>{isHe ? 'רשימת השירים באלבום' : 'Tracks in this album'}</span>
            </h2>

            {albumTracks.length === 0 ? (
              <div className="text-center py-12 space-y-2 bg-white/[0.02] rounded-2xl border border-white/10">
                <Music className="w-8 h-8 text-white/30 mx-auto" />
                <p className="text-xs text-white/60">
                  {isHe ? 'אין שירים זמינים באלבום זה' : 'No tracks currently in this album.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {albumTracks.map((track, index) => {
                  const isLiked = likedSongIds.includes(track.id);
                  return (
                    <div
                      key={track.id}
                      onClick={() => onPlayTrack(track)}
                      className="group p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 border border-white/5 hover:border-white/15"
                    >
                      {/* Track index & Cover thumbnail */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-6 text-center text-xs font-bold text-white/40 group-hover:text-white shrink-0">
                          {index + 1}
                        </span>

                        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/10">
                          <TrackCoverArt
                            coverUrl={track.coverUrl}
                            artistName={track.artistName}
                            trackName={track.name}
                            genre={track.genre}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-sm text-white truncate group-hover:text-emerald-400 transition-colors">
                            {track.name}
                          </h3>
                          <p className="text-xs text-white/60 truncate mt-0.5">
                            {track.artistName}
                          </p>
                        </div>
                      </div>

                      {/* Actions: Favorite + Play */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleLike(track.id);
                          }}
                          className="p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                          title={isLiked ? (isHe ? 'נשמר במועדפים' : 'Liked') : (isHe ? 'הוסף למועדפים' : 'Add to Favorites')}
                        >
                          <Heart
                            className={`w-4 h-4 ${
                              isLiked ? 'fill-rose-500 text-rose-500' : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayTrack(track);
                          }}
                          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer border border-white/15"
                          title={isHe ? 'נגן' : 'Play'}
                        >
                          <Play className="w-4 h-4 fill-white text-white translate-x-0.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
