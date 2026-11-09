import React from 'react';
import { User } from 'lucide-react';

interface ArtistAvatarProps {
  url?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const AVATAR_SIZES = {
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-16 h-16 sm:w-20 sm:h-20 text-sm',
  xl: 'w-24 h-24 sm:w-32 sm:h-32 text-base',
};

const ICON_SIZES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-8 h-8 sm:w-10 sm:h-10',
  xl: 'w-12 h-12 sm:w-16 sm:h-16',
};

export const ArtistAvatar: React.FC<ArtistAvatarProps> = ({
  url,
  name,
  size = 'md',
  className = '',
}) => {
  const [hasError, setHasError] = React.useState(false);

  // Generate a stable background color based on artist name
  const getBackgroundColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `hsl(${h}, 65%, 45%)`;
  };

  const bgColor = getBackgroundColor(name);

  // Check if URL is a known placeholder
  const isPlaceholder = url?.includes('unsplash.com') || url?.includes('placeholder');

  if (!url || hasError || isPlaceholder) {
    return (
      <div
        className={`flex-shrink-0 rounded-full flex items-center justify-center border-2 border-white/20 shadow-xl overflow-hidden ${AVATAR_SIZES[size]} ${className}`}
        style={{
          background: `linear-gradient(135deg, ${bgColor}, rgba(15, 23, 42, 0.9))`,
        }}
      >
        <div className="absolute inset-0 bg-white/5 backdrop-blur-[2px]" />
        <User className={`${ICON_SIZES[size]} text-white/90 relative z-10 drop-shadow-md`} />
      </div>
    );
  }

  return (
    <div className={`flex-shrink-0 rounded-full overflow-hidden border-2 border-white/20 shadow-xl bg-slate-900 ${AVATAR_SIZES[size]} ${className}`}>
      <img
        src={url}
        alt={name}
        onError={() => setHasError(true)}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
};
