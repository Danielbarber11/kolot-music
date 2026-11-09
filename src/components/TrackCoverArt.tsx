import React, { useState } from 'react';
import { Music, Play } from 'lucide-react';
import { getStreamingMediaUrl } from '../services/githubStorageService';

interface TrackCoverArtProps {
  coverUrl?: string;
  artistName: string;
  trackName: string;
  genre?: string;
  className?: string;
  showHoverPlay?: boolean;
  priority?: boolean;
}

const GENRE_GRADIENTS: Record<string, string> = {
  Rock: 'from-red-600 via-rose-700 to-amber-700',
  Jazz: 'from-amber-500 via-orange-600 to-amber-800',
  Classical: 'from-indigo-600 via-purple-700 to-slate-900',
  Electronic: 'from-cyan-500 via-teal-600 to-indigo-800',
  Acoustic: 'from-emerald-600 via-teal-700 to-slate-800',
  Pop: 'from-pink-600 via-fuchsia-600 to-purple-700',
  Blues: 'from-blue-600 via-indigo-700 to-slate-900',
  Chill: 'from-teal-500 via-indigo-600 to-slate-900',
  Cinematic: 'from-violet-700 via-purple-800 to-slate-950',
};

// Check if URL is a valid non-empty cover image URL
export const isAuthenticCover = (url?: string): boolean => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed.length > 0;
};

export const TrackCoverArt: React.FC<TrackCoverArtProps> = ({
  coverUrl,
  artistName,
  trackName,
  genre = 'Pop',
  className = 'w-full h-full',
  showHoverPlay = true,
  priority = false,
}) => {
  const [hasError, setHasError] = useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [coverUrl]);

  const effectiveUrl = getStreamingMediaUrl(coverUrl);
  const isValidUrl = isAuthenticCover(coverUrl);
  const gradient = GENRE_GRADIENTS[genre] || GENRE_GRADIENTS['Pop'];

  const [currentSrc, setCurrentSrc] = useState(effectiveUrl);

  React.useEffect(() => {
    setHasError(false);
    setCurrentSrc(getStreamingMediaUrl(coverUrl));
  }, [coverUrl]);

  const handleImgError = () => {
    // If jsDelivr CDN fails, attempt raw.githubusercontent.com fallback before giving up
    if (currentSrc && currentSrc.includes('cdn.jsdelivr.net/gh/')) {
      const match = currentSrc.match(/cdn\.jsdelivr\.net\/gh\/([^/@]+)\/([^/@]+)@([^/]+)\/(.*)/);
      if (match) {
        const [, owner, repo, branch, path] = match;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        if (currentSrc !== rawUrl) {
          setCurrentSrc(rawUrl);
          return;
        }
      }
    }
    setHasError(true);
  };

  if (!isValidUrl || hasError || !currentSrc) {
    return (
      <div
        className={`relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br ${gradient} flex flex-col items-center justify-center p-4 text-white shadow-inner select-none ${className}`}
      >
        {/* Subtle Vinyl Grooves */}
        <div className="absolute inset-0 opacity-15 pointer-events-none">
          <div className="absolute inset-4 rounded-full border border-white/40" />
          <div className="absolute inset-8 rounded-full border border-white/30" />
          <div className="absolute inset-12 rounded-full border border-white/20" />
        </div>

        {/* Central Music Badge with Musical Note */}
        <div className="relative z-10 w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/20 backdrop-blur-xl border border-white/30 flex items-center justify-center shadow-2xl">
          <Music className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow-lg" />
        </div>

        {/* Genre Label */}
        <span className="relative z-10 mt-3 text-[10px] sm:text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-black/30 backdrop-blur-md border border-white/20 text-white/95">
          {genre}
        </span>

        {/* Hover Play Button */}
        {showHoverPlay && (
          <div className="absolute inset-0 bg-slate-950/40 group-hover:bg-slate-950/50 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 z-20 backdrop-blur-[1px]">
            <div className="w-10 h-10 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-2xl transform group-hover:scale-110 transition-transform">
              <Play className="w-5 h-5 fill-current translate-x-0.5" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br ${gradient} ${className}`}>
      <img
        src={currentSrc}
        alt={`${trackName} by ${artistName}`}
        onError={handleImgError}
        className="w-full h-full object-cover transition-transform duration-300"
        loading={priority ? 'eager' : 'lazy'}
        // @ts-expect-error React 18 / 19 fetchPriority attribute support
        fetchpriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
      />

      {showHoverPlay && (
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
          <div className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-xl transform group-hover:scale-110 transition-transform">
            <Play className="w-4.5 h-4.5 fill-black text-black translate-x-0.5" />
          </div>
        </div>
      )}
    </div>
  );
};
