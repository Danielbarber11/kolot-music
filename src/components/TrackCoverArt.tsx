import React, { useState } from 'react';
import { Music, Play } from 'lucide-react';
import { getStreamingMediaUrl } from '../services/cloudStorageService';

interface TrackCoverArtProps {
  coverUrl?: string;
  artistName: string;
  trackName: string;
  genre?: string;
  className?: string;
  showHoverPlay?: boolean;
  priority?: boolean;
}

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
  const imgRef = React.useRef<HTMLImageElement>(null);

  const effectiveUrl = getStreamingMediaUrl(coverUrl);
  const isValidUrl = isAuthenticCover(coverUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasError = !!effectiveUrl && failedUrl === effectiveUrl;

  const handleImgError = () => {
    if (effectiveUrl) {
      setFailedUrl(effectiveUrl);
    }
  };

  if (!isValidUrl || hasError || !effectiveUrl) {
    return (
      <div
        className={`relative aspect-square rounded-xl overflow-hidden bg-neutral-900 border border-white/5 flex flex-col items-center justify-center p-4 text-white select-none ${className}`}
      >
        <div className="relative z-10 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
          <Music className="w-6 h-6 text-white/80" />
        </div>

        {genre && (
          <span className="relative z-10 mt-2.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-black/50 border border-white/10 text-white/80">
            {genre}
          </span>
        )}

        {showHoverPlay && (
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/55 flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100 z-20">
            <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transform group-hover:scale-105 transition-transform">
              <Play className="w-5 h-5 fill-current translate-x-0.5" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`relative aspect-square rounded-xl overflow-hidden bg-neutral-950 ${className}`}>
      <img
        ref={imgRef}
        src={effectiveUrl}
        alt={`${trackName} by ${artistName}`}
        onError={handleImgError}
        className="w-full h-full object-cover opacity-100"
        loading="eager"
        // @ts-expect-error React 18 / 19 fetchPriority attribute support
        fetchpriority={priority ? 'high' : 'auto'}
        decoding={priority ? 'sync' : 'async'}
      />

      {showHoverPlay && (
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 flex items-center justify-center transition-opacity opacity-0 group-hover:opacity-100">
          <div className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-xl transform group-hover:scale-105 transition-transform">
            <Play className="w-4.5 h-4.5 fill-black text-black translate-x-0.5" />
          </div>
        </div>
      )}
    </div>
  );
};
