import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Heart,
  User,
  Plus,
  ChevronLeft,
  ChevronRight,
  Globe,
  Library,
  Flame,
  Radio,
  SlidersHorizontal,
  FolderPlus,
  Compass,
  Sparkles,
  Disc,
  Play,
  LogIn,
  UserPlus,
  Wand2,
  Loader2,
  Music,
  Mic,
  Guitar,
  Headphones,
  Film,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, Album, CURRENT_TERMS_VERSION } from '../types';
import {
  fetchAllRealSongs,
  getInstantSongPool,
  getInstantSongPoolAsync,
  fetchLiveAudioFromArchive,
  deduplicateTracks,
  searchModern21stCenturyTracks,
  fetchAllArtistProfiles,
  getCachedArtistProfiles,
  fetchRealAlbums,
  getCachedAlbums,
  checkTermsAcceptedInR2,
  saveTermsAcceptedToR2,
  getArtistAccountByUid,
  saveArtistAccountToR2,
  upsertMemoryArtistProfile,
  removeMemoryArtistProfile,
  updateMemoryTracksArtistAvatar,
  isValidTrackWithOwner,
  TRACK_VIEWS_UPDATED_EVENT,
  TRACK_UPDATED_EVENT,
  TRACK_DELETED_EVENT,
  ALBUMS_UPDATED_EVENT,
} from '../services/multiMusicService';
import { SongPlayerPage } from './SongPlayerPage';
import { activateIosPlaybackSession } from '../services/iosAudioHelper';
import { TrackCoverArt, isAuthenticCover } from './TrackCoverArt';
import { ArtistPortalModal } from './ArtistPortalModal';
import { ArtistProfileModal } from './ArtistProfileModal';
import { AlbumModal } from './AlbumModal';
import { Logo } from './Logo';
import { TermsModal } from './TermsModal';
import { Footer, TermsReaderModal } from './Footer';
import { CookieBanner } from './CookieBanner';
import { DevToolsProtection } from './DevToolsProtection';
import { AuthModal } from './AuthModal';
import { AccessibilityIcon } from './AccessibilityPage';
import {
  AuthUser,
  onAuthUserChanged,
  loginWithGoogle,
  updateCurrentAuthUserProfile,
  getEffectiveUserAvatar,
  getEffectiveArtistAvatarForTrack,
  getGoogleAccountPhotoUrl,
} from '../services/authService';
import { prewarmTrackColor, getFormattedPlayCount, getTrackInstantColor } from '../services/colorService';
import { removeTrackFromStorage } from '../services/localTrackStorage';
import { deleteTrackFromCloud, getStreamingMediaUrl, saveTrackGenreInCloud } from '../services/cloudStorageService';
import {
  CANONICAL_GENRES,
  normalizeGenreId,
  getGenreDisplayLabel,
  isUntaggedGenre,
  classifyTrackAudio,
} from '../services/audioClassificationService';
import { saveCachedCloudTracks } from '../services/multiMusicService';
import { markSongAsDeleted } from '../services/deletedTracksService';
import { useNetworkHealth } from '../services/networkHealthService';
import {
  getUserFavorites,
  toggleUserFavorite,
  syncUserFavoritesWithCloud,
  FAVORITES_CHANGED_EVENT,
} from '../services/favoritesService';
import { trackSearchQuery, trackEvent } from '../services/analyticsService';

const renderCategoryIcon = (genreId: string, className = 'w-3.5 h-3.5 text-white shrink-0') => {
  switch (genreId) {
    case 'Mizrahi':
      return <Flame className={className} />;
    case 'Pop':
      return <Sparkles className={className} />;
    case 'Hip Hop':
      return <Mic className={className} />;
    case 'Rock':
      return <Guitar className={className} />;
    case 'Electronic':
      return <Radio className={className} />;
    case 'Chill':
      return <Headphones className={className} />;
    case 'Cinematic':
      return <Film className={className} />;
    case 'Classical':
    case 'Jazz':
    case 'Blues':
      return <Disc className={className} />;
    case 'Acoustic':
    default:
      return <Music className={className} />;
  }
};

const ArtistCircleImage: React.FC<{
  src?: string;
  alt: string;
  className?: string;
  fallbackIconClassName?: string;
}> = ({ src, alt, className = 'w-full h-full object-cover', fallbackIconClassName = 'w-12 h-12 text-white/40' }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showFallback = !src || failedSrc === src;

  if (showFallback) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/40 bg-neutral-900">
        <User className={fallbackIconClassName} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="eager"
      decoding="sync"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
};

interface SongsViewProps {
  lang: Language;
  initialTracks?: JamendoTrack[];
  initialArtists?: ArtistProfile[];
  initialAlbums?: Album[];
  onTracksSync?: (tracks: JamendoTrack[]) => void;
  onArtistsSync?: (artists: ArtistProfile[]) => void;
  onAlbumsSync?: (albums: Album[]) => void;
  onNavigateHome: () => void;
  onPlayTrack?: (track: JamendoTrack, albumContext?: Album | null) => void;
  onOpenAccessibility?: () => void;
  activeAccessibilityCount?: number;
}

