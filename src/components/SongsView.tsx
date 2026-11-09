import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Heart,
  User,
  Plus,
  ShieldCheck,
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, Album } from '../types';
import {
  fetchAllRealSongs,
  getInstantSongPool,
  fetchLiveAudioFromArchive,
  deduplicateTracks,
  searchModern21stCenturyTracks,
  fetchAllArtistProfiles,
  checkTermsAcceptedInFirestore,
  saveTermsAcceptedToFirestore,
} from '../services/multiMusicService';
import { SongPlayerPage } from './SongPlayerPage';
import { TrackCoverArt } from './TrackCoverArt';
import { ArtistPortalModal } from './ArtistPortalModal';
import { ArtistProfileModal } from './ArtistProfileModal';
import { AdminPanelModal } from './AdminPanelModal';
import { AlbumModal } from './AlbumModal';
import { Logo } from './Logo';
import { TermsModal } from './TermsModal';
import { CookieBanner } from './CookieBanner';
import { DevToolsProtection } from './DevToolsProtection';
import {
  getArtistTracksFromFirebase,
  getArtistAccountsFromFirebase,
  testFirestoreConnection,
  onAuthUserChanged,
  saveArtistAccountToFirebase,
  getArtistAccountByGoogleUid,
  loginWithGoogle,
  deleteArtistTrackFromFirebase,
} from '../services/firebaseService';
import { fetchArtistProfilesFromGitHub } from '../services/githubStorageService';
import { User as FirebaseUser } from 'firebase/auth';
import { prewarmTrackColor, getFormattedPlayCount, getTrackInstantColor } from '../services/colorService';
import { persistTrackToStorage, removeTrackFromStorage } from '../services/localTrackStorage';
import { deleteTrackFromGitHubRepo, getStreamingMediaUrl } from '../services/githubStorageService';
import { markSongAsDeleted } from '../services/deletedTracksService';

interface SongsViewProps {
  lang: Language;
  onNavigateHome: () => void;
  onPlayTrack?: (track: JamendoTrack) => void;
}

export const SongsView: React.FC<SongsViewProps> = ({
  lang,
  onPlayTrack,
}) => {
  const isHe = lang === 'he';

  const [activeArtistProfile, setActiveArtistProfile] = useState<ArtistProfile | null>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_artist_account');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<'all' | 'favorites'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  const [isArtistPortalOpen, setIsArtistPortalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPromoBanner, setShowPromoBanner] = useState(true);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(() => {
    try {
      const cached = localStorage.getItem('wikiarchive_cached_auth_user');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

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

  // 10-Click Secret Admin Easter Egg counter
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleProfileClick = () => {
    stopAllGlobalAudio();
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);

    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      setIsAdminPanelOpen(true);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      if (clickCountRef.current < 10) {
        setIsArtistPortalOpen(true);
      }
      clickCountRef.current = 0;
    }, 350);
  };

  const handleGoogleSignInClick = async () => {
    try {
      const user = await loginWithGoogle();
      if (user) {
        setAuthUser(user);
        try {
          localStorage.setItem(
            'wikiarchive_cached_auth_user',
            JSON.stringify({
              uid: user.uid,
              displayName: user.displayName,
              photoURL: user.photoURL,
              email: user.email,
            })
          );
        } catch {}
        setIsArtistPortalOpen(true);
      }
    } catch (e) {
      console.warn('Google sign-in skipped or cancelled:', e);
    }
  };

  // Auth & Terms Gate
  useEffect(() => {
    const unsub = onAuthUserChanged(async (user) => {
      setAuthUser(user);
      if (user) {
        try {
          localStorage.setItem(
            'wikiarchive_cached_auth_user',
            JSON.stringify({
              uid: user.uid,
              displayName: user.displayName,
              photoURL: user.photoURL,
              email: user.email,
            })
          );
        } catch {}

        // Check terms in Firestore (one-time source of truth)
        const hasAccepted = await checkTermsAcceptedInFirestore(user.uid);
        if (hasAccepted) {
          localStorage.setItem('kolot_terms_accepted', 'true');
          setShowTermsModal(false);
        } else {
          setShowTermsModal(true);
        }

        // Always try to load profile from GitHub first (source of truth)
        const profiles = await fetchAllArtistProfiles();
        const myProfile = profiles.find(p => p.id === user.uid || p.googleUid === user.uid);
        if (myProfile) {
          setActiveArtistProfile(myProfile);
          localStorage.setItem('wikiarchive_artist_account', JSON.stringify(myProfile));
        }
      } else {
        localStorage.removeItem('wikiarchive_cached_auth_user');
        setShowTermsModal(false);
      }
    });
    return () => unsub();
  }, []);

  const handleAcceptTerms = async () => {
    if (!authUser) return;
    setShowTermsModal(false);
    localStorage.setItem('kolot_cookie_consent_accepted', 'true');
    localStorage.setItem('kolot_terms_accepted', 'true');
    
    // Save to Firestore so it's a one-time thing
    await saveTermsAcceptedToFirestore(authUser.uid, authUser.displayName || 'User');
    
    // Create bare profile if not exists
    const profiles = await fetchAllArtistProfiles();
    const existing = profiles.find(p => p.id === authUser.uid || p.googleUid === authUser.uid);
    if (!existing) {
      const updated: ArtistProfile = {
        id: authUser.uid,
        name: authUser.displayName || (isHe ? 'משתמש גוגל' : 'Google User'),
        avatarUrl: authUser.photoURL || undefined,
        googleUid: authUser.uid,
        googleEmail: authUser.email || undefined,
        isConnected: true,
        hasAcceptedTerms: true,
        acceptedTermsAt: new Date().toISOString(),
        isPrivate: true,
        tracksCount: 0,
        providerPlatform: 'חשבון גוגל',
      };
      setActiveArtistProfile(updated);
      localStorage.setItem('wikiarchive_artist_account', JSON.stringify(updated));
    }
  };

  // Search mode & results
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [profileArtistName, setProfileArtistName] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);

  // Song Pool
  const [allTracks, setAllTracks] = useState<JamendoTrack[]>(getInstantSongPool);
  const [allArtists, setAllArtists] = useState<ArtistProfile[]>([]);
  const [visibleSearchCount] = useState(150);

  // Favorites
  const [likedSongIds, setLikedSongIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_liked_songs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Randomized Spotlight Track Index on every site entry
  const [featuredTrackIndex] = useState<number>(() => Math.floor(Math.random() * 12));

  useEffect(() => {
    localStorage.setItem('wikiarchive_liked_songs', JSON.stringify(likedSongIds));
  }, [likedSongIds]);

  // Active playing song overlay (if not passed via onPlayTrack)
  const [playerTrack, setPlayerTrack] = useState<JamendoTrack | null>(null);

  // Mount effect - Instant 0-lag load
  useEffect(() => {
    // 1. Instantly populate from local cache & storage (0ms delay)
    const instant = getInstantSongPool();
    if (instant.length > 0) {
      setAllTracks(instant);
    }

    // 2. Fetch remote updates in parallel asynchronously
    Promise.allSettled([
      getArtistTracksFromFirebase(),
      getArtistAccountsFromFirebase(),
      fetchAllRealSongs(),
      fetchArtistProfilesFromGitHub(),
    ]).then(([fbTracksRes, fbAccountsRes, allSongsRes, ghProfilesRes]) => {
      if (fbTracksRes.status === 'fulfilled' && fbTracksRes.value?.length) {
        setAllTracks((prev) => deduplicateTracks([...fbTracksRes.value, ...prev]));
      }
      
      let combinedArtists: ArtistProfile[] = [];
      if (fbAccountsRes.status === 'fulfilled' && fbAccountsRes.value?.length) {
        combinedArtists = [...fbAccountsRes.value];
      }
      if (ghProfilesRes.status === 'fulfilled' && ghProfilesRes.value?.length) {
        // Merge GH profiles, preferring them over Firebase
        const ghProfiles = ghProfilesRes.value;
        const profileMap = new Map<string, ArtistProfile>();
        combinedArtists.forEach(a => profileMap.set(a.id, a));
        ghProfiles.forEach((p: any) => profileMap.set(p.id, p));
        combinedArtists = Array.from(profileMap.values());
      }
      
      if (combinedArtists.length > 0) {
        setAllArtists(combinedArtists.filter((a) => !(a.isPrivate && (!a.tracksCount || a.tracksCount === 0))));
      }

      if (allSongsRes.status === 'fulfilled' && allSongsRes.value?.length) {
        setAllTracks((prev) => deduplicateTracks([...allSongsRes.value, ...prev]));
      }
    });
  }, []);

  const openSongPlayer = (track: JamendoTrack) => {
    prewarmTrackColor(track);
    if (onPlayTrack) {
      onPlayTrack(track);
    } else {
      setPlayerTrack(track);
    }
  };

  const closeSongPlayer = () => {
    setPlayerTrack(null);
  };

  const toggleFavorite = (id: string) => {
    setLikedSongIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Modern live search debounce
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    const term = searchQuery.trim();

    const timer = setTimeout(async () => {
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

  const displayedTracks = React.useMemo(() => {
    let list = allTracks;
    if (activeTab === 'favorites') {
      list = list.filter((t) => likedSongIds.includes(t.id));
    }
    if (artistFilter) {
      list = list.filter((t) => t.artistName.toLowerCase().includes(artistFilter.toLowerCase()));
    }
    if (selectedGenre) {
      list = list.filter((t) => t.genre?.toLowerCase() === selectedGenre.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.artistName.toLowerCase().includes(q) ||
          t.genre?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allTracks, activeTab, likedSongIds, artistFilter, selectedGenre, searchQuery]);

  const searchArtistResults = searchQuery.trim()
    ? allArtists.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : allArtists;

  // Extract unique popular artists from both tracks and accounts with authentic imagery
  const popularArtists = React.useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl?: string; genre?: string; count: number }>();

    allArtists.forEach((a) => {
      if (a.name) {
        const key = a.name.toLowerCase().trim();
        const trackForCover = allTracks.find(
          (t) =>
            t.artistName?.toLowerCase().trim() === key &&
            (t.artistAvatarUrl || t.coverUrl)
        );
        const resolved = getStreamingMediaUrl(
          a.avatarUrl || trackForCover?.artistAvatarUrl || trackForCover?.coverUrl
        );

        map.set(key, {
          name: a.name,
          avatarUrl: resolved || undefined,
          genre: a.genre || 'אמן',
          count: a.tracksCount || 1,
        });
      }
    });

    allTracks.forEach((t) => {
      if (!t.artistName) return;
      const key = t.artistName.toLowerCase().trim();
      const trackImage = getStreamingMediaUrl(t.artistAvatarUrl || t.coverUrl);

      if (!map.has(key)) {
        map.set(key, {
          name: t.artistName,
          avatarUrl: trackImage || undefined,
          genre: t.genre || 'אמן',
          count: 1,
        });
      } else {
        const existing = map.get(key)!;
        existing.count += 1;
        if (!existing.avatarUrl && trackImage) {
          existing.avatarUrl = trackImage;
        }
      }
    });

    return Array.from(map.values()).slice(0, 15);
  }, [allArtists, allTracks]);

  // Popularity heuristic (plays count + favorite bonus + pseudo hash)
  const getTrackPopularity = React.useCallback(
    (t: JamendoTrack) => {
      const plays = t.playsCount || 0;
      const isLikedBonus = likedSongIds.includes(t.id) ? 60 : 0;
      let hash = 0;
      for (let i = 0; i < t.name.length; i++) {
        hash = (hash * 17 + t.name.charCodeAt(i)) % 40;
      }
      return plays + isLikedBonus + hash;
    },
    [likedSongIds]
  );

  // Row 1: Leading tracks sorted by highest plays and popularity
  const leadingTracks = React.useMemo(() => {
    return [...allTracks].sort((a, b) => getTrackPopularity(b) - getTrackPopularity(a));
  }, [allTracks, getTrackPopularity]);

  // Row 2: Popular albums synthesized from storage and tracks
  const popularAlbums = React.useMemo(() => {
    let storedAlbums: Album[] = [];
    try {
      const raw = localStorage.getItem('kolot_user_albums');
      if (raw) {
        storedAlbums = JSON.parse(raw);
      }
    } catch {
      // ignore
    }

    const albumMap = new Map<string, Album>();

    storedAlbums.forEach((a) => {
      if (a.title && a.id) {
        albumMap.set(a.title.toLowerCase().trim(), a);
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
        const key = `${t.artistName} - ${cleanAlbumName}`.toLowerCase().trim();
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `album-${t.id}`,
            title: cleanAlbumName,
            artistName: t.artistName,
            coverUrl: t.coverUrl,
            trackIds: [t.id],
            createdDate: t.publishedDate || new Date().toISOString(),
          });
        } else {
          const alb = albumMap.get(key)!;
          if (!alb.trackIds.includes(t.id)) {
            alb.trackIds.push(t.id);
          }
          if (!alb.coverUrl && t.coverUrl) {
            alb.coverUrl = t.coverUrl;
          }
        }
      }
    });

    return Array.from(albumMap.values()).filter((a) => {
      const lower = (a.title || '').toLowerCase().trim();
      return !invalidAlbumNames.has(lower) && !lower.startsWith('סינגל') && !lower.startsWith('single');
    });
  }, [allTracks]);

  // Rhythm sections for Spotify feed
  const newReleasesTracks = React.useMemo(() => {
    return allTracks.slice(0, 14);
  }, [allTracks]);

  const popTracks = React.useMemo(() => {
    return allTracks.filter((t) => t.genre === 'Pop' || !t.genre).slice(0, 14);
  }, [allTracks]);

  const chillTracks = React.useMemo(() => {
    return allTracks.filter((t) => t.genre === 'Chill' || t.genre === 'Electronic').slice(0, 14);
  }, [allTracks]);

  const isFilteredOrSearching =
    searchQuery.trim().length > 0 || !!artistFilter || !!selectedGenre || activeTab === 'favorites';

  return (
    <div
      className="h-screen overflow-hidden bg-[#000000] text-white font-sans flex flex-col antialiased selection:bg-[#1ed760] selection:text-black"
      dir={isHe ? 'rtl' : 'ltr'}
    >
      {/* DEVTOOLS SECURITY PROTECTION */}
      <DevToolsProtection />

      {/* MANDATORY TERMS OVERLAY */}
      <TermsModal isOpen={showTermsModal} onAccept={handleAcceptTerms} lang={lang} />

      {/* COOKIE CONSENT BANNER */}
      <CookieBanner lang={lang} currentUser={authUser} artistProfile={activeArtistProfile} />

      {/* FLOATING TOP NAVIGATION BAR */}
      <div className="px-3 sm:px-6 pt-2.5 pb-1 shrink-0 z-40">
        {/* DESKTOP HEADER (sm:flex) — Logo on Right (Start in RTL), Controls on Left (End in RTL) */}
        <header className="hidden sm:flex h-14 sm:h-15 w-full rounded-full bg-[#101010]/90 backdrop-blur-2xl border border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.7)] px-4 sm:px-7 items-center justify-between gap-4 select-none">
          {/* Logo (Start Side in RTL) - Sleek Metallic Heart Only */}
          <div className="flex items-center shrink-0 cursor-pointer py-1" onClick={() => {
            setSearchQuery('');
            setArtistFilter(null);
            setSelectedGenre(null);
            setActiveTab('all');
          }}>
            <Logo className="h-7 sm:h-8 md:h-8.5 w-auto" heartOnly={true} />
          </div>

          {/* Controls: Search Keyboard + Favorites + Profile (End Side in RTL) */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 max-w-2xl justify-end">
            {/* Search Input (Keyboard) */}
            <div className="relative flex-1 max-w-xs sm:max-w-sm">
              <div className="absolute inset-y-0 start-3 flex items-center pointer-events-none text-white/60">
                <Search className="w-4 h-4 text-white/60" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isHe ? 'מה תרצה לשמוע?' : 'What do you want to play?'}
                className="w-full h-9 ps-9 pe-9 bg-white/10 hover:bg-white/15 focus:bg-white/20 focus:outline-none focus:border-white/40 text-xs sm:text-sm text-white placeholder-white/50 rounded-full border border-white/15 shadow-inner backdrop-blur-md transition-all"
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

            {/* Favorites Button */}
            <button
              onClick={() => {
                setActiveTab((prev) => (prev === 'favorites' ? 'all' : 'favorites'));
              }}
              className={`flex items-center gap-1.5 px-3.5 h-9 rounded-full text-xs sm:text-sm font-normal transition-colors cursor-pointer shrink-0 border ${
                activeTab === 'favorites'
                  ? 'bg-white/25 text-white border-white/40 shadow-sm'
                  : 'bg-white/10 text-white/80 hover:text-white hover:bg-white/20 border-white/15'
              }`}
              title={isHe ? 'מועדפים' : 'Favorites'}
            >
              <Heart
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 text-white ${
                  activeTab === 'favorites' ? 'fill-white' : ''
                }`}
              />
              <span className="hidden xs:inline">{isHe ? 'מועדפים' : 'Favorites'}</span>
              {likedSongIds.length > 0 && (
                <span className="text-xs text-white/70">({likedSongIds.length})</span>
              )}
            </button>

            {/* User Profile Avatar / Google Login */}
            {!authUser ? (
              <button
                onClick={handleGoogleSignInClick}
                className="h-9 px-3.5 sm:px-4 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-white border border-white/20 font-normal text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 shadow-md transition-transform active:scale-95 cursor-pointer shrink-0"
              >
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span className="whitespace-nowrap">{isHe ? 'המשך דרך גוגל' : 'Log in'}</span>
              </button>
            ) : (
              <button
                onClick={handleProfileClick}
                className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/30 text-white flex items-center justify-center overflow-hidden cursor-pointer transition-all shadow-md shrink-0"
                title={authUser.displayName || (isHe ? 'פרופיל' : 'Profile')}
              >
                {authUser.photoURL || activeArtistProfile?.avatarUrl ? (
                  <img
                    src={authUser.photoURL || activeArtistProfile?.avatarUrl || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-bold text-white">
                    {(authUser.displayName || activeArtistProfile?.name)?.[0]?.toUpperCase() || 'U'}
                  </span>
                )}
              </button>
            )}
          </div>
        </header>

        {/* MOBILE HEADER (flex sm:hidden) — ONLY Metallic Heart Emblem at top */}
        <header className="flex sm:hidden h-12 w-full rounded-full bg-[#101010]/90 backdrop-blur-2xl border border-white/15 shadow-[0_4px_20px_rgba(0,0,0,0.8)] px-4 items-center justify-center select-none cursor-pointer" onClick={() => {
          setSearchQuery('');
          setArtistFilter(null);
          setSelectedGenre(null);
          setActiveTab('all');
        }}>
          <Logo className="h-7 w-auto" heartOnly={true} />
        </header>
      </div>

      {/* MOBILE FLOATING BOTTOM NAVIGATION ELLIPSE / PILL BAR (sm:hidden) */}
      <div className="fixed bottom-3 start-3 end-3 sm:hidden z-50 rounded-full bg-[#161616]/95 backdrop-blur-2xl border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.9)] px-3 py-2 flex items-center justify-between gap-2 text-white select-none transition-all duration-300">
        {/* Mobile Profile / Google Sign-in */}
        {!authUser ? (
          <button
            onClick={handleGoogleSignInClick}
            className="h-9 px-3 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-white border border-white/20 font-normal text-xs flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer shrink-0"
            title={isHe ? 'המשך דרך גוגל' : 'Log in'}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span className="whitespace-nowrap text-[11px] font-medium">{isHe ? 'גוגל' : 'Google'}</span>
          </button>
        ) : (
          <button
            onClick={handleProfileClick}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/30 text-white flex items-center justify-center overflow-hidden cursor-pointer transition-all shadow-md shrink-0"
            title={authUser.displayName || (isHe ? 'פרופיל' : 'Profile')}
          >
            {authUser.photoURL || activeArtistProfile?.avatarUrl ? (
              <img
                src={authUser.photoURL || activeArtistProfile?.avatarUrl || ''}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-xs font-bold text-white">
                {(authUser.displayName || activeArtistProfile?.name)?.[0]?.toUpperCase() || 'U'}
              </span>
            )}
          </button>
        )}

        {/* Mobile Favorites Button */}
        <button
          onClick={() => {
            setActiveTab((prev) => (prev === 'favorites' ? 'all' : 'favorites'));
          }}
          className={`flex items-center gap-1 px-3 h-9 rounded-full text-xs font-normal transition-colors cursor-pointer shrink-0 border ${
            activeTab === 'favorites'
              ? 'bg-white/25 text-white border-white/40 shadow-sm'
              : 'bg-white/10 text-white/80 hover:text-white hover:bg-white/20 border-white/15'
          }`}
          title={isHe ? 'מועדפים' : 'Favorites'}
        >
          <Heart
            className={`w-3.5 h-3.5 text-white ${
              activeTab === 'favorites' ? 'fill-white' : ''
            }`}
          />
          {likedSongIds.length > 0 && (
            <span className="text-[10px] text-white/80 font-bold">({likedSongIds.length})</span>
          )}
        </button>

        {/* Mobile Search Input Keyboard */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 start-2.5 flex items-center pointer-events-none text-white/60">
            <Search className="w-3.5 h-3.5 text-white/60" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isHe ? 'חיפוש שירים...' : 'Search songs...'}
            className="w-full h-9 ps-8 pe-7 bg-white/10 hover:bg-white/15 focus:bg-white/20 focus:outline-none focus:ring-1 focus:ring-white/40 text-xs text-white placeholder-white/50 rounded-full border border-white/20 backdrop-blur-md transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 end-2.5 flex items-center text-white/60 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* MAIN LAYOUT — SINGLE CLEAN SCROLLABLE CONTAINER */}
      <div className="flex-1 flex overflow-hidden px-3 sm:px-6 pb-2 gap-2">
        {/* FLUID MAIN CONTENT AREA — Pristine 100% pitch black surface without gray cards */}
        <main className="flex-1 bg-black border-none overflow-y-auto custom-scrollbar flex flex-col pb-24 sm:pb-0">
          {/* Active Filter or Search Banner if filtering */}
          {isFilteredOrSearching && (
            <div className="p-4 sm:p-6 pb-3 border-b border-white/10 bg-black flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {searchQuery.trim()
                    ? isHe
                      ? `תוצאות חיפוש עבור "${searchQuery}"`
                      : `Search results for "${searchQuery}"`
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
                      ? `ז'אנר: ${selectedGenre}`
                      : `Genre: ${selectedGenre}`
                    : isHe
                    ? 'כל השירים'
                    : 'All Songs'}
                </h1>
                <p className="text-xs text-[#b3b3b3] mt-1">
                  {displayedTracks.length} {isHe ? 'שירים נמצאו' : 'songs found'}
                </p>
              </div>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setArtistFilter(null);
                  setSelectedGenre(null);
                  setActiveTab('all');
                }}
                className="px-3 py-1.5 rounded-[9999px] bg-white/10 hover:bg-white/20 text-xs font-medium text-white transition-colors cursor-pointer border border-white/10"
              >
                {isHe ? 'איפוס סינון' : 'Clear Filter'}
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
                  const trackForCover = allTracks.find(
                    (t) =>
                      t.artistName?.toLowerCase().trim() === artist.name?.toLowerCase().trim() &&
                      (t.artistAvatarUrl || t.coverUrl)
                  );
                  const effectiveArtistImg = getStreamingMediaUrl(
                    artist.avatarUrl || trackForCover?.artistAvatarUrl || trackForCover?.coverUrl
                  );

                  return (
                    <div
                      key={artist.id}
                      onClick={() => setProfileArtistName(artist.name)}
                      className="group p-3 rounded-[10px] bg-white/[0.04] hover:bg-white/[0.10] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col items-center border border-white/10 hover:border-white/20 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                    >
                      <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                        {effectiveArtistImg ? (
                          <img
                            src={effectiveArtistImg}
                            alt={artist.name}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white font-black text-xl bg-gradient-to-tr from-white/10 to-white/5">
                            {artist.name[0] || <User className="w-10 h-10 text-white/50" />}
                          </div>
                        )}
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

          {/* MAIN VERTICAL FEED */}
          {isFilteredOrSearching ? (
            /* Flat Grid for Filter/Search Results */
            <div className="p-4 sm:p-6 flex-1">
              {displayedTracks.length === 0 ? (
                <div className="text-center py-24 space-y-4 max-w-md mx-auto">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto text-white/40 border border-white/10 backdrop-blur-md">
                    <Search className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-white">
                    {isHe ? 'לא נמצאו שירים תואמים' : 'No matching songs found'}
                  </h3>
                  <p className="text-xs text-white/60">
                    {isHe
                      ? 'נסה לבדוק שגיאות איות או חפש מונח אחר'
                      : 'Please check your spelling or try searching for another term.'}
                  </p>
                  <button
                    onClick={() => setIsArtistPortalOpen(true)}
                    className="mt-2 px-5 py-2.5 rounded-[9999px] bg-white text-black font-medium text-xs hover:bg-white/90 transition-colors cursor-pointer shadow-sm"
                  >
                    {isHe ? 'העלה שיר ראשון לקטגוריה זו' : 'Upload first song'}
                  </button>
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
                              setProfileArtistName(track.artistName);
                            }}
                            className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                          >
                            {track.artistName}
                          </p>
                        </div>

                        {/* Metadata indicator with favorite button */}
                        <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                          <span className="text-[10px] text-white/50 font-medium truncate">
                            {track.genre || 'Music'}
                          </span>
                          <button
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
                                  ? 'fill-rose-500 text-rose-500'
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
            <div className="p-4 sm:p-6 space-y-10 flex-1">
              {/* DESKTOP LUXURY HERO SPOTLIGHT BANNER */}
              {(() => {
                const featuredTrack = leadingTracks[featuredTrackIndex % leadingTracks.length] || leadingTracks[0];
                if (!featuredTrack) return null;

                const artistProfileObj = allArtists.find(
                  (a) => a.name?.toLowerCase().trim() === featuredTrack.artistName?.toLowerCase().trim()
                );
                const artistAvatarImg = getStreamingMediaUrl(
                  artistProfileObj?.avatarUrl || featuredTrack.artistAvatarUrl || featuredTrack.coverUrl
                );

                return (
                  <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-black border border-white/15 p-5 sm:p-8 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                    {/* Subtle Ambient Radial Glow */}
                    <div className="absolute -top-24 -end-24 w-96 h-96 bg-white/[0.06] rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-20 -start-20 w-80 h-80 bg-white/[0.04] rounded-full blur-3xl pointer-events-none" />

                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 sm:gap-8 justify-between">
                      {/* Track Info (Right side in RTL) */}
                      <div className="flex-1 text-center md:text-start space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[11px] sm:text-xs font-medium text-white/90 backdrop-blur-md shadow-sm">
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                          <span>{isHe ? 'בחירת העורכים • שיר השבוע' : "Editor's Choice • Track of the Week"}</span>
                        </div>

                        <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                          {featuredTrack.name}
                        </h1>

                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs sm:text-sm text-white/70">
                          <button
                            onClick={() => setProfileArtistName(featuredTrack.artistName)}
                            className="font-medium text-white hover:underline flex items-center gap-1.5"
                          >
                            <span>{featuredTrack.artistName}</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                          </button>
                          <span>{featuredTrack.genre || (isHe ? 'מוזיקה' : 'Music')}</span>
                          {featuredTrack.albumName && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
                              <span className="text-white/60">{featuredTrack.albumName}</span>
                            </>
                          )}
                        </div>

                        <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                          <button
                            onClick={() => openSongPlayer(featuredTrack)}
                            className="px-6 sm:px-7 py-3 rounded-full bg-white text-black font-bold text-xs sm:text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_8px_25px_rgba(255,255,255,0.25)] flex items-center gap-2.5 cursor-pointer"
                          >
                            <Play className="w-4 h-4 fill-black text-black" />
                            <span>{isHe ? 'האזן עכשיו' : 'Play Now'}</span>
                          </button>

                          <button
                            onClick={() => toggleFavorite(featuredTrack.id)}
                            className={`p-3 rounded-full border transition-all cursor-pointer active:scale-95 ${
                              likedSongIds.includes(featuredTrack.id)
                                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                                : 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                            }`}
                            title={isHe ? 'הוסף למועדפים' : 'Favorite'}
                          >
                            <Heart
                              className={`w-4 h-4 ${
                                likedSongIds.includes(featuredTrack.id) ? 'fill-rose-500 text-rose-500' : ''
                              }`}
                            />
                          </button>

                          {/* Artist Profile Avatar Button */}
                          <button
                            onClick={() => setProfileArtistName(featuredTrack.artistName)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs sm:text-sm font-medium text-white transition-all cursor-pointer shadow-md active:scale-95"
                          >
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-white/20 shrink-0 border border-white/30 flex items-center justify-center">
                              {artistAvatarImg ? (
                                <img src={artistAvatarImg} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <User className="w-3.5 h-3.5 text-white" />
                              )}
                            </div>
                            <span>{featuredTrack.artistName}</span>
                          </button>
                        </div>
                      </div>

                      {/* Big Artwork Showcase (Left side in RTL) */}
                      <div
                        onClick={() => openSongPlayer(featuredTrack)}
                        className="relative w-44 h-44 sm:w-52 sm:h-52 md:w-60 md:h-60 rounded-2xl sm:rounded-3xl overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.85)] border border-white/25 shrink-0 group cursor-pointer"
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

              {/* QUICK ACCESS MIXES STRIP (Desktop Grid) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
                {[
                  {
                    title: isHe ? 'השירים המובילים' : 'Top Hits',
                    action: () => {
                      setActiveTab('all');
                      setSelectedGenre(null);
                      setArtistFilter(null);
                    },
                    icon: Play,
                    cover: leadingTracks[0]?.coverUrl,
                  },
                  {
                    title: isHe ? 'השירים שאהבת' : 'Liked Songs',
                    action: () => setActiveTab('favorites'),
                    icon: Heart,
                    cover: null,
                    count: likedSongIds.length,
                  },
                  {
                    title: isHe ? 'חדש במוזיקה' : 'New Releases',
                    action: () => {
                      if (newReleasesTracks[0]) openSongPlayer(newReleasesTracks[0]);
                    },
                    icon: Sparkles,
                    cover: newReleasesTracks[0]?.coverUrl,
                  },
                  {
                    title: isHe ? 'צ׳יל ורגיעה' : 'Chill Vibes',
                    action: () => {
                      setSelectedGenre('Chill');
                    },
                    icon: Disc,
                    cover: chillTracks[0]?.coverUrl,
                  },
                  {
                    title: isHe ? 'להיטי פופ' : 'Pop Bangers',
                    action: () => {
                      setSelectedGenre('Pop');
                    },
                    icon: Play,
                    cover: popTracks[0]?.coverUrl,
                  },
                  {
                    title: isHe ? 'אלבומים מובחרים' : 'Featured Albums',
                    action: () => {
                      if (popularAlbums[0]) setSelectedAlbum(popularAlbums[0]);
                    },
                    icon: Disc,
                    cover: popularAlbums[0]?.coverUrl,
                  },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={item.action}
                    className="group flex items-center gap-3 p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.10] border border-white/10 hover:border-white/25 backdrop-blur-md transition-all text-start cursor-pointer shadow-sm active:scale-98 overflow-hidden"
                  >
                    <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0 overflow-hidden border border-white/15">
                      {item.cover ? (
                        <img src={getStreamingMediaUrl(item.cover)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <item.icon className="w-4 h-4 text-white fill-white/20" />
                      )}
                    </div>
                    <span className="text-xs font-semibold text-white truncate flex-1">{item.title}</span>
                  </button>
                ))}
              </div>

              {/* ROW 1: השירים המובילים (Leading Songs by Popularity / Plays) */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                      {isHe ? 'השירים המובילים' : 'Leading songs'}
                    </h2>
                    <p className="text-xs text-white/60 mt-0.5 font-normal">
                      {isHe ? 'השירים המושמעים והמבוקשים ביותר באתר' : 'Most played and popular tracks'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTab('all');
                      setSelectedGenre(null);
                      setArtistFilter(null);
                    }}
                    className="text-xs font-normal text-white/60 hover:underline hover:text-white transition-colors cursor-pointer"
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
                      className="group relative w-44 sm:w-48 shrink-0 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
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
                            setProfileArtistName(track.artistName);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {track.artistName}
                        </p>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span className="text-[10px] text-white/50 font-medium truncate">
                          {track.genre || 'Music'}
                        </span>
                        <button
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
                                ? 'fill-rose-500 text-rose-500'
                                : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ROW 2: אלבומים פופולאריים (Popular Albums Carousel) */}
              {popularAlbums.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                        {isHe ? 'אלבומים פופולאריים' : 'Popular albums'}
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5 font-normal">
                        {isHe ? 'אלבומים ואוספים מובחרים של האמנים המובילים' : 'Featured albums and collections'}
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
                          className="group relative w-44 sm:w-48 shrink-0 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                        >
                          <div>
                            {/* Album Cover Art */}
                            <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                              {coverToUse ? (
                                <img
                                  src={getStreamingMediaUrl(coverToUse)}
                                  alt={album.title}
                                  className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                                />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 via-neutral-900 to-black text-white/80 p-3">
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
                                setProfileArtistName(album.artistName);
                              }}
                              className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                            >
                              {album.artistName}
                            </p>
                          </div>

                          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                            <span>
                              {album.trackIds?.length || 0} {isHe ? 'שירים' : 'tracks'}
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
                      const trackForCover = allTracks.find(
                        (t) =>
                          t.artistName?.toLowerCase().trim() === artist.name?.toLowerCase().trim() &&
                          (t.artistAvatarUrl || t.coverUrl)
                      );
                      const effectiveImg = getStreamingMediaUrl(
                        artist.avatarUrl || trackForCover?.artistAvatarUrl || trackForCover?.coverUrl
                      );

                      return (
                        <div
                          key={idx}
                          onClick={() => setProfileArtistName(artist.name)}
                          className="group w-36 sm:w-40 shrink-0 p-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col items-center border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                        >
                          {/* Circular Avatar */}
                          <div className="relative aspect-square w-full rounded-full overflow-hidden mb-3 bg-white/5 shadow-sm border border-white/10">
                            {effectiveImg ? (
                              <img
                                src={effectiveImg}
                                alt={artist.name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.currentTarget as HTMLElement).style.display = 'none';
                                }}
                                className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-white font-black text-xl bg-gradient-to-tr from-white/10 to-white/5">
                                {artist.name[0] || <User className="w-12 h-12 text-white/40" />}
                              </div>
                            )}
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
                      className="group relative w-44 sm:w-48 shrink-0 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.09] backdrop-blur-md transition-all duration-200 cursor-pointer flex flex-col justify-between border border-white/10 hover:border-white/25 shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
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
                            setProfileArtistName(track.artistName);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {track.artistName}
                        </p>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span className="text-white/60 text-[10px] font-medium truncate">
                          {track.genre || 'Music'}
                        </span>
                        <button
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
                                ? 'fill-rose-500 text-rose-500'
                                : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ROW 5: להיטים עולמיים ומקומיים (Pop & Rock) */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                      {isHe ? 'להיטים עולמיים ומקומיים' : 'Global & Local Hits'}
                    </h2>
                    <p className="text-xs text-white/60 mt-0.5 font-normal">
                      {isHe ? 'מקצבים סוחפים, פופ ורוק' : 'Rhythmic pop and rock anthems'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                  {popTracks.slice(0, 7).map((track, idx) => (
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
                            setProfileArtistName(track.artistName);
                          }}
                          className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                        >
                          {track.artistName}
                        </p>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                        <span className="text-white/60 text-[10px] font-medium truncate">
                          {track.genre || 'Music'}
                        </span>
                        <button
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
                                ? 'fill-rose-500 text-rose-500'
                                : 'text-white/40 hover:text-white'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ROW 6: צ׳יל ומוזיקה מרגיעה (Chill & Electronic) */}
              {chillTracks.length > 0 && (
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                        {isHe ? 'צ׳יל ומוזיקה מרגיעה' : 'Chill & Relaxing'}
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5 font-normal">
                        {isHe ? 'מוזיקה לרוגע, ריכוז ושקט פנימי' : 'Ambient, lo-fi and electronic vibes'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
                    {chillTracks.slice(0, 7).map((track, idx) => (
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
                            {track.isAiGenerated && (
                              <span className="px-1 py-0.2 rounded bg-purple-900/60 border border-purple-400/40 text-purple-200 text-[9px] font-black shrink-0">
                                AI
                              </span>
                            )}
                          </div>
                          <p
                            onClick={(e) => {
                              e.stopPropagation();
                              setProfileArtistName(track.artistName);
                            }}
                            className="text-xs text-white/60 truncate mt-1 hover:underline hover:text-white"
                          >
                            {track.artistName}
                          </p>
                        </div>

                        <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                          <span className="text-white/60 text-[10px] font-medium truncate">
                            {track.genre || 'Music'}
                          </span>
                          <button
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
                                  ? 'fill-rose-500 text-rose-500'
                                  : 'text-white/40 hover:text-white'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>


      {/* FULL-PAGE SONG PLAYER OVERLAY (ONLY IF DIRECTLY INLINE, THOUGH APP.TSX MANAGES IT NORMALLY) */}
      <AnimatePresence>
        {playerTrack && (
          <SongPlayerPage
            track={playerTrack}
            onBack={closeSongPlayer}
            onFilterByArtist={(artist) => {
              setArtistFilter(artist);
              closeSongPlayer();
            }}
            isLiked={likedSongIds.includes(playerTrack.id)}
            onToggleLike={toggleFavorite}
            lang={lang}
            allTracks={allTracks}
            onPlayTrack={(track) => setPlayerTrack(track)}
            onRemoveTrack={async (trackId) => {
              markSongAsDeleted(trackId);
              setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
              if (playerTrack?.id === trackId) {
                closeSongPlayer();
              }
              await Promise.allSettled([
                removeTrackFromStorage(trackId),
                deleteArtistTrackFromFirebase(trackId),
                deleteTrackFromGitHubRepo(trackId),
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
            isOpen={!!profileArtistName}
            onClose={() => setProfileArtistName(null)}
            allTracks={Array.isArray(allTracks) ? allTracks : []}
            allArtists={allArtists}
            onPlayTrack={(track) => openSongPlayer(track)}
            lang={lang}
            onToggleLike={toggleFavorite}
            likedSongIds={likedSongIds}
            onOpenPortal={() => {
              setProfileArtistName(null);
              setIsArtistPortalOpen(true);
            }}
            onRemoveTrack={async (trackId) => {
              markSongAsDeleted(trackId);
              setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
              await Promise.allSettled([
                removeTrackFromStorage(trackId),
                deleteArtistTrackFromFirebase(trackId),
                deleteTrackFromGitHubRepo(trackId),
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
          try {
            const saved = localStorage.getItem('wikiarchive_artist_account');
            setActiveArtistProfile(saved ? JSON.parse(saved) : null);
          } catch {
            // ignore
          }
        }}
        lang={lang}
        onTrackPublished={async (newTrack) => {
          setAllTracks((prev) => deduplicateTracks([newTrack, ...prev]));
          await persistTrackToStorage(newTrack);
        }}
        allTracks={allTracks}
        onPlayTrack={(track) => openSongPlayer(track)}
        onRemoveTrack={async (trackId) => {
          markSongAsDeleted(trackId);
          setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
          await Promise.allSettled([
            removeTrackFromStorage(trackId),
            deleteArtistTrackFromFirebase(trackId),
            deleteTrackFromGitHubRepo(trackId),
          ]);
        }}
      />

      {/* DEDICATED ALBUM VIEW MODAL */}
      <AlbumModal
        isOpen={!!selectedAlbum}
        onClose={() => setSelectedAlbum(null)}
        album={selectedAlbum}
        allTracks={allTracks}
        onPlayTrack={(track) => openSongPlayer(track)}
        lang={lang}
        onToggleLike={toggleFavorite}
        likedSongIds={likedSongIds}
        onOpenArtistProfile={(artistName) => setProfileArtistName(artistName)}
      />

      {/* SECRET 10-CLICK ADMIN PANEL MODAL */}
      <AdminPanelModal
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
        lang={lang}
        allTracks={allTracks}
        artistProfiles={allArtists}
        onRemoveTrack={async (trackId) => {
          markSongAsDeleted(trackId);
          setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
          await Promise.allSettled([
            removeTrackFromStorage(trackId),
            deleteArtistTrackFromFirebase(trackId),
            deleteTrackFromGitHubRepo(trackId),
          ]);
        }}
      />
    </div>
  );
};