export const SongsView: React.FC<SongsViewProps> = ({
  lang,
  initialTracks = [],
  initialArtists = [],
  initialAlbums = [],
  onTracksSync,
  onArtistsSync,
  onAlbumsSync,
  onPlayTrack,
  onOpenAccessibility,
  activeAccessibilityCount = 0,
}) => {
  const isHe = lang === 'he';

  const [activeArtistProfile, setActiveArtistProfile] = useState<ArtistProfile | null>(null);

  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'leading'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const mainFeedRef = useRef<HTMLElement>(null);
  const [isBulkClassifying, setIsBulkClassifying] = useState(false);
  const [bulkClassifyNotice, setBulkClassifyNotice] = useState<string | null>(null);

  const [isArtistPortalOpen, setIsArtistPortalOpen] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showLegalTermsModal, setShowLegalTermsModal] = useState(false);
  const [showPromoBanner, setShowPromoBanner] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [authModalError, setAuthModalError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const networkHealth = useNetworkHealth();
  const [dismissedWeakNetBanner, setDismissedWeakNetBanner] = useState(false);

  useEffect(() => {
    if (networkHealth.status === 'good') {
      setDismissedWeakNetBanner(false);
    }
  }, [networkHealth.status]);

  const openLoginModal = () => {
    setAuthModalMode('login');
    setAuthModalError(null);
    setIsAuthModalOpen(true);
  };

  const openRegisterModal = () => {
    setAuthModalMode('register');
    setIsAuthModalOpen(true);
  };

  // Helper to pause any background playing audio when entering profile screens
  const stopAllGlobalAudio = () => {
    try {
      document.querySelectorAll('audio').forEach((a) => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch (err) {}
      });
    } catch (err) {}
  };

  const handleProfileClick = () => {
    stopAllGlobalAudio();
    setIsArtistPortalOpen(true);
  };

  const handleGoogleSignInClick = async () => {
    setAuthModalError(null);
    try {
      const user = await loginWithGoogle();
      if (user) {
        setAuthUser(user);
        setIsArtistPortalOpen(true);
      }
    } catch (e: any) {
      const msg =
        e?.message ||
        (isHe
          ? 'לא ניתן היה לפתוח את חלון ההתחברות עם Google. אפשר חלונות קופצים ונסה שוב.'
          : 'Could not complete Google Sign-In. Please allow popups and try again.');
      setAuthModalError(msg);
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
    }
  };

  // Auth & Versioned Terms Gate (100% Cloudflare R2 Profiles + Server-Side Google OAuth)
  useEffect(() => {
    const unsub = onAuthUserChanged(async (user) => {
      setAuthUser(user);
      if (user) {
        setIsAuthModalOpen(false);

        const [hasAccepted, remoteProfile] = await Promise.all([
          checkTermsAcceptedInR2(user.uid),
          getArtistAccountByUid(user.uid).catch(() => null),
        ]);

        setShowTermsModal(!hasAccepted);

        if (remoteProfile) {
          const googlePhoto = getGoogleAccountPhotoUrl(user);
          const mergedProfile: ArtistProfile = {
            ...remoteProfile,
            avatarUrl: remoteProfile.avatarUrl || googlePhoto,
          };
          setActiveArtistProfile(mergedProfile);
          upsertMemoryArtistProfile(mergedProfile);
        } else {
          const draftProfile: ArtistProfile = {
            id: user.uid,
            name: user.displayName || (isHe ? 'אמן' : 'Artist'),
            avatarUrl: getGoogleAccountPhotoUrl(user),
            googleUid: user.uid,
            isConnected: true,
            hasAcceptedTerms: hasAccepted,
            termsVersionAccepted: hasAccepted ? CURRENT_TERMS_VERSION : 0,
            isPrivate: false,
            tracksCount: 0,
            providerPlatform: isHe ? 'חשבון Google' : 'Google Account',
            joinedDate: new Date().getFullYear().toString(),
          };
          setActiveArtistProfile(draftProfile);
          upsertMemoryArtistProfile(draftProfile);
          if (hasAccepted) {
            saveArtistAccountToR2(draftProfile).catch(() => {});
          }
        }
      } else {
        setActiveArtistProfile(null);
        setShowTermsModal(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('terms') === 'true') {
        setShowLegalTermsModal(true);
      }
    } catch {}
  }, []);

  const handleCloseLegalTerms = () => {
    setShowLegalTermsModal(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('terms') === 'true') {
        url.searchParams.delete('terms');
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState(null, '', nextUrl);
      }
    } catch {}
  };

  const handleAcceptTerms = async () => {
    setShowTermsModal(false);
    try {
      localStorage.setItem('kolot_cookie_consent_accepted', 'true');
    } catch {}
    if (!authUser) return;

    const savedProfile = await saveTermsAcceptedToR2(
      authUser.uid,
      authUser.displayName || 'אמן',
      getGoogleAccountPhotoUrl(authUser)
    );
    if (savedProfile) {
      setActiveArtistProfile(savedProfile);
      upsertMemoryArtistProfile(savedProfile);
    } else {
      const updated: ArtistProfile = {
        ...(activeArtistProfile || {}),
        id: authUser.uid,
        name: activeArtistProfile?.name || authUser.displayName || (isHe ? 'אמן' : 'Artist'),
        avatarUrl: activeArtistProfile?.avatarUrl || getGoogleAccountPhotoUrl(authUser),
        googleUid: authUser.uid,
        isConnected: true,
        hasAcceptedTerms: true,
        termsVersionAccepted: CURRENT_TERMS_VERSION,
        acceptedTermsAt: new Date().toISOString(),
        isPrivate: activeArtistProfile?.isPrivate ?? false,
        tracksCount: activeArtistProfile?.tracksCount ?? 0,
        providerPlatform: 'חשבון גוגל',
      };
      setActiveArtistProfile(updated);
      upsertMemoryArtistProfile(updated);
    }
  };

  // Search mode & results
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const mobileTopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchBarRef = useRef<HTMLDivElement>(null);
  const mobileSearchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Automatically close top mobile search bar when device virtual keyboard closes or focus leaves
  useEffect(() => {
    if (!isMobileSearchOpen) return;

    const openedAt = Date.now();
    let minViewportHeight = window.visualViewport?.height ?? window.innerHeight;
    let keyboardObservedOpen = false;
    const baselineHeight = window.innerHeight;

    const closeMobileSearch = () => {
      setIsMobileSearchOpen(false);
      mobileTopSearchRef.current?.blur();
    };

    const handleVisualViewportResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      if (vv.height < minViewportHeight) {
        minViewportHeight = vv.height;
      }
      if (baselineHeight - vv.height > 110) {
        keyboardObservedOpen = true;
      }
      // Keyboard closed/hidden (viewport expanded back >= 100px from shrunk height)
      if (keyboardObservedOpen && vv.height - minViewportHeight > 100 && Date.now() - openedAt > 250) {
        closeMobileSearch();
      }
    };

    const handlePointerDownOutside = (e: PointerEvent) => {
      if (
        mobileSearchBarRef.current &&
        e.target instanceof Node &&
        !mobileSearchBarRef.current.contains(e.target)
      ) {
        closeMobileSearch();
      }
    };

    window.visualViewport?.addEventListener('resize', handleVisualViewportResize);
    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => {
      window.visualViewport?.removeEventListener('resize', handleVisualViewportResize);
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      if (mobileSearchBlurTimerRef.current) {
        clearTimeout(mobileSearchBlurTimerRef.current);
        mobileSearchBlurTimerRef.current = null;
      }
    };
  }, [isMobileSearchOpen]);

  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [profileArtistName, setProfileArtistName] = useState<string | null>(null);
  const [profileArtistUid, setProfileArtistUid] = useState<string | undefined>(undefined);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);

  const openArtistProfile = (name: string, uid?: string) => {
    setProfileArtistName(name);
    setProfileArtistUid(uid);
  };

  const closeArtistProfile = () => {
    setProfileArtistName(null);
    setProfileArtistUid(undefined);
  };

  // Song Pool (Filtered strictly for tracks with authentic account owners)
  const [allTracks, setAllTracks] = useState<JamendoTrack[]>(() =>
    (initialTracks.length > 0 ? initialTracks : getInstantSongPool()).filter(isValidTrackWithOwner)
  );
  const [allArtists, setAllArtists] = useState<ArtistProfile[]>(() =>
    initialArtists.length > 0 ? initialArtists : getCachedArtistProfiles()
  );
  const [remoteAlbums, setRemoteAlbums] = useState<Album[]>(() =>
    initialAlbums.length > 0 ? initialAlbums : getCachedAlbums()
  );
  const [visibleSearchCount] = useState(150);

  // Account-Only Favorites
  const [likedSongIds, setLikedSongIds] = useState<string[]>([]);

  useEffect(() => {
    setLikedSongIds(authUser?.uid ? getUserFavorites(authUser.uid) : []);
    if (authUser?.uid) {
      void syncUserFavoritesWithCloud(authUser.uid);
    }
    const handleSync = () => {
      setLikedSongIds(authUser?.uid ? getUserFavorites(authUser.uid) : []);
    };
    window.addEventListener(FAVORITES_CHANGED_EVENT, handleSync);
    return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, handleSync);
  }, [authUser?.uid]);

  // Randomized Spotlight Track Index on every site entry
  const [featuredTrackIndex] = useState<number>(() => Math.floor(Math.random() * 12));
  const [pinnedFeaturedTrackId, setPinnedFeaturedTrackId] = useState<string | null>(null);

  // Active playing song overlay (if not passed via onPlayTrack)
  const [playerTrack, setPlayerTrack] = useState<JamendoTrack | null>(null);
  const [playerAlbumContext, setPlayerAlbumContext] = useState<Album | null>(null);

  // Sync preloaded App.tsx data cleanly without a 1-second empty flash
  useEffect(() => {
    if (initialTracks.length > 0) {
      const valid = initialTracks.filter(isValidTrackWithOwner);
      if (valid.length > 0) {
        setAllTracks((prev) => (prev.length === 0 ? valid : deduplicateTracks([...valid, ...prev])));
        valid.slice(0, 10).forEach((t) => prewarmTrackColor(t));
      }
    }
  }, [initialTracks]);

  useEffect(() => {
    if (initialArtists.length > 0) {
      setAllArtists((prev) => (prev.length === 0 || initialArtists.length >= prev.length ? initialArtists : prev));
    }
  }, [initialArtists]);

  useEffect(() => {
    if (initialAlbums.length > 0) {
      setRemoteAlbums((prev) => (prev.length === 0 || initialAlbums.length >= prev.length ? initialAlbums : prev));
    }
  }, [initialAlbums]);

  // Mount effect - Independent progressive Cloud Load (< 1s first paint, zero Promise.all blocking)
  useEffect(() => {
    let active = true;

    fetchAllRealSongs(undefined, (batch) => {
      if (!active) return;
      const valid = (batch || []).filter(isValidTrackWithOwner);
      if (valid.length > 0) {
        setAllTracks(valid);
        onTracksSync?.(valid);
      }
    })
      .then((finalSongs) => {
        if (!active) return;
        const validSongs = (finalSongs || []).filter(isValidTrackWithOwner);
        setAllTracks(validSongs);
        onTracksSync?.(validSongs);
      })
      .catch(() => {});

    fetchAllArtistProfiles()
      .then((profiles) => {
        if (!active || !Array.isArray(profiles)) return;
        setAllArtists(profiles);
        onArtistsSync?.(profiles);
      })
      .catch(() => {});

    fetchRealAlbums()
      .then((albums) => {
        if (!active || !Array.isArray(albums)) return;
        if (albums.length > 0) {
          setRemoteAlbums(albums);
          onAlbumsSync?.(albums);
        }
      })
      .catch(() => {});

    let lastRefreshAt = Date.now();
    const refreshFromCloud = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefreshAt < 2500) return;
      lastRefreshAt = now;
      fetchAllRealSongs()
        .then((freshSongs) => {
          if (!active || !Array.isArray(freshSongs)) return;
          const valid = freshSongs.filter(isValidTrackWithOwner);
          if (valid.length > 0) {
            setAllTracks(valid);
            onTracksSync?.(valid);
            setPlayerTrack((cur) => {
              if (!cur) return cur;
              const match = valid.find((t) => t.id === cur.id);
              return match ? { ...cur, ...match } : cur;
            });
          }
        })
        .catch(() => {});
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        refreshFromCloud(false);
      }
    };

    const handleViewsUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ trackId?: string; viewsCount?: number; authoritative?: boolean }>)?.detail;
      const trackId = detail?.trackId;
      const serverViews = Number(detail?.viewsCount);
      if (!trackId || !Number.isFinite(serverViews) || serverViews < 0 || !active) return;
      const isAuthoritative = detail?.authoritative !== false;

      setAllTracks((prev) => {
        if (!prev.some((t) => t.id === trackId)) return prev;
        const next = prev.map((t) =>
          t.id === trackId
            ? {
                ...t,
                viewsCount: isAuthoritative
                  ? serverViews
                  : Math.max(Number(t.viewsCount) || 0, serverViews),
              }
            : t
        );
        saveCachedCloudTracks(next);
        onTracksSync?.(next);
        return next;
      });
      setPlayerTrack((cur) =>
        cur && cur.id === trackId
          ? {
              ...cur,
              viewsCount: isAuthoritative
                ? serverViews
                : Math.max(Number(cur.viewsCount) || 0, serverViews),
            }
          : cur
      );
    };

    const handleTrackUpdated = (ev: Event) => {
      const updated = (ev as CustomEvent<JamendoTrack>)?.detail;
      if (!updated?.id || !active) return;

      setAllTracks((prev) => {
        const next = deduplicateTracks([updated, ...prev]);
        saveCachedCloudTracks(next);
        onTracksSync?.(next);
        return next;
      });
      setPlayerTrack((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
    };

    const handleTrackDeleted = (ev: Event) => {
      const deletedId = (ev as CustomEvent<{ trackId?: string }>)?.detail?.trackId;
      if (!deletedId || !active) return;
      setAllTracks((prev) => {
        const next = prev.filter((t) => t.id !== deletedId);
        saveCachedCloudTracks(next);
        onTracksSync?.(next);
        return next;
      });
    };

    const handleAlbumsUpdated = (ev: Event) => {
      if (!active) return;
      const detail = (ev as CustomEvent<{ albums?: Album[] }>)?.detail;
      const nextAlbums = Array.isArray(detail?.albums) ? detail.albums : getCachedAlbums();
      setRemoteAlbums(nextAlbums);
      onAlbumsSync?.(nextAlbums);
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener(TRACK_VIEWS_UPDATED_EVENT, handleViewsUpdated);
    window.addEventListener(TRACK_UPDATED_EVENT, handleTrackUpdated);
    window.addEventListener(TRACK_DELETED_EVENT, handleTrackDeleted);
    window.addEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener(TRACK_VIEWS_UPDATED_EVENT, handleViewsUpdated);
      window.removeEventListener(TRACK_UPDATED_EVENT, handleTrackUpdated);
      window.removeEventListener(TRACK_DELETED_EVENT, handleTrackDeleted);
      window.removeEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);
    };
  }, []);

  const openSongPlayer = (track: JamendoTrack, albumContext?: Album | null) => {
    activateIosPlaybackSession();
    prewarmTrackColor(track);
    if (onPlayTrack) {
      onPlayTrack(track, albumContext ?? null);
    } else {
      setPlayerAlbumContext(albumContext ?? null);
      setPlayerTrack(track);
    }
  };

  const closeSongPlayer = () => {
    setPlayerTrack(null);
    setPlayerAlbumContext(null);
  };

  const toggleFavorite = (id: string) => {
    if (!authUser?.uid) {
      setAuthModalError(
        isHe
          ? 'שמירת שירים במועדפים זמינה למשתמשים מחוברים בלבד. התחבר עם Google כדי לשמור שירים.'
          : 'Saving songs to Favorites is available to signed-in users only. Sign in with Google to continue.'
      );
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
      return;
    }
    const res = toggleUserFavorite(authUser.uid, id);
    if (res.allowed) {
      setLikedSongIds(res.likedIds);
    }
  };

  // Modern live search debounce
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    const term = searchQuery.trim();

    const timer = setTimeout(async () => {
      trackSearchQuery(term);
      try {
        const modernResults = await searchModern21stCenturyTracks(term, 24);
        if (modernResults.length > 0) {
          setAllTracks((prev) => deduplicateTracks([...modernResults, ...prev]));
        }
      } catch (err) {
        console.warn('Live modern search failed:', err);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (mainFeedRef.current) {
      mainFeedRef.current.scrollTop = 0;
    }
  }, [activeTab, selectedGenre, artistFilter, searchQuery]);

  // Popularity heuristic (views + plays count + deterministic name hash — independent of user favorites)
  const getTrackPopularity = React.useCallback((t: JamendoTrack) => {
    const views = Number(t.viewsCount) || 0;
    const plays = Number(t.playsCount) || 0;
    let hash = 0;
    for (let i = 0; i < t.name.length; i++) {
      hash = (hash * 17 + t.name.charCodeAt(i)) % 40;
    }
    return views * 2 + plays + hash;
  }, []);

  const displayedTracks = React.useMemo(() => {
    let list = allTracks.filter(isValidTrackWithOwner);
    if (activeTab === 'favorites') {
      list = list.filter((t) => likedSongIds.includes(t.id));
    }
    if (artistFilter) {
      list = list.filter((t) => t.artistName.toLowerCase().includes(artistFilter.toLowerCase()));
    }
    if (selectedGenre) {
      const normSelected = normalizeGenreId(selectedGenre) || selectedGenre.toLowerCase();
      list = list.filter((t) => {
        const trackNorm = normalizeGenreId(t.genre);
        return trackNorm.toLowerCase() === normSelected.toLowerCase() || (t.genre || '').toLowerCase() === selectedGenre.toLowerCase();
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.artistName.toLowerCase().includes(q) ||
          t.genre?.toLowerCase().includes(q) ||
          getGenreDisplayLabel(t.genre, true).toLowerCase().includes(q)
      );
    }
    if (activeTab === 'leading') {
      list = [...list].sort((a, b) => getTrackPopularity(b) - getTrackPopularity(a));
    }
    return list;
  }, [allTracks, activeTab, likedSongIds, artistFilter, selectedGenre, searchQuery, getTrackPopularity]);

  const validTracksList = React.useMemo(
    () => allTracks.filter(isValidTrackWithOwner),
    [allTracks]
  );

  // Strict discovery filter: users with 0 uploaded tracks NEVER appear publicly to other users
  const publishedArtists = React.useMemo(() => {
    const uidCount = new Map<string, number>();
    const ownerlessNameCount = new Map<string, number>();

    validTracksList.forEach((t) => {
      const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
      const tName = (t.artistName || '').toLowerCase().trim();
      if (tUid) {
        uidCount.set(tUid, (uidCount.get(tUid) || 0) + 1);
      } else if (tName) {
        ownerlessNameCount.set(tName, (ownerlessNameCount.get(tName) || 0) + 1);
      }
    });

    return allArtists.filter((a) => {
      if (!a.name?.trim()) return false;
      const aUid = (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim();
      const aName = a.name.toLowerCase().trim();
      if (aUid && (uidCount.get(aUid) || 0) > 0) return true;
      if (!aUid && aName && (ownerlessNameCount.get(aName) || 0) > 0) return true;
      return false;
    });
  }, [allArtists, validTracksList]);

  const searchArtistResults = searchQuery.trim()
    ? publishedArtists.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : publishedArtists;

  // Extract unique popular artists keyed canonically by UID first, then normalized name
  const popularArtists = React.useMemo(() => {
    const map = new Map<string, { uid?: string; name: string; avatarUrl?: string; genre?: string; count: number }>();

    publishedArtists.forEach((a) => {
      if (a.name) {
        const cleanUid = (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim();
        const nameKey = a.name.toLowerCase().trim();
        const key = cleanUid || nameKey;
        const trackWithAvatar = validTracksList.find((t) => {
          const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
          return (
            ((cleanUid && tUid === cleanUid) || (!tUid && t.artistName?.toLowerCase().trim() === nameKey)) &&
            !!t.artistAvatarUrl
          );
        });
        const resolved = getStreamingMediaUrl(a.avatarUrl || trackWithAvatar?.artistAvatarUrl);

        map.set(key, {
          uid: a.googleUid || a.id,
          name: a.name,
          avatarUrl: resolved || undefined,
          genre: a.genre || 'אמן',
          count: 0,
        });
      }
    });

    validTracksList.forEach((t) => {
      if (!t.artistName) return;
      const cleanUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
      const nameKey = t.artistName.toLowerCase().trim();
      const key = cleanUid && map.has(cleanUid) ? cleanUid : cleanUid || nameKey;
      const trackAvatar = getStreamingMediaUrl(t.artistAvatarUrl);

      if (!map.has(key)) {
        const byNameEntry = !cleanUid
          ? Array.from(map.values()).find((v) => v.name.toLowerCase().trim() === nameKey)
          : undefined;
        if (byNameEntry) {
          byNameEntry.count += 1;
          if (!byNameEntry.avatarUrl && trackAvatar) byNameEntry.avatarUrl = trackAvatar;
          if (!byNameEntry.uid && t.uploadedByUid) byNameEntry.uid = t.uploadedByUid;
          return;
        }
        map.set(key, {
          uid: t.uploadedByUid,
          name: t.artistName,
          avatarUrl: trackAvatar || undefined,
          genre: t.genre || 'אמן',
          count: 1,
        });
      } else {
        const existing = map.get(key)!;
        existing.count += 1;
        if (!existing.avatarUrl && trackAvatar) {
          existing.avatarUrl = trackAvatar;
        }
      }
    });

    return Array.from(map.values())
      .filter((artist) => artist.count >= 1)
      .slice(0, 15);
  }, [publishedArtists, validTracksList]);

  // Row 1: Leading tracks sorted by highest plays and popularity (never shifts on favorite toggle)
  const leadingTracks = React.useMemo(() => {
    return [...allTracks].filter(isValidTrackWithOwner).sort((a, b) => getTrackPopularity(b) - getTrackPopularity(a));
  }, [allTracks, getTrackPopularity]);

  // Pin spotlight featured track once chosen so liking or background count updates never swap or hide it
  const featuredTrack = React.useMemo(() => {
    if (leadingTracks.length === 0) return undefined;
    if (pinnedFeaturedTrackId) {
      const pinned = leadingTracks.find((t) => t.id === pinnedFeaturedTrackId);
      if (pinned) return pinned;
    }
    return leadingTracks[featuredTrackIndex % leadingTracks.length] || leadingTracks[0];
  }, [leadingTracks, pinnedFeaturedTrackId, featuredTrackIndex]);

  useEffect(() => {
    if (featuredTrack?.id && !pinnedFeaturedTrackId) {
      setPinnedFeaturedTrackId(featuredTrack.id);
    }
  }, [featuredTrack?.id, pinnedFeaturedTrackId]);

  // Row 2: Recommended albums synthesized purely from R2 cloud albums and cloud tracks
  const popularAlbums = React.useMemo(() => {
    const albumMap = new Map<string, Album>();
    const trackOwnerById = new Map<string, string>();
    allTracks.forEach((t) => {
      if (t?.id) {
        trackOwnerById.set(t.id, (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim());
      }
    });

    remoteAlbums.forEach((a) => {
      if (a.title && a.id) {
        const albOwner = (a.uploadedByUid || a.artistId || '').replace(/^artist_/, '').toLowerCase().trim();
        const key = `${albOwner || (a.artistName || '').toLowerCase().trim()}::${a.title.toLowerCase().trim()}`;
        const filteredTrackIds = Array.isArray(a.trackIds)
          ? a.trackIds.filter((tid) => {
              const tOwn = trackOwnerById.get(tid);
              return !albOwner || !tOwn || tOwn === albOwner;
            })
          : [];
        albumMap.set(key, { ...a, trackIds: filteredTrackIds });
      }
    });

    const invalidAlbumNames = new Set([
      'single',
      'single release',
      'unknown album',
      'סינגל',
      'סינגל עצמאי',
      'ללא אלבום',
      'independent single',
      'none',
    ]);

    allTracks.forEach((t) => {
      const cleanAlbumName = (t.albumName || '').trim();
      const lower = cleanAlbumName.toLowerCase();
      if (
        cleanAlbumName &&
        !invalidAlbumNames.has(lower) &&
        !lower.startsWith('סינגל') &&
        !lower.startsWith('single')
      ) {
        const tOwner = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
        const ownerOrArtistKey = tOwner || (t.artistName || '').toLowerCase().trim();
        const key = `${ownerOrArtistKey}::${lower}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `album-${t.id}`,
            title: cleanAlbumName,
            artistName: t.artistName,
            artistId: t.uploadedByUid,
            uploadedByUid: t.uploadedByUid,
            coverUrl: t.coverUrl,
            trackIds: [t.id],
            createdDate: t.publishedDate || new Date().toISOString(),
          });
        } else {
          const alb = albumMap.get(key)!;
          if (!alb.trackIds.includes(t.id)) {
            alb.trackIds = [...alb.trackIds, t.id];
          }
          if (!alb.coverUrl && t.coverUrl) {
            alb.coverUrl = t.coverUrl;
          }
        }
      }
    });

    return Array.from(albumMap.values()).filter((a) => {
      const lower = (a.title || '').toLowerCase().trim();
      if (invalidAlbumNames.has(lower) || lower.startsWith('סינגל') || lower.startsWith('single')) return false;
      return Array.isArray(a.trackIds) && a.trackIds.length > 0;
    });
  }, [allTracks, remoteAlbums]);

  const searchAlbumResults = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [] as Album[];
    return popularAlbums.filter(
      (alb) =>
        alb.title.toLowerCase().includes(q) ||
        (alb.artistName && alb.artistName.toLowerCase().includes(q))
    );
  }, [popularAlbums, searchQuery]);

  // Organized, Audio-Classified Genre Collections (Pure canonical genre matching)
  const validHomeTracks = React.useMemo(() => allTracks.filter(isValidTrackWithOwner), [allTracks]);

  const newReleasesTracks = React.useMemo(() => {
    return validHomeTracks.slice(0, 14);
  }, [validHomeTracks]);

  const mizrahiTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => normalizeGenreId(t.genre) === 'Mizrahi');
  }, [validHomeTracks]);

  const popTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => normalizeGenreId(t.genre) === 'Pop');
  }, [validHomeTracks]);

  const hipHopTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => normalizeGenreId(t.genre) === 'Hip Hop');
  }, [validHomeTracks]);

  const rockTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => normalizeGenreId(t.genre) === 'Rock');
  }, [validHomeTracks]);

  const chillTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => {
      const g = normalizeGenreId(t.genre);
      return g === 'Chill' || g === 'Electronic';
    });
  }, [validHomeTracks]);

  const acousticClassicTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => {
      const g = normalizeGenreId(t.genre);
      return g === 'Acoustic' || g === 'Classical' || g === 'Jazz' || g === 'Blues' || g === 'Cinematic';
    });
  }, [validHomeTracks]);

  const untaggedTracks = React.useMemo(() => {
    return validHomeTracks.filter((t) => isUntaggedGenre(t.genre));
  }, [validHomeTracks]);

  const genreCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    validHomeTracks.forEach((t) => {
      const g = normalizeGenreId(t.genre);
      if (g) counts[g] = (counts[g] || 0) + 1;
    });
    return counts;
  }, [validHomeTracks]);

  const handleBulkClassifyUntagged = async () => {
    if (isBulkClassifying || untaggedTracks.length === 0) return;
    setIsBulkClassifying(true);
    setBulkClassifyNotice(isHe ? `מאזין ומסווג ${untaggedTracks.length} שירים אוטומטית...` : `Classifying ${untaggedTracks.length} tracks...`);
    let updatedCount = 0;
    const targets = untaggedTracks.slice(0, 12);

    for (const track of targets) {
      try {
        const res = await classifyTrackAudio({ track });
        if (res.success && res.genre) {
          updatedCount += 1;
          const updatedTrack: JamendoTrack = { ...track, genre: res.genre };
          setAllTracks((prev) => {
            const next = prev.map((item) => (item.id === track.id ? updatedTrack : item));
            saveCachedCloudTracks(next);
            return next;
          });
          await saveTrackGenreInCloud(updatedTrack, res.genre);
        }
      } catch {}
    }

    setIsBulkClassifying(false);
    setBulkClassifyNotice(
      updatedCount > 0
        ? (isHe ? `סווגו ${updatedCount} שירים בהצלחה לפי האזנה לשמע!` : `Classified ${updatedCount} tracks!`)
        : (isHe ? 'לא נמצאו שירים לעדכון.' : 'No tracks updated.')
    );
    setTimeout(() => setBulkClassifyNotice(null), 4000);
  };

  const isFilteredOrSearching =
    searchQuery.trim().length > 0 ||
    !!artistFilter ||
    !!selectedGenre ||
    activeTab === 'favorites' ||
    activeTab === 'leading';

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#000000] text-white font-sans flex flex-col antialiased selection:bg-white selection:text-black"
      dir={isHe ? 'rtl' : 'ltr'}
    >
      {/* DEVTOOLS SECURITY PROTECTION */}
      <DevToolsProtection />

      {/* MANDATORY TERMS OVERLAY */}
      <TermsModal isOpen={showTermsModal} onAccept={handleAcceptTerms} lang={lang} />

      {/* READ-ONLY TERMS OF SERVICE VIEWER */}
      <TermsReaderModal isOpen={showLegalTermsModal} onClose={handleCloseLegalTerms} lang={lang} />

      {/* COOKIE CONSENT BANNER */}
      <CookieBanner
        lang={lang}
        currentUser={authUser}
        artistProfile={activeArtistProfile}
        onOpenTerms={() => setShowLegalTermsModal(true)}
      />

      {/* FLOATING TOP NAVIGATION BAR (Desktop & Tablet md+) */}
      <div className="hidden md:block px-6 pt-2.5 pb-1 shrink-0 z-40">
        {/* DESKTOP & LARGE TABLET HEADER (md:flex) — Logo + Search on Start, Action Controls on End */}
        <header className="flex h-15 w-full rounded-full bg-[#101010]/90 backdrop-blur-2xl border border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.7)] px-4 lg:px-7 items-center justify-between gap-3 lg:gap-4 select-none">
          {/* Logo + Search Input Side-by-Side (Start Side in RTL) */}
          <div className="flex items-center gap-3 lg:gap-4 flex-1 max-w-lg min-w-0">
            <div
              className="flex items-center shrink-0 cursor-pointer py-1"
              onClick={() => {
                setSearchQuery('');
                setArtistFilter(null);
                setSelectedGenre(null);
                setActiveTab('all');
              }}
            >
              <Logo className="h-8 lg:h-8.5 w-auto" heartOnly={true} />
            </div>

            {/* Search Input (Keyboard) right beside Logo */}
            <div className="relative flex-1 min-w-[140px] max-w-xs lg:max-w-sm">
              <div className="absolute inset-y-0 start-3 flex items-center pointer-events-none text-white/60">
                <Search className="w-4 h-4 text-white/60" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isHe ? 'מה תרצה לשמוע?' : 'What do you want to play?'}
                className="w-full h-9 ps-9 pe-9 bg-white/10 hover:bg-white/15 focus:bg-white/20 focus:outline-none focus:border-white/40 text-sm text-white placeholder-white/50 rounded-full border border-white/15 shadow-inner backdrop-blur-md transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 end-3 flex items-center text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Controls: Favorites + Accessibility + Admin + Profile (End Side in RTL) */}
          <div className="flex items-center gap-2 lg:gap-2.5 shrink-0">

            {/* Favorites Button (Pure circle icon-only, matching Accessibility button) */}
            <button
              onClick={() => {
                setActiveTab((prev) => (prev === 'favorites' ? 'all' : 'favorites'));
              }}
              className={`w-9 h-9 aspect-square rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 border ${
                activeTab === 'favorites'
                  ? 'bg-white/25 text-white border-white/40 shadow-sm'
                  : 'bg-white/10 text-white/90 hover:text-white hover:bg-white/20 border-white/15'
              }`}
              title={isHe ? 'מועדפים' : 'Favorites'}
              aria-label={isHe ? 'מועדפים' : 'Favorites'}
            >
              <Heart
                className={`w-4 h-4 text-white ${
                  activeTab === 'favorites' ? 'fill-white' : ''
                }`}
              />
            </button>

            {/* Accessibility Button Right Next to Favorites Heart */}
            {onOpenAccessibility && (
              <button
                type="button"
                onClick={onOpenAccessibility}
                className={`relative w-9 h-9 aspect-square rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 border ${
                  activeAccessibilityCount > 0
                    ? 'bg-white text-black border-white shadow-sm'
                    : 'bg-white/10 text-white/90 hover:text-white hover:bg-white/20 border-white/15'
                }`}
                title={isHe ? 'נגישות והגדרות נגישות' : 'Accessibility'}
                aria-label={isHe ? 'פתח דף והגדרות נגישות' : 'Open Accessibility Settings'}
              >
                <AccessibilityIcon className="w-4 h-4" />
                {activeAccessibilityCount > 0 && (
                  <span className="sr-only">
                    {isHe ? `${activeAccessibilityCount} התאמות נגישות פעילות` : `${activeAccessibilityCount} active accessibility features`}
                  </span>
                )}
              </button>
            )}

            {/* Google Sign-in Button */}
            {!authUser ? (
              <button
                onClick={handleGoogleSignInClick}
                className="h-9 px-3.5 lg:px-4 rounded-full bg-white hover:bg-neutral-200 active:scale-95 text-black font-bold text-xs lg:text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(255,255,255,0.2)] cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span className="whitespace-nowrap hidden lg:inline">{isHe ? 'המשך עם Google' : 'Continue with Google'}</span>
                <span className="whitespace-nowrap lg:hidden">{isHe ? 'התחברות' : 'Sign in'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleProfileClick}
                  className="w-10 h-10 aspect-square rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl border border-white/40 ring-1 ring-white/25 p-1 text-white flex items-center justify-center overflow-hidden cursor-pointer transition-all shadow-[0_4px_18px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] shrink-0"
                  title={authUser.displayName || (isHe ? 'פרופיל' : 'Profile')}
                >
                  <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-black/30">
                    {(() => {
                      const avatar = getEffectiveUserAvatar(authUser, activeArtistProfile);
                      return avatar ? (
                        <img src={avatar} alt="" referrerPolicy="no-referrer" loading="eager" decoding="async" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <span className="text-xs font-bold text-white">
                          {(authUser.displayName || activeArtistProfile?.name)?.[0]?.toUpperCase() || 'U'}
                        </span>
                      );
                    })()}
                  </div>
                </button>
              </div>
            )}
          </div>
        </header>
      </div>

      {/* MOBILE PINNED TOP CORNERS (md:hidden) — True Circle Logo & Accessibility always visible at every scroll position */}
      <header
        className={`fixed top-2.5 start-3 end-3 z-[75] md:hidden flex items-center justify-between pointer-events-none select-none transition-all duration-200 ${
          isMobileSearchOpen ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
        }`}
        aria-hidden={isMobileSearchOpen}
      >
        <button
          type="button"
          onClick={() => {
            setSearchQuery('');
            setArtistFilter(null);
            setSelectedGenre(null);
            setActiveTab('all');
            setIsMobileSearchOpen(false);
          }}
          className="pointer-events-auto w-11 h-11 aspect-square rounded-full bg-[#101010]/95 backdrop-blur-xl border border-white/20 shadow-[0_6px_20px_rgba(0,0,0,0.85)] flex items-center justify-center p-2 cursor-pointer active:scale-95 transition-transform shrink-0 overflow-hidden"
          title={isHe ? 'דף הבית' : 'Home'}
          aria-label={isHe ? 'דף הבית' : 'Home'}
        >
          <Logo className="w-full h-full aspect-square" heartOnly={true} />
        </button>

        {onOpenAccessibility ? (
          <button
            type="button"
            onClick={onOpenAccessibility}
            className={`pointer-events-auto w-11 h-11 aspect-square rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 border shadow-[0_6px_20px_rgba(0,0,0,0.85)] ${
              activeAccessibilityCount > 0
                ? 'bg-white text-black border-white'
                : 'bg-[#101010]/95 backdrop-blur-xl text-white border-white/20 hover:bg-white/15'
            }`}
            title={isHe ? 'נגישות' : 'Accessibility'}
            aria-label={isHe ? 'פתח דף והגדרות נגישות' : 'Open Accessibility Settings'}
          >
            <AccessibilityIcon className="w-5 h-5" />
          </button>
        ) : (
          <div className="w-11 h-11 aspect-square shrink-0" />
        )}
      </header>

      {/* MOBILE TOP-ANCHORED KEYBOARD SEARCH BAR (Opens at top of screen, closes cleanly when keyboard dismisses) */}
      <div
        ref={mobileSearchBarRef}
        className={`fixed top-2.5 start-3 end-3 z-[80] md:hidden transition-all duration-200 ${
          isMobileSearchOpen
            ? 'opacity-100 pointer-events-auto translate-y-0 scale-100'
            : 'opacity-0 pointer-events-none -translate-y-2 scale-95'
        }`}
        aria-hidden={!isMobileSearchOpen}
      >
        <div className="h-12 rounded-full bg-[#141414]/95 backdrop-blur-2xl border border-white/25 shadow-[0_12px_36px_rgba(0,0,0,0.95)] px-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIsMobileSearchOpen(false);
              mobileTopSearchRef.current?.blur();
            }}
            tabIndex={isMobileSearchOpen ? 0 : -1}
            className="w-8 h-8 aspect-square rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            aria-label={isHe ? 'סגור חיפוש' : 'Close search'}
          >
            {isHe ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <Search className="w-4 h-4 text-white/60 shrink-0" />

          <input
            ref={mobileTopSearchRef}
            type="text"
            tabIndex={isMobileSearchOpen ? 0 : -1}
            value={searchQuery}
            onFocus={() => {
              if (mobileSearchBlurTimerRef.current) {
                clearTimeout(mobileSearchBlurTimerRef.current);
                mobileSearchBlurTimerRef.current = null;
              }
              setIsMobileSearchOpen(true);
            }}
            onBlur={() => {
              if (mobileSearchBlurTimerRef.current) clearTimeout(mobileSearchBlurTimerRef.current);
              mobileSearchBlurTimerRef.current = setTimeout(() => {
                if (document.activeElement !== mobileTopSearchRef.current) {
                  setIsMobileSearchOpen(false);
                }
              }, 140);
            }}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter') {
                setIsMobileSearchOpen(false);
                e.currentTarget.blur();
              }
            }}
            placeholder={isHe ? 'חפש שירים, זמרים וסגנונות...' : 'Search songs, artists...'}
            className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder-white/50 focus:outline-none"
          />

          {searchQuery ? (
            <button
              type="button"
              tabIndex={isMobileSearchOpen ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => {
                setSearchQuery('');
                mobileTopSearchRef.current?.focus();
              }}
              className="w-8 h-8 aspect-square rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
              aria-label={isHe ? 'נקה חיפוש' : 'Clear search'}
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              tabIndex={isMobileSearchOpen ? 0 : -1}
              onClick={() => {
                setIsMobileSearchOpen(false);
                mobileTopSearchRef.current?.blur();
              }}
              className="px-3 h-8 rounded-full bg-white text-black text-xs font-bold cursor-pointer shrink-0"
            >
              {isHe ? 'סגור' : 'Done'}
            </button>
          )}
        </div>
      </div>

      {/* MOBILE FLOATING BOTTOM NAVIGATION BAR (md:hidden) — Profile/Sign-in + Favorites Heart + Search Trigger (opens Top Search) */}
      <div
        className={`fixed bottom-3 start-3 end-3 md:hidden z-50 rounded-full bg-[#161616]/95 backdrop-blur-2xl border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.9)] px-2.5 py-1.5 flex items-center justify-between gap-2 text-white select-none transition-all duration-200 ${
          isMobileSearchOpen ? 'opacity-0 pointer-events-none translate-y-24' : 'opacity-100 translate-y-0'
        }`}
      >
        {/* Mobile Profile / Google Sign-in */}
        {!authUser ? (
          <button
            onClick={handleGoogleSignInClick}
            className="h-10 px-3 rounded-full bg-white hover:bg-neutral-200 active:scale-95 text-black font-bold text-[11px] flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span className="whitespace-nowrap">{isHe ? 'התחברות' : 'Sign in'}</span>
          </button>
        ) : (
          <button
            onClick={handleProfileClick}
            className="w-10 h-10 aspect-square rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl border border-white/40 ring-1 ring-white/25 p-1 text-white flex items-center justify-center overflow-hidden cursor-pointer transition-all shadow-[0_4px_18px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] shrink-0"
            title={authUser.displayName || (isHe ? 'פרופיל' : 'Profile')}
          >
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-black/30">
              {(() => {
                const avatar = getEffectiveUserAvatar(authUser, activeArtistProfile);
                return avatar ? (
                  <img src={avatar} alt="" referrerPolicy="no-referrer" loading="eager" decoding="async" className="w-full h-full object-cover rounded-full" />
                ) : (
                  <span className="text-xs font-bold text-white">
                    {(authUser.displayName || activeArtistProfile?.name)?.[0]?.toUpperCase() || 'U'}
                  </span>
                );
              })()}
            </div>
          </button>
        )}

        {/* Mobile Favorites Heart Button */}
        <button
          type="button"
          onClick={() => {
            setActiveTab((prev) => (prev === 'favorites' ? 'all' : 'favorites'));
          }}
          className={`w-10 h-10 aspect-square rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 border ${
            activeTab === 'favorites'
              ? 'bg-white/25 text-white border-white/40 shadow-sm'
              : 'bg-white/10 text-white/90 hover:text-white hover:bg-white/20 border-white/15'
          }`}
          title={isHe ? 'מועדפים' : 'Favorites'}
          aria-label={isHe ? 'מועדפים' : 'Favorites'}
        >
          <Heart
            className={`w-4 h-4 text-white ${
              activeTab === 'favorites' ? 'fill-white' : ''
            }`}
          />
        </button>

        {/* Mobile Search Trigger (Opens keyboard with input anchored at the TOP of the screen) */}
        <div className="relative flex-1 min-w-0 flex items-center">
          <button
            type="button"
            onClick={() => {
              setIsMobileSearchOpen(true);
              mobileTopSearchRef.current?.focus();
            }}
            className="w-full h-10 px-3 bg-white/10 hover:bg-white/15 text-xs rounded-full border border-white/20 backdrop-blur-md flex items-center gap-2 cursor-pointer text-start transition-all min-w-0"
          >
            <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
            <span className={`truncate flex-1 ${searchQuery ? 'text-white font-medium' : 'text-white/55'}`}>
              {searchQuery || (isHe ? 'חיפוש שירים...' : 'Search songs...')}
            </span>
          </button>
          {searchQuery && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSearchQuery('');
              }}
              className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/75 hover:text-white cursor-pointer"
              aria-label={isHe ? 'נקה חיפוש' : 'Clear'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* MAIN LAYOUT — SINGLE CLEAN SCROLLABLE CONTAINER */}
      <div className="flex-1 min-h-0 flex overflow-hidden px-3 md:px-6 pb-2 gap-2">
        {/* FLUID MAIN CONTENT AREA — Pristine 100% pitch black surface without gray cards */}
        <main
          ref={mainFeedRef}
          className="flex-1 min-h-0 bg-black border-none overflow-y-auto overscroll-y-contain custom-scrollbar flex flex-col pt-14 md:pt-0 pb-24 md:pb-0"
        >
          {/* WEAK / OFFLINE INTERNET HEALTH PILL NOTICE */}
          {(networkHealth.status === 'offline' || (networkHealth.status === 'weak' && !dismissedWeakNetBanner)) && (
            <div className="px-4 pt-3 flex justify-center">
              <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white text-black shadow-2xl border border-black/10">
                <span className="text-xs sm:text-sm font-bold text-black">
                  {networkHealth.status === 'offline'
                    ? (isHe ? 'אין חיבור לאינטרנט' : 'No internet')
                    : (isHe ? 'אינטרנט חלש' : 'Weak internet')}
                </span>
                {networkHealth.status === 'weak' && (
                  <button
                    type="button"
                    onClick={() => setDismissedWeakNetBanner(true)}
                    className="w-5 h-5 rounded-full hover:bg-black/10 flex items-center justify-center text-black transition-colors cursor-pointer shrink-0"
                    title={isHe ? 'סגור התראה' : 'Dismiss'}
                    aria-label={isHe ? 'סגור התראה' : 'Dismiss'}
                  >
                    <X className="w-3.5 h-3.5 text-black" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active Filter, Leading Songs, or Search Banner */}
          {isFilteredOrSearching && (
            <div className="p-4 sm:p-6 pb-4 border-b border-white/10 bg-black flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">
                  {searchQuery.trim()
                    ? isHe
                      ? `תוצאות חיפוש עבור "${searchQuery}"`
                      : `Search results for "${searchQuery}"`
                    : activeTab === 'leading'
                    ? isHe
                      ? 'השירים המובילים'
                      : 'Top Songs'
                    : activeTab === 'favorites'
                    ? isHe
                      ? 'השירים שאהבת'
                      : 'Liked Songs'
                    : artistFilter
                    ? isHe
                      ? `שירים של ${artistFilter}`
                      : `Songs by ${artistFilter}`
                    : selectedGenre
                    ? isHe
                      ? `ז'אנר: ${getGenreDisplayLabel(selectedGenre, true)}`
                      : `Genre: ${getGenreDisplayLabel(selectedGenre, false)}`
                    : isHe
                    ? 'כל השירים'
                    : 'All Songs'}
                </h1>
                <p className="text-xs text-[#b3b3b3] mt-1">
                  {activeTab === 'leading' && !searchQuery.trim() && !selectedGenre && !artistFilter
                    ? isHe
                      ? `${displayedTracks.length} שירים מדורגים לפי האזנות ופופולריות`
                      : `${displayedTracks.length} songs ranked by plays & popularity`
                    : `${displayedTracks.length} ${isHe ? 'שירים נמצאו' : 'songs found'}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setArtistFilter(null);
                  setSelectedGenre(null);
                  setActiveTab('all');
                }}
                className="min-h-[40px] px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors cursor-pointer border border-white/15 shrink-0 whitespace-nowrap"
              >
                {activeTab === 'leading'
                  ? (isHe ? 'חזרה לדף הבית' : 'Back Home')
                  : (isHe ? 'איפוס סינון' : 'Clear Filter')}
              </button>
            </div>
          )}

          {/* If Search is Active and Found Artists, show Circular Artist Grid */}
          {searchQuery.trim() && searchArtistResults.length > 0 && (
            <section className="p-4 sm:p-6 pb-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {isHe ? 'אמנים' : 'Artists'}
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {searchArtistResults.map((artist) => {
                  const trackWithAvatar = allTracks.find(
                    (t) =>
                      t.artistName?.toLowerCase().trim() === artist.name?.toLowerCase().trim() &&
                      !!t.artistAvatarUrl
                  );
                  const effectiveArtistImg = getStreamingMediaUrl(
                    artist.avatarUrl || trackWithAvatar?.artistAvatarUrl
                  );

                  return (
                    <div
                      key={artist.id}
                      onClick={() => openArtistProfile(artist.name, artist.googleUid || artist.id)}
                      className="group p-3 rounded-[10px] bg-white/[0.04] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col items-center border border-white/10 hover:border-white/20 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                    >
                      <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 bg-neutral-900 shadow-sm border border-white/10">
                        <ArtistCircleImage
                          src={effectiveArtistImg}
                          alt={artist.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          fallbackIconClassName="w-10 h-10 text-white/40"
                        />
                      </div>
                      <h3 className="font-semibold text-sm text-white truncate text-center">
                        {artist.name}
                      </h3>
                      <p className="text-xs text-white/60 mt-1 font-normal text-center">
                        {isHe ? 'אמן' : 'Artist'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* If Search is Active and Found Albums, show Album Cards */}
          {searchQuery.trim() && searchAlbumResults.length > 0 && (
            <section className="p-4 sm:p-6 pb-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {isHe ? 'אלבומים' : 'Albums'}
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {searchAlbumResults.map((album) => {
                  const albumTracks = allTracks.filter((t) => album.trackIds?.includes(t.id));
                  const coverToUse = album.coverUrl || albumTracks[0]?.coverUrl || undefined;
                  return (
                    <div
                      key={album.id}
                      onClick={() => setSelectedAlbum(album)}
                      className="group p-3 rounded-[10px] bg-white/[0.04] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/20 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                    >
                      <div>
                        <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-3 bg-neutral-900 shadow-sm border border-white/10">
                          {coverToUse ? (
                            <img
                              src={getStreamingMediaUrl(coverToUse)}
                              alt={album.title}
                              loading="eager"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-white/70 p-3">
                              <Disc className="w-10 h-10 text-white/50" />
                            </div>
                          )}
                        </div>
                        <h3 className="font-semibold text-sm text-white truncate">{album.title}</h3>
                        <p
                          onClick={(e) => {
                            e.stopPropagation();
                            openArtistProfile(album.artistName, album.uploadedByUid || album.artistId);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {album.artistName}
                        </p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span>{albumTracks.length} {isHe ? 'שירים' : 'tracks'}</span>
                        <span className="text-[10px] text-white/40 font-medium">{isHe ? 'אלבום' : 'Album'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* MAIN VERTICAL FEED */}
          {isFilteredOrSearching ? (
            /* Flat Grid for Filter/Search Results */
            <div key="filtered-feed" className="p-4 sm:p-6 flex-1 bg-black">
              {activeTab === 'favorites' && !authUser ? (
                <div className="text-center py-20 space-y-4 max-w-md mx-auto bg-white/[0.03] border border-white/10 rounded-3xl p-8">
                  <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto text-white border border-white/15">
                    <Heart className="w-8 h-8 text-white/80" />
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    {isHe ? 'מועדפים למשתמשים מחוברים בלבד' : 'Favorites require an account'}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/70 leading-relaxed">
                    {isHe
                      ? 'התחבר עם חשבון Google שלך כדי לשמור שירים שאהבת ולגשת לרשימת המועדפים האישית שלך.'
                      : 'Sign in with your Google account to save favorite tracks to your personal list.'}
                  </p>
                  <button
                    onClick={handleGoogleSignInClick}
                    className="mt-2 px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs sm:text-sm hover:bg-neutral-200 transition-colors cursor-pointer shadow-lg inline-flex items-center gap-2"
                  >
                    <span>{isHe ? 'המשך עם Google' : 'Continue with Google'}</span>
                  </button>
                </div>
              ) : displayedTracks.length === 0 ? (
                <div className="text-center py-24 space-y-4 max-w-md mx-auto">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-white/40 border border-white/10 backdrop-blur-md">
                    {activeTab === 'favorites' ? <Heart className="w-8 h-8" /> : <Search className="w-8 h-8" />}
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    {activeTab === 'favorites'
                      ? isHe
                        ? 'רשימת המועדפים שלך ריקה'
                        : 'Your Favorites list is empty'
                      : isHe
                      ? 'לא נמצאו שירים תואמים'
                      : 'No matching songs found'}
                  </h3>
                  <p className="text-xs text-white/60">
                    {activeTab === 'favorites'
                      ? isHe
                        ? 'לחץ על סמל הלב בכל שיר כדי לשמור אותו כאן'
                        : 'Tap the heart icon on any track to save it here.'
                      : isHe
                      ? 'נסה לבדוק שגיאות איות או חפש מונח אחר'
                      : 'Please check your spelling or try searching for another term.'}
                  </p>
                  {activeTab !== 'favorites' && (
                    <button
                      onClick={() => setIsArtistPortalOpen(true)}
                      className="mt-2 px-5 py-2.5 rounded-[9999px] bg-white text-black font-medium text-xs hover:bg-white/90 transition-colors cursor-pointer shadow-sm"
                    >
                      {isHe ? 'העלה שיר ראשון לקטגוריה זו' : 'Upload first song'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                  {displayedTracks.slice(0, visibleSearchCount).map((track, idx) => {
                    return (
                      <div
                        key={track.id}
                        onClick={() => openSongPlayer(track)}
                        onMouseEnter={() => prewarmTrackColor(track)}
                        className="group relative p-3 rounded-[10px] bg-white/[0.04] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/20 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                      >
                        <div>
                          {/* Square Album Cover (1:1) */}
                          <div className="relative aspect-square w-full rounded-[8px] overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                            <div className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]">
                              <TrackCoverArt
                                coverUrl={track.coverUrl}
                                artistName={track.artistName}
                                trackName={track.name}
                                genre={track.genre}
                                priority={idx < 12}
                              />
                            </div>
                            {track.isAiGenerated && (
                              <div className="absolute top-2 start-2 z-10">
                                <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-black text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                                  <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                                  AI
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Song Title & Artist */}
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-semibold text-sm text-white truncate flex-1">
                              {track.name}
                            </h3>
                            {track.isAiGenerated && (
                              <span className="px-1 py-0.2 rounded bg-purple-900/60 border border-purple-400/40 text-purple-200 text-[9px] font-black shrink-0">
                                AI
                              </span>
                            )}
                          </div>
                          <p
                            onClick={(e) => {
                              e.stopPropagation();
                              openArtistProfile(track.artistName, track.uploadedByUid);
                            }}
                            className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                          >
                            {track.artistName}
                          </p>
                        </div>

                        {/* Metadata indicator with rank/genre + favorite button */}
                        <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60 gap-2">
                          <span className="text-[10px] text-white/55 font-medium truncate">
                            {activeTab === 'leading' && !searchQuery.trim() && !selectedGenre && !artistFilter ? (
                              <>
                                <span className="font-mono tabular-nums text-white/85 font-bold">#{idx + 1}</span>
                                {' · '}
                                {getGenreDisplayLabel(track.genre, isHe)}
                              </>
                            ) : (
                              getGenreDisplayLabel(track.genre, isHe)
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(track.id);
                            }}
                            className="hover:scale-110 transition-transform p-1 cursor-pointer"
                            title={
                              likedSongIds.includes(track.id)
                                ? isHe
                                  ? 'נשמר במועדפים'
                                  : 'Liked'
                                : isHe
                                ? 'הוסף למועדפים'
                                : 'Add to Favorites'
                            }
                          >
                            <Heart
                              className={`w-3.5 h-3.5 ${
                                likedSongIds.includes(track.id)
                                  ? 'fill-white text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                                  : 'text-white/40 hover:text-white'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* DEFAULT HOME SECTIONS: HERO SPOTLIGHT -> QUICK MIXES -> ROW 1 (LEADING SONGS) -> ROW 2 (POPULAR ALBUMS) -> ROW 3 (POPULAR ARTISTS) -> CURATED ROWS */
            <div key="home-feed" className="p-2.5 sm:p-6 space-y-3.5 md:space-y-10 flex-1 bg-black">
              {/* DESKTOP LUXURY HERO SPOTLIGHT BANNER */}
              {featuredTrack && (() => {
                const resolvedFeaturedAvatar =
                  getEffectiveArtistAvatarForTrack(featuredTrack, allArtists);
                const artistAvatarImg = getStreamingMediaUrl(resolvedFeaturedAvatar);

                return (
                  <section className="relative overflow-hidden rounded-3xl bg-[#0a0b0e] border border-white/15 p-5 sm:p-7 md:p-9 lg:p-10 min-h-[345px] md:min-h-[320px] flex flex-col justify-center shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                    {/* MOBILE HERO SPOTLIGHT CARD: Proportional Vertical Card + 4 Quick Options fit above the fold */}
                    <div className="relative z-10 flex flex-col items-center text-center gap-3.5 md:hidden">
                      <div
                        onClick={() => openSongPlayer(featuredTrack)}
                        className="relative w-40 h-40 rounded-2xl overflow-hidden shadow-[0_14px_34px_rgba(0,0,0,0.85)] border border-white/25 shrink-0 cursor-pointer active:scale-98 transition-transform"
                      >
                        <TrackCoverArt
                          coverUrl={featuredTrack.coverUrl}
                          artistName={featuredTrack.artistName}
                          trackName={featuredTrack.name}
                          genre={featuredTrack.genre}
                          priority={true}
                          showHoverPlay={false}
                        />
                      </div>

                      <div className="space-y-1 max-w-xs w-full px-1">
                        <span className="text-[11px] font-semibold text-white/70 block">
                          {isHe ? 'מומלץ' : 'Featured'}
                        </span>
                        <h1 className="text-xl font-black text-white tracking-tight leading-tight line-clamp-1">
                          {featuredTrack.name}
                        </h1>
                      </div>

                      <div className="flex items-center justify-center gap-2.5 pt-1">
                        <button
                          type="button"
                          onClick={() => openArtistProfile(featuredTrack.artistName, featuredTrack.uploadedByUid)}
                          className="w-10.5 h-10.5 aspect-square rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl border border-white/40 ring-1 ring-white/25 p-1 flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-all shadow-[0_6px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.35)]"
                          title={isHe ? 'פרופיל אמן' : 'Artist Profile'}
                          aria-label={featuredTrack.artistName}
                        >
                          <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-black/30">
                            {artistAvatarImg ? (
                              <img src={artistAvatarImg} alt="" referrerPolicy="no-referrer" loading="eager" decoding="async" className="w-full h-full object-cover rounded-full" />
                            ) : (
                              <User className="w-4 h-4 text-white" />
                            )}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openSongPlayer(featuredTrack)}
                          className="h-10 px-6 rounded-full bg-white hover:bg-neutral-200 text-black font-bold text-sm active:scale-95 transition-all shadow-[0_8px_25px_rgba(255,255,255,0.25)] flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Play className="w-4 h-4 fill-black text-black" />
                          <span>{isHe ? 'האזן' : 'Listen'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleFavorite(featuredTrack.id)}
                          className={`w-10 h-10 aspect-square rounded-full border flex items-center justify-center shrink-0 transition-all cursor-pointer active:scale-95 ${
                            likedSongIds.includes(featuredTrack.id)
                              ? 'bg-white/25 border-white/50 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]'
                              : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                          }`}
                          title={isHe ? 'הוסף למועדפים' : 'Favorite'}
                          aria-label={isHe ? 'הוסף למועדפים' : 'Favorite'}
                        >
                          <Heart
                            className={`w-4 h-4 text-white ${
                              likedSongIds.includes(featuredTrack.id) ? 'fill-white' : ''
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* DESKTOP HERO SPOTLIGHT CARD */}
                    <div className="relative z-10 hidden md:flex flex-row items-center gap-8 justify-between">
                      {/* Track Info (Right side in RTL) */}
                      <div className="flex-1 text-start space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-medium text-white/90 backdrop-blur-md shadow-sm">
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                          <span>{isHe ? 'מומלץ' : 'Featured'}</span>
                        </div>

                        <h1 className="text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                          {featuredTrack.name}
                        </h1>

                        <div className="flex flex-wrap items-center justify-start gap-3 text-sm text-white/70">
                          <span>{getGenreDisplayLabel(featuredTrack.genre, isHe)}</span>
                          {featuredTrack.albumName && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                              <span className="text-white/60">{featuredTrack.albumName}</span>
                            </>
                          )}
                        </div>

                        <div className="pt-2 flex flex-wrap items-center justify-start gap-3">
                          <button
                            onClick={() => openSongPlayer(featuredTrack)}
                            className="px-7 py-3 rounded-full bg-white text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_8px_25px_rgba(255,255,255,0.25)] flex items-center gap-2.5 cursor-pointer"
                          >
                            <Play className="w-4 h-4 fill-black text-black" />
                            <span>{isHe ? 'האזן עכשיו' : 'Play Now'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleFavorite(featuredTrack.id)}
                            className={`p-3 rounded-full border transition-all cursor-pointer active:scale-95 ${
                              likedSongIds.includes(featuredTrack.id)
                                ? 'bg-white/25 border-white/50 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]'
                                : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                            }`}
                            title={isHe ? 'הוסף למועדפים' : 'Favorite'}
                          >
                            <Heart
                              className={`w-4 h-4 text-white ${
                                likedSongIds.includes(featuredTrack.id) ? 'fill-white' : ''
                              }`}
                            />
                          </button>

                          {/* Artist Circular Avatar Button (Image Only, No Name Text, Frosted Glass Frame) */}
                          <button
                            type="button"
                            onClick={() => openArtistProfile(featuredTrack.artistName, featuredTrack.uploadedByUid)}
                            className="w-11.5 h-11.5 aspect-square rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-xl border border-white/40 ring-1 ring-white/25 p-1 flex items-center justify-center shrink-0 cursor-pointer shadow-[0_6px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.35)] active:scale-95 transition-all"
                            title={isHe ? 'פרופיל אמן' : 'Artist Profile'}
                            aria-label={featuredTrack.artistName}
                          >
                            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-black/30">
                              {artistAvatarImg ? (
                                <img src={artistAvatarImg} alt="" referrerPolicy="no-referrer" loading="eager" decoding="async" className="w-full h-full object-cover rounded-full" />
                              ) : (
                                <User className="w-4.5 h-4.5 text-white" />
                              )}
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Big Artwork Showcase (Left side in RTL) */}
                      <div
                        onClick={() => openSongPlayer(featuredTrack)}
                        className="relative w-60 h-60 lg:w-68 lg:h-68 rounded-3xl overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.85)] border border-white/25 shrink-0 group cursor-pointer"
                      >
                        <TrackCoverArt
                          coverUrl={featuredTrack.coverUrl}
                          artistName={featuredTrack.artistName}
                          trackName={featuredTrack.name}
                          genre={featuredTrack.genre}
                          priority={true}
                          showHoverPlay={true}
                        />
                      </div>
                    </div>
                  </section>
                );
              })()}

              {/* QUICK ACCESS MIXES STRIP (Mobile shows 4 crisp options above the fold; Desktop shows 6) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                {(() => {
                  const strictChillTracks = validHomeTracks.filter((t) => normalizeGenreId(t.genre) === 'Chill');
                  const likedCoverTrack = validHomeTracks.find(
                    (t) => likedSongIds.includes(t.id) && isAuthenticCover(t.coverUrl)
                  );
                  return [
                    {
                      title: isHe ? 'השירים המובילים' : 'Top Hits',
                      action: () => {
                        setSelectedGenre(null);
                        setArtistFilter(null);
                        setSearchQuery('');
                        setActiveTab('leading');
                      },
                      icon: Play,
                      cover: leadingTracks.find((t) => isAuthenticCover(t.coverUrl))?.coverUrl || null,
                    },
                    {
                      title: isHe ? 'מזרחית וים-תיכוני' : 'Mizrahi Vibes',
                      action: () => {
                        setActiveTab('all');
                        setSelectedGenre('Mizrahi');
                      },
                      icon: Sparkles,
                      cover: mizrahiTracks.find((t) => isAuthenticCover(t.coverUrl))?.coverUrl || null,
                    },
                    {
                      title: isHe ? 'היפ הופ וראפ' : 'Hip Hop & Rap',
                      action: () => {
                        setActiveTab('all');
                        setSelectedGenre('Hip Hop');
                      },
                      icon: Disc,
                      cover: hipHopTracks.find((t) => isAuthenticCover(t.coverUrl))?.coverUrl || null,
                      mobileHide: true,
                    },
                    {
                      title: isHe ? 'צ׳יל ורגיעה' : 'Chill Vibes',
                      action: () => {
                        setActiveTab('all');
                        setSelectedGenre('Chill');
                      },
                      icon: Disc,
                      cover: strictChillTracks.find((t) => isAuthenticCover(t.coverUrl))?.coverUrl || null,
                      mobileHide: true,
                    },
                    {
                      title: isHe ? 'להיטי פופ' : 'Pop Bangers',
                      action: () => {
                        setActiveTab('all');
                        setSelectedGenre('Pop');
                      },
                      icon: Play,
                      cover: popTracks.find((t) => isAuthenticCover(t.coverUrl))?.coverUrl || null,
                    },
                    {
                      title: isHe ? 'השירים שאהבת' : 'Liked Songs',
                      action: () => {
                        setSelectedGenre(null);
                        setArtistFilter(null);
                        setSearchQuery('');
                        setActiveTab('favorites');
                      },
                      icon: Heart,
                      cover: likedCoverTrack?.coverUrl || null,
                      count: likedSongIds.length,
                    },
                  ];
                })().map((item, i) => (
                  <button
                    key={i}
                    onClick={item.action}
                    className={`group ${item.mobileHide ? 'hidden md:flex' : 'flex'} items-center gap-2.5 sm:gap-3 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-white/25 backdrop-blur-md transition-all text-start cursor-pointer shadow-sm active:scale-98 overflow-hidden`}
                  >
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-neutral-900 flex items-center justify-center shrink-0 overflow-hidden border border-white/15">
                      {item.cover && isAuthenticCover(item.cover) ? (
                        <img src={getStreamingMediaUrl(item.cover)} alt="" loading="eager" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <item.icon className="w-4 h-4 text-white fill-white/20" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-white truncate flex-1">{item.title}</span>
                  </button>
                ))}
              </div>

              {/* AUDIO-CLASSIFIED GENRE EXPLORER STRIP */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-white" />
                    <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                      {isHe ? 'עיון לפי ז׳אנר (זיהוי שמע אוטומטי)' : 'Browse by Audio-Classified Genre'}
                    </h2>
                  </div>

                  {untaggedTracks.length > 0 && (
                    <button
                      onClick={handleBulkClassifyUntagged}
                      disabled={isBulkClassifying}
                      className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/30 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isBulkClassifying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5 text-white" />
                      )}
                      <span>
                        {isHe
                          ? `סווג ${untaggedTracks.length} שירים ללא ז׳אנר`
                          : `Auto-Classify ${untaggedTracks.length} Untagged`}
                      </span>
                    </button>
                  )}
                </div>

                {bulkClassifyNotice && (
                  <div className="px-3.5 py-2 rounded-xl bg-white/10 border border-white/25 text-white text-xs font-semibold">
                    {bulkClassifyNotice}
                  </div>
                )}

                <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
                  <button
                    onClick={() => {
                      setSelectedGenre(null);
                      trackEvent('select_genre', { genre: 'all' });
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer border flex items-center gap-1.5 text-white ${
                      !selectedGenre
                        ? 'bg-white/20 border-white shadow-md'
                        : 'bg-white/[0.06] hover:bg-white/[0.14] border-white/15'
                    }`}
                  >
                    <Music className="w-3.5 h-3.5 text-white shrink-0" />
                    <span>{isHe ? `הכל (${validHomeTracks.length})` : `All (${validHomeTracks.length})`}</span>
                  </button>
                  {[
                    ...CANONICAL_GENRES.filter((g) => (genreCounts[g.id] || 0) > 0).map((g) => ({
                      id: g.id,
                      labelHe: g.labelHe,
                      labelEn: g.labelEn,
                    })),
                    ...Object.keys(genreCounts)
                      .filter(
                        (gid) =>
                          genreCounts[gid] > 0 &&
                          !CANONICAL_GENRES.some((cg) => cg.id === gid) &&
                          gid !== 'ללא סגנון מוזיקלי'
                      )
                      .map((gid) => ({
                        id: gid,
                        labelHe: getGenreDisplayLabel(gid, true),
                        labelEn: getGenreDisplayLabel(gid, false),
                      })),
                  ].map((g) => {
                    const count = genreCounts[g.id] || 0;
                    const active = selectedGenre === g.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => {
                          const next = active ? null : g.id;
                          setSelectedGenre(next);
                          trackEvent('select_genre', { genre: next || 'all' });
                        }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer border flex items-center gap-1.5 text-white ${
                          active
                            ? 'bg-white/20 border-white shadow-md'
                            : 'bg-white/[0.06] hover:bg-white/[0.14] border-white/15'
                        }`}
                      >
                        {renderCategoryIcon(g.id, 'w-3.5 h-3.5 text-white shrink-0')}
                        <span className="text-white">{isHe ? g.labelHe : g.labelEn}</span>
                        <span className="text-[10px] text-white/75">
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* ROW 1: השירים המובילים (Leading Songs by Popularity / Plays) */}
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGenre(null);
                      setArtistFilter(null);
                      setSearchQuery('');
                      setActiveTab('leading');
                    }}
                    className="text-start group cursor-pointer"
                  >
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight group-hover:underline">
                      {isHe ? 'השירים המובילים' : 'Leading songs'}
                    </h2>
                    <p className="text-xs text-white/60 mt-0.5 font-normal">
                      {isHe ? 'השירים המושמעים והמבוקשים ביותר באתר' : 'Most played and popular tracks'}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGenre(null);
                      setArtistFilter(null);
                      setSearchQuery('');
                      setActiveTab('leading');
                    }}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-white/75 hover:underline hover:text-white transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {isHe ? 'הצג הכל' : 'Show all'}
                  </button>
                </div>

                <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar select-none flex-nowrap">
                  {leadingTracks.slice(0, 12).map((track, idx) => (
                    <div
                      key={track.id}
                      onClick={() => openSongPlayer(track)}
                      onMouseEnter={() => prewarmTrackColor(track)}
                      className="group relative w-36 sm:w-44 md:w-48 shrink-0 p-2.5 sm:p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                    >
                      <div>
                        {/* 1:1 Aspect ratio cover */}
                        <div className="relative aspect-square w-full rounded-[8px] overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                          <div className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]">
                            <TrackCoverArt
                              coverUrl={track.coverUrl}
                              artistName={track.artistName}
                              trackName={track.name}
                              genre={track.genre}
                              priority={idx < 7}
                            />
                          </div>
                          {track.isAiGenerated && (
                            <div className="absolute top-2 start-2 z-10">
                              <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-black text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                                <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                                AI
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-sm text-white truncate flex-1">
                            {track.name}
                          </h3>
                          {track.isAiGenerated && (
                            <span className="px-1 py-0.2 rounded bg-purple-900/60 border border-purple-400/40 text-purple-200 text-[9px] font-black shrink-0">
                              AI
                            </span>
                          )}
                        </div>
                        <p
                          onClick={(e) => {
                            e.stopPropagation();
                            openArtistProfile(track.artistName, track.uploadedByUid);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {track.artistName}
                        </p>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span className="text-[10px] text-white/50 font-medium truncate">
                          {getGenreDisplayLabel(track.genre, isHe)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(track.id);
                          }}
                          className="hover:scale-110 transition-transform p-1 cursor-pointer"
                          title={
                            likedSongIds.includes(track.id)
                              ? isHe
                                ? 'נשמר במועדפים'
                                : 'Liked'
                              : isHe
                              ? 'הוסף למועדפים'
                              : 'Add to Favorites'
                          }
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${
                              likedSongIds.includes(track.id)
                                ? 'fill-white text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                                : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ROW 2: אלבומים מומלצים (Recommended Albums Carousel) */}
              {popularAlbums.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                        {isHe ? 'אלבומים מומלצים' : 'Recommended albums'}
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5 font-normal">
                        {isHe ? 'אלבומים ואוספים מומלצים של היוצרים באתר' : 'Recommended albums and collections'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar select-none">
                    {popularAlbums.map((album) => {
                      const albumTracks = allTracks.filter((t) => album.trackIds?.includes(t.id));
                      const coverToUse =
                        album.coverUrl || albumTracks[0]?.coverUrl || undefined;

                      return (
                        <div
                          key={album.id}
                          onClick={() => setSelectedAlbum(album)}
                          className="group relative w-36 sm:w-44 md:w-48 shrink-0 p-2.5 sm:p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                        >
                          <div>
                            {/* Album Cover Art */}
                            <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-3 bg-neutral-900 shadow-sm border border-white/10">
                              {coverToUse ? (
                                <img
                                  src={getStreamingMediaUrl(coverToUse)}
                                  alt={album.title}
                                  loading="eager"
                                  decoding="async"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                  className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-white/80 p-3">
                                  <Logo heartOnly={true} className="w-14 h-14 drop-shadow-[0_4px_16px_rgba(255,255,255,0.3)]" />
                                </div>
                              )}
                            </div>

                            <h3 className="font-semibold text-sm text-white truncate">
                              {album.title}
                            </h3>
                            <p
                              onClick={(e) => {
                                e.stopPropagation();
                                openArtistProfile(album.artistName, album.uploadedByUid || album.artistId);
                              }}
                              className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                            >
                              {album.artistName}
                            </p>
                          </div>

                          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                            <span>
                              {albumTracks.length || album.trackIds?.length || 0} {isHe ? 'שירים' : 'tracks'}
                            </span>
                            <span className="text-[10px] text-white/40 font-medium">{isHe ? 'אלבום' : 'Album'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ROW 3: אמנים פופולאריים (Popular Artists Horizontal Carousel) */}
              {popularArtists.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                        {isHe ? 'אמנים פופולאריים' : 'Popular artists'}
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5 font-normal">
                        {isHe ? 'היוצרים והזמרים האהובים ביותר בקהילה' : 'Top followed and played artists'}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar select-none flex-nowrap">
                    {popularArtists.slice(0, 12).map((artist, idx) => {
                      const artistCleanUid = (artist.uid || '').replace(/^artist_/, '').toLowerCase().trim();
                      const trackWithAvatar = allTracks.find((t) => {
                        const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
                        return (
                          ((artistCleanUid && tUid === artistCleanUid) ||
                            t.artistName?.toLowerCase().trim() === artist.name?.toLowerCase().trim()) &&
                          !!t.artistAvatarUrl
                        );
                      });
                      const effectiveImg = getStreamingMediaUrl(
                        artist.avatarUrl || trackWithAvatar?.artistAvatarUrl
                      );

                      return (
                        <div
                          key={artist.uid || artist.name || idx}
                          onClick={() => openArtistProfile(artist.name, artist.uid)}
                          className="group w-32 sm:w-36 md:w-40 shrink-0 p-3 sm:p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col items-center border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                        >
                          {/* Circular Avatar */}
                          <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 bg-neutral-900 shadow-sm border border-white/10">
                            <ArtistCircleImage
                              src={effectiveImg}
                              alt={artist.name}
                              className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                              fallbackIconClassName="w-12 h-12 text-white/40"
                            />
                          </div>

                          <h3 className="font-semibold text-sm text-white truncate text-center w-full">
                            {artist.name}
                          </h3>
                          <p className="text-xs text-white/60 mt-1 font-normal text-center">
                            {isHe ? 'אמן' : 'Artist'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ROW 4: חדש ב-Kolot Music (New Releases Horizontal Carousel) */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                      {isHe ? 'חדש ב-Kolot Music' : 'New on Kolot Music'}
                    </h2>
                    <p className="text-xs text-white/60 mt-0.5 font-normal">
                      {isHe ? 'שירים שעלו לאחרונה על ידי היוצרים' : 'Recently added tracks'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar select-none flex-nowrap">
                  {newReleasesTracks.slice(0, 14).map((track, idx) => (
                    <div
                      key={track.id}
                      onClick={() => openSongPlayer(track)}
                      onMouseEnter={() => prewarmTrackColor(track)}
                      className="group relative w-36 sm:w-44 md:w-48 shrink-0 p-2.5 sm:p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                    >
                      <div>
                        <div className="relative aspect-square w-full rounded-[8px] overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                          <div className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]">
                            <TrackCoverArt
                              coverUrl={track.coverUrl}
                              artistName={track.artistName}
                              trackName={track.name}
                              genre={track.genre}
                              priority={idx < 5}
                            />
                          </div>
                          {track.isAiGenerated && (
                            <div className="absolute top-2 start-2 z-10">
                              <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-black text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                                <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                                AI
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-sm text-white truncate flex-1">
                            {track.name}
                          </h3>
                          {track.isAiGenerated && (
                            <span className="px-1 py-0.2 rounded bg-purple-900/60 border border-purple-400/40 text-purple-200 text-[9px] font-black shrink-0">
                              AI
                            </span>
                          )}
                        </div>
                        <p
                          onClick={(e) => {
                            e.stopPropagation();
                            openArtistProfile(track.artistName, track.uploadedByUid);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {track.artistName}
                        </p>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span className="text-white/60 text-[10px] font-medium truncate">
                          {getGenreDisplayLabel(track.genre, isHe)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(track.id);
                          }}
                          className="hover:scale-110 transition-transform p-1 cursor-pointer"
                          title={
                            likedSongIds.includes(track.id)
                              ? isHe
                                ? 'נשמר במועדפים'
                                : 'Liked'
                              : isHe
                              ? 'הוסף למועדפים'
                              : 'Add to Favorites'
                          }
                        >
                          <Heart
                            className={`w-3.5 h-3.5 ${
                              likedSongIds.includes(track.id)
                                ? 'fill-white text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                                : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* AUDIO-CLASSIFIED CURATED GENRE SECTIONS */}
              {[
                {
                  id: 'Mizrahi',
                  titleHe: 'מזרחית וים-תיכוני',
                  titleEn: 'Mizrahi & Mediterranean',
                  subtitleHe: 'סלסולים, מקצבים ים-תיכוניים ולהיטים ישראליים',
                  subtitleEn: 'Middle Eastern & Mediterranean vocal hits',
                  tracks: mizrahiTracks,
                },
                {
                  id: 'Pop',
                  titleHe: 'פופ ולהיטים עכשוויים',
                  titleEn: 'Pop & Contemporary Hits',
                  subtitleHe: 'שירים שסווגו כפופ עכשווי וקצבי',
                  subtitleEn: 'Catchy contemporary pop tracks',
                  tracks: popTracks,
                },
                {
                  id: 'Hip Hop',
                  titleHe: 'היפ הופ וראפ',
                  titleEn: 'Hip Hop & Rap',
                  subtitleHe: 'ביטים, פלואו ויצירת היפ הופ מקורית',
                  subtitleEn: 'Beats, rap verses & hip hop flow',
                  tracks: hipHopTracks,
                },
                {
                  id: 'Rock',
                  titleHe: 'רוק וגיטרות',
                  titleEn: 'Rock & Guitars',
                  subtitleHe: 'סאונד רוק, גיטרות חיות ואנרגיה גבוהה',
                  subtitleEn: 'Electric guitars & live drums',
                  tracks: rockTracks,
                },
                {
                  id: 'Chill',
                  titleHe: 'צ׳יל ואלקטרוני',
                  titleEn: 'Chill & Electronic',
                  subtitleHe: 'אווירה, אלקטרוניקה, לו-פיי ומוזיקה לרקע',
                  subtitleEn: 'Ambient, lo-fi and electronic beats',
                  tracks: chillTracks,
                },
                {
                  id: 'Acoustic',
                  titleHe: 'אקוסטי, קלאסי, ג׳אז וקולנועי',
                  titleEn: 'Acoustic, Classical & Jazz',
                  subtitleHe: 'יצירות אקוסטיות, תזמורתיות ומוזיקת נשמה',
                  subtitleEn: 'Acoustic warmth, classical & jazz instrumentation',
                  tracks: acousticClassicTracks,
                },
              ]
                .filter((sec) => sec.tracks.length > 0)
                .map((section) => (
                  <section key={section.id} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                          {renderCategoryIcon(section.id, 'w-5 h-5 text-white shrink-0')}
                          <span>{isHe ? section.titleHe : section.titleEn}</span>
                        </h2>
                        <p className="text-xs text-white/60 mt-0.5 font-normal">
                          {isHe ? section.subtitleHe : section.subtitleEn}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedGenre(section.id)}
                        className="text-xs font-medium text-white/75 hover:text-white hover:underline cursor-pointer"
                      >
                        {isHe ? `הכל בז׳אנר (${section.tracks.length})` : `Show all (${section.tracks.length})`}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                      {section.tracks.slice(0, 7).map((track, idx) => (
                        <div
                          key={track.id}
                          onClick={() => openSongPlayer(track)}
                          onMouseEnter={() => prewarmTrackColor(track)}
                          className="group relative p-3 rounded-[10px] bg-white/[0.04] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/20 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                        >
                          <div>
                            <div className="relative aspect-square w-full rounded-[8px] overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                              <div className="w-full h-full transition-transform duration-300 ease-out group-hover:scale-[1.03]">
                                <TrackCoverArt
                                  coverUrl={track.coverUrl}
                                  artistName={track.artistName}
                                  trackName={track.name}
                                  genre={track.genre}
                                  priority={idx < 4}
                                />
                              </div>
                              {track.isAiGenerated && (
                                <div className="absolute top-2 start-2 z-10">
                                  <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-black text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                                    <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                                    AI
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <h3 className="font-semibold text-sm text-white truncate flex-1">
                                {track.name}
                              </h3>
                            </div>
                            <p
                              onClick={(e) => {
                                e.stopPropagation();
                                openArtistProfile(track.artistName, track.uploadedByUid);
                              }}
                              className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                            >
                              {track.artistName}
                            </p>
                          </div>

                          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/75">
                            <span className="text-white text-[10px] font-semibold truncate flex items-center gap-1">
                              {renderCategoryIcon(normalizeGenreId(track.genre), 'w-3 h-3 text-white shrink-0')}
                              <span>{getGenreDisplayLabel(track.genre, isHe)}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(track.id);
                              }}
                              className="hover:scale-110 transition-transform p-1 cursor-pointer"
                              title={
                                likedSongIds.includes(track.id)
                                  ? isHe
                                    ? 'נשמר במועדפים'
                                    : 'Liked'
                                  : isHe
                                  ? 'הוסף למועדפים'
                                  : 'Add to Favorites'
                              }
                            >
                              <Heart
                                className={`w-3.5 h-3.5 ${
                                  likedSongIds.includes(track.id)
                                    ? 'fill-white text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]'
                                    : 'text-white/40 hover:text-white'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
            </div>
          )}

          {/* SITE FOOTER */}
          <Footer
            lang={lang}
            onOpenPortal={() => setIsArtistPortalOpen(true)}
            onOpenTerms={() => setShowLegalTermsModal(true)}
            onOpenAccessibility={onOpenAccessibility}
          />
        </main>
      </div>


      {/* FULL-PAGE SONG PLAYER OVERLAY (ONLY IF DIRECTLY INLINE, THOUGH APP.TSX MANAGES IT NORMALLY) */}
      <AnimatePresence>
        {playerTrack && (
          <SongPlayerPage
            track={playerTrack}
            activeAlbumContext={playerAlbumContext}
            onBack={closeSongPlayer}
            onFilterByArtist={(artist) => {
              setArtistFilter(artist);
              closeSongPlayer();
            }}
            isLiked={likedSongIds.includes(playerTrack.id)}
            onToggleLike={toggleFavorite}
            onRequireAuth={() => openLoginModal()}
            lang={lang}
            allTracks={allTracks}
            allArtists={allArtists}
            allAlbums={popularAlbums}
            onPlayTrack={(track, albCtx) => {
              setPlayerAlbumContext(albCtx ?? null);
              setPlayerTrack(track);
            }}
            onRemoveTrack={async (trackId) => {
              markSongAsDeleted(trackId);
              setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
              if (playerTrack?.id === trackId) {
                closeSongPlayer();
              }
              await Promise.allSettled([
                removeTrackFromStorage(trackId),
                deleteTrackFromCloud(trackId),
              ]);
            }}
          />
        )}
      </AnimatePresence>

      {/* PUBLIC ARTIST PROFILE MODAL */}
      <AnimatePresence>
        {profileArtistName && (
          <ArtistProfileModal
            artistName={profileArtistName}
            artistUid={profileArtistUid}
            isOpen={!!profileArtistName}
            onClose={closeArtistProfile}
            allTracks={Array.isArray(allTracks) ? allTracks : []}
            allArtists={allArtists}
            allAlbums={popularAlbums}
            onPlayTrack={(track, albCtx) => openSongPlayer(track, albCtx)}
            lang={lang}
            onToggleLike={toggleFavorite}
            likedSongIds={likedSongIds}
            onOpenPortal={() => {
              closeArtistProfile();
              setIsArtistPortalOpen(true);
            }}
            onRemoveTrack={async (trackId) => {
              markSongAsDeleted(trackId);
              setAllTracks((prev) => {
                const next = prev.filter((t) => t.id !== trackId);
                saveCachedCloudTracks(next);
                onTracksSync?.(next);
                return next;
              });
              await Promise.allSettled([
                removeTrackFromStorage(trackId),
                deleteTrackFromCloud(trackId),
              ]);
            }}
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
        allAlbums={popularAlbums}
        onAlbumsSync={(albums) => {
          setRemoteAlbums(albums);
          onAlbumsSync?.(albums);
        }}
        onTrackPublished={async (newTrack) => {
          setAllTracks((prev) => {
            const replaced = prev.some((t) => t.id === newTrack.id)
              ? prev.map((t) => (t.id === newTrack.id ? { ...t, ...newTrack } : t))
              : [newTrack, ...prev];
            const next = deduplicateTracks([newTrack, ...replaced]);
            saveCachedCloudTracks(next);
            onTracksSync?.(next);
            return next;
          });
          setPlayerTrack((cur) => (cur && cur.id === newTrack.id ? { ...cur, ...newTrack } : cur));
        }}
        onArtistUpdated={(updatedArtist) => {
          setActiveArtistProfile(updatedArtist);
          upsertMemoryArtistProfile(updatedArtist);
          updateCurrentAuthUserProfile({
            displayName: updatedArtist.name,
            photoURL: updatedArtist.avatarUrl || '',
          });
          const cleanUpdatedUid = (updatedArtist.googleUid || updatedArtist.id || '').replace(/^artist_/, '').toLowerCase().trim();
          const cleanUpdatedName = (updatedArtist.name || '').toLowerCase().trim();
          updateMemoryTracksArtistAvatar(cleanUpdatedUid, updatedArtist.avatarUrl, updatedArtist.name);
          setAllArtists((prev) => {
            const idx = prev.findIndex((a) => {
              const aUid = (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim();
              return cleanUpdatedUid && aUid === cleanUpdatedUid;
            });
            let next: ArtistProfile[];
            if (idx >= 0) {
              next = [...prev];
              next[idx] = { ...next[idx], ...updatedArtist };
            } else {
              next = [updatedArtist, ...prev];
            }
            onArtistsSync?.(next);
            return next;
          });
          setAllTracks((prev) => {
            const next = prev.map((t) => {
              const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
              const tName = (t.artistName || '').toLowerCase().trim();
              if ((cleanUpdatedUid && tUid === cleanUpdatedUid) || (!tUid && cleanUpdatedName && tName === cleanUpdatedName)) {
                return {
                  ...t,
                  artistAvatarUrl: updatedArtist.avatarUrl || '',
                  artistName: updatedArtist.name || t.artistName,
                };
              }
              return t;
            });
            saveCachedCloudTracks(next);
            onTracksSync?.(next);
            return next;
          });
        }}
        allTracks={allTracks}
        onPlayTrack={(track, albCtx) => openSongPlayer(track, albCtx)}
        onAccountDeleted={(deletedUid) => {
          const cleanDeleted = deletedUid.replace(/^artist_/, '').toLowerCase().trim();
          removeMemoryArtistProfile(deletedUid);
          setAuthUser(null);
          setActiveArtistProfile(null);
          setAllArtists((prev) => {
            const next = prev.filter((a) => {
              const aUid = (a.googleUid || a.id || '').replace(/^artist_/, '').toLowerCase().trim();
              return aUid !== cleanDeleted;
            });
            onArtistsSync?.(next);
            return next;
          });
        }}
        onRemoveTrack={async (trackId) => {
          markSongAsDeleted(trackId);
          setAllTracks((prev) => {
            const next = prev.filter((t) => t.id !== trackId);
            saveCachedCloudTracks(next);
            onTracksSync?.(next);
            return next;
          });
          await Promise.allSettled([
            removeTrackFromStorage(trackId),
            deleteTrackFromCloud(trackId),
          ]);
        }}
      />

      {/* DEDICATED ALBUM VIEW MODAL */}
      <AlbumModal
        isOpen={!!selectedAlbum}
        onClose={() => setSelectedAlbum(null)}
        album={selectedAlbum}
        allTracks={allTracks}
        onPlayTrack={(track, albCtx) => openSongPlayer(track, albCtx ?? selectedAlbum)}
        lang={lang}
        onToggleLike={toggleFavorite}
        likedSongIds={likedSongIds}
        onOpenArtistProfile={(artistName, artistUid) => openArtistProfile(artistName, artistUid || selectedAlbum?.uploadedByUid)}
      />

      {/* GOOGLE OAUTH AUTH MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthModalError(null);
        }}
        lang={lang}
        initialMode={authModalMode}
        initialError={authModalError}
        onSuccess={(user) => {
          setAuthUser(user);
          setAuthModalError(null);
          setIsArtistPortalOpen(true);
        }}
      />
    </div>
  );
};
