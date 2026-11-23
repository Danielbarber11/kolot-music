import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react';
import { SongsView } from './components/SongsView';
import { SongPlayerPage } from './components/SongPlayerPage';
import { SplashScreen } from './components/SplashScreen';
import { Language, JamendoTrack, ArtistProfile, Album } from './types';
import {
  getInstantSongPool,
  fetchBootstrapData,
  fetchAllRealSongs,
  getCachedArtistProfiles,
  getCachedAlbums,
  incrementTrackViewInMemory,
  syncTrackViewFromServer,
  removeTrackFromMemory,
  TRACK_SUBTITLES_UPDATED_EVENT,
  TRACK_VIEWS_UPDATED_EVENT,
  TRACK_UPDATED_EVENT,
  TRACK_DELETED_EVENT,
  ALBUMS_UPDATED_EVENT,
} from './services/multiMusicService';
import {
  getStreamingMediaUrl,
  incrementTrackViewsInCloud,
  fetchSingleTrackFromCloud,
  fetchSingleTrackStatusFromCloud,
  isTrackViewIncrementPending,
} from './services/cloudStorageService';
import { SecurityGuard } from './components/SecurityGuard';
import { activateIosPlaybackSession } from './services/iosAudioHelper';
import { AccessibilityPage } from './components/AccessibilityPage';
import {
  AccessibilitySettings,
  PointerCapabilities,
  loadAccessibilitySettings,
  saveAccessibilitySettings,
  applyAccessibilitySettingsToDom,
  countActiveAccessibilityFeatures,
  detectPointerCapabilities,
  subscribePointerCapabilities,
} from './services/accessibilityService';
import { AuthUser, onAuthUserChanged, loginWithGoogle } from './services/authService';
import {
  getUserFavorites,
  toggleUserFavorite,
  FAVORITES_CHANGED_EVENT,
} from './services/favoritesService';
import { prewarmTrackColor } from './services/colorService';
import { trackPageView, trackSongPlay } from './services/analyticsService';

function getSongIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = new URLSearchParams(window.location.search).get('song');
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function syncSongQueryParam(trackId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (trackId) {
      url.searchParams.set('song', trackId);
    } else {
      url.searchParams.delete('song');
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, '', nextUrl);
  } catch {}
}

function preloadAndDecodeImages(urls: Array<string | undefined>): Promise<void> {
  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((u) => (u ? getStreamingMediaUrl(u) : ''))
        .filter((u) => !!u && (u.startsWith('http') || u.startsWith('/') || u.startsWith('data:')))
    )
  ).slice(0, 32);

  if (uniqueUrls.length === 0) return Promise.resolve();

  return Promise.allSettled(
    uniqueUrls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.referrerPolicy = 'no-referrer';
          img.onload = () => {
            if (typeof img.decode === 'function') {
              img.decode().catch(() => {}).finally(resolve);
            } else {
              resolve();
            }
          };
          img.onerror = () => resolve();
          img.src = url;
        })
    )
  ).then(() => {});
}

export default function App() {
  const [lang] = useState<Language>('he');
  const [activePlayerTrack, setActivePlayerTrack] = useState<JamendoTrack | null>(null);
  const [activeAlbumContext, setActiveAlbumContext] = useState<Album | null>(null);
  const [isInitializing, setIsInitializing] = useState(() => getInstantSongPool().length === 0);
  const [allTracks, setAllTracks] = useState<JamendoTrack[]>(() => getInstantSongPool());
  const [allArtists, setAllArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());
  const [allAlbums, setAllAlbums] = useState<Album[]>(() => getCachedAlbums());
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [removedSongNotice, setRemovedSongNotice] = useState(false);
  const pendingDeepLinkRef = React.useRef<string | null>(getSongIdFromUrl());

  const [a11ySettings, setA11ySettings] = useState<AccessibilitySettings>(() => {
    const loaded = loadAccessibilitySettings();
    applyAccessibilitySettingsToDom(loaded);
    return loaded;
  });
  const [pointerCaps, setPointerCaps] = useState<PointerCapabilities>(() => detectPointerCapabilities());
  const [isAccessibilityOpen, setIsAccessibilityOpen] = useState(false);
  const [guideY, setGuideY] = useState<number>(220);

  useEffect(() => subscribePointerCapabilities(setPointerCaps), []);

  const handleUpdateAccessibility = (next: AccessibilitySettings) => {
    setA11ySettings(next);
    saveAccessibilitySettings(next);
    applyAccessibilitySettingsToDom(next);
  };

  useEffect(() => {
    applyAccessibilitySettingsToDom(a11ySettings);
  }, [a11ySettings]);

  useEffect(() => {
    if (!a11ySettings.readingGuide || !pointerCaps.hasFinePointer) return;
    const handleMove = (e: MouseEvent) => {
      setGuideY(e.clientY);
    };
    window.addEventListener('mousemove', handleMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [a11ySettings.readingGuide, pointerCaps.hasFinePointer]);

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [likedSongIds, setLikedSongIds] = useState<string[]>([]);

  useEffect(() => {
    const unsub = onAuthUserChanged((user) => {
      setAuthUser(user);
      setLikedSongIds(user?.uid ? getUserFavorites(user.uid) : []);
    });
    const handleFavoritesSync = () => {
      setLikedSongIds(() => {
        if (!authUser?.uid) return [];
        return getUserFavorites(authUser.uid);
      });
    };
    window.addEventListener(FAVORITES_CHANGED_EVENT, handleFavoritesSync);
    return () => {
      unsub();
      window.removeEventListener(FAVORITES_CHANGED_EVENT, handleFavoritesSync);
    };
  }, [authUser?.uid]);

  const handleEnterTrack = (track: JamendoTrack, albumContext?: Album | null) => {
    activateIosPlaybackSession();
    const existingTrack = allTracks.find((t) => t.id === track.id);
    const currentViews = Math.max(existingTrack?.viewsCount ?? 0, track.viewsCount ?? 0);
    const nextViews = currentViews + 1;
    const updatedTrack: JamendoTrack = {
      ...(existingTrack || track),
      ...track,
      viewsCount: nextViews,
    };

    incrementTrackViewInMemory(track.id);
    setAllTracks((prev) =>
      prev.some((t) => t.id === track.id)
        ? prev.map((t) => (t.id === track.id ? { ...t, viewsCount: nextViews } : t))
        : prev
    );
    setActiveAlbumContext(albumContext ?? null);
    syncSongQueryParam(track.id);
    setActivePlayerTrack(updatedTrack);
    trackPageView(`/?song=${encodeURIComponent(track.id)}`, track.name);

    void incrementTrackViewsInCloud(track).then((serverViews) => {
      if (typeof serverViews === 'number' && Number.isFinite(serverViews)) {
        trackSongPlay({ ...track, viewsCount: serverViews });
      } else {
        trackSongPlay({ ...track, viewsCount: nextViews });
        fetchSingleTrackFromCloud(track.id)
          .then((fresh) => {
            if (fresh && typeof fresh.viewsCount === 'number' && !isTrackViewIncrementPending(track.id)) {
              syncTrackViewFromServer(track.id, Number(fresh.viewsCount), true);
            }
          })
          .catch(() => {});
      }
    });
  };

  const lastCloudSyncRef = React.useRef<number>(Date.now());

  const refreshCloudTracksInBackground = React.useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastCloudSyncRef.current < 2500) return;
    lastCloudSyncRef.current = now;
    fetchAllRealSongs()
      .then((fresh) => {
        if (!Array.isArray(fresh) || fresh.length === 0) return;
        setAllTracks(fresh);
        setActivePlayerTrack((cur) => {
          if (!cur) return cur;
          const match = fresh.find((t) => t.id === cur.id);
          if (!match) return cur;
          const authoritativeViews = isTrackViewIncrementPending(cur.id)
            ? Math.max(Number(cur.viewsCount) || 0, Number(match.viewsCount) || 0)
            : Number(match.viewsCount) || 0;
          return {
            ...cur,
            ...match,
            viewsCount: authoritativeViews,
            playsCount: Math.max(Number(cur.playsCount) || 0, Number(match.playsCount) || 0),
          };
        });
      })
      .catch(() => {});
  }, []);

  const handleExitTrack = () => {
    syncSongQueryParam(null);
    trackPageView('/', 'Kolot Music');
    setActivePlayerTrack(null);
    setActiveAlbumContext(null);
    refreshCloudTracksInBackground(true);
  };

  // Coordinate single-roundtrip /api/bootstrap + color prewarming + top cover & avatar image decode BEFORE dismissing SplashScreen
  // Also open shared ?song=TRACK_ID links immediately once loaded.
  useEffect(() => {
    trackPageView('/', 'Kolot Music');
    let active = true;

    const openRequestedSong = async (tracksPool: JamendoTrack[]) => {
      const requestedId = pendingDeepLinkRef.current;
      if (!requestedId || !active) return;
      pendingDeepLinkRef.current = null;
      let targetTrack = tracksPool.find((t) => t.id === requestedId) || null;
      if (!targetTrack) {
        const res = await fetchSingleTrackStatusFromCloud(requestedId).catch(() => ({ status: 'error' as const }));
        if (res.status === 'deleted' && active) {
          removeTrackFromMemory(requestedId);
          syncSongQueryParam(null);
          setRemovedSongNotice(true);
          return;
        }
        if (res.status === 'found') {
          targetTrack = res.track;
        }
      }
      if (targetTrack && active) {
        const nextViews = (Number(targetTrack.viewsCount) || 0) + 1;
        const hydrated = { ...targetTrack, viewsCount: nextViews };
        incrementTrackViewInMemory(targetTrack.id);
        setAllTracks((prev) =>
          prev.some((t) => t.id === targetTrack!.id)
            ? prev.map((t) => (t.id === targetTrack!.id ? hydrated : t))
            : [hydrated, ...prev]
        );
        trackPageView(`/?song=${encodeURIComponent(targetTrack.id)}`, targetTrack.name);
        setActiveAlbumContext(null);
        setActivePlayerTrack(hydrated);
        void incrementTrackViewsInCloud(targetTrack).then((serverViews) => {
          trackSongPlay({ ...targetTrack!, viewsCount: serverViews ?? nextViews });
        });
      }
    };

    const preloadDataAndTopCovers = async () => {
      try {
        const boot = await fetchBootstrapData();
        if (!active) return;
        setAllTracks(boot.tracks);
        setAllArtists(boot.profiles);
        setAllAlbums(boot.albums);

        if (pendingDeepLinkRef.current) {
          void openRequestedSong(boot.tracks);
        }

        boot.tracks.slice(0, 12).forEach((t) => prewarmTrackColor(t));

        const topImageUrls = [
          ...boot.tracks.slice(0, 16).map((t) => t.coverUrl),
          ...boot.profiles.slice(0, 12).map((a) => a.avatarUrl),
          ...boot.albums.slice(0, 8).map((al) => al.coverUrl),
        ];
        void preloadAndDecodeImages(topImageUrls);
      } catch {
        // Non-fatal
      }
    };

    const maxWait = new Promise<void>((resolve) => setTimeout(resolve, 800));

    Promise.race([preloadDataAndTopCovers(), maxWait]).finally(() => {
      if (active) setIsInitializing(false);
    });

    const handlePopState = () => {
      const songFromUrl = getSongIdFromUrl();
      if (!songFromUrl) {
        setActivePlayerTrack(null);
        setActiveAlbumContext(null);
        return;
      }
      pendingDeepLinkRef.current = songFromUrl;
      void openRequestedSong(getInstantSongPool());
    };
    window.addEventListener('popstate', handlePopState);

    const handleSubtitlesUpdated = (ev: Event) => {
      const updated = (ev as CustomEvent<JamendoTrack>)?.detail;
      if (!updated?.id || !active) return;
      setAllTracks((prev) =>
        prev.some((t) => t.id === updated.id)
          ? prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
          : prev
      );
      setActivePlayerTrack((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
    };
    const handleTrackUpdated = (ev: Event) => {
      const updated = (ev as CustomEvent<JamendoTrack>)?.detail;
      if (!updated?.id || !active) return;
      setAllTracks((prev) =>
        prev.some((t) => t.id === updated.id)
          ? prev.map((t) =>
              t.id === updated.id
                ? {
                    ...updated,
                    viewsCount: Math.max(Number(t.viewsCount) || 0, Number(updated.viewsCount) || 0),
                    playsCount: Math.max(Number(t.playsCount) || 0, Number(updated.playsCount) || 0),
                  }
                : t
            )
          : [updated, ...prev]
      );
      setActivePlayerTrack((cur) =>
        cur && cur.id === updated.id
          ? {
              ...cur,
              ...updated,
              viewsCount: Math.max(Number(cur.viewsCount) || 0, Number(updated.viewsCount) || 0),
              playsCount: Math.max(Number(cur.playsCount) || 0, Number(updated.playsCount) || 0),
            }
          : cur
      );
    };

    const handleViewsUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<{ trackId?: string; viewsCount?: number; authoritative?: boolean }>)?.detail;
      const trackId = detail?.trackId;
      const serverViews = Number(detail?.viewsCount);
      if (!trackId || !Number.isFinite(serverViews) || serverViews < 0 || !active) return;
      const isAuthoritative = detail?.authoritative !== false;

      setAllTracks((prev) =>
        prev.some((t) => t.id === trackId)
          ? prev.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    viewsCount: isAuthoritative
                      ? serverViews
                      : Math.max(Number(t.viewsCount) || 0, serverViews),
                  }
                : t
            )
          : prev
      );
      setActivePlayerTrack((cur) =>
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

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        refreshCloudTracksInBackground(false);
      }
    };

    const handleTrackDeleted = (ev: Event) => {
      const deletedId = (ev as CustomEvent<{ trackId?: string }>)?.detail?.trackId;
      if (!deletedId || !active) return;
      setAllTracks((prev) => prev.filter((t) => t.id !== deletedId));
    };

    const handleAlbumsUpdated = (ev: Event) => {
      if (!active) return;
      const detail = (ev as CustomEvent<{ albums?: Album[] }>)?.detail;
      setAllAlbums(Array.isArray(detail?.albums) ? detail.albums : getCachedAlbums());
    };

    const handleOnline = () => {
      if (active) setIsOnline(true);
    };
    const handleOffline = () => {
      if (active) setIsOnline(false);
    };

    window.addEventListener(TRACK_SUBTITLES_UPDATED_EVENT, handleSubtitlesUpdated);
    window.addEventListener(TRACK_UPDATED_EVENT, handleTrackUpdated);
    window.addEventListener(TRACK_VIEWS_UPDATED_EVENT, handleViewsUpdated);
    window.addEventListener(TRACK_DELETED_EVENT, handleTrackDeleted);
    window.addEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      active = false;
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener(TRACK_SUBTITLES_UPDATED_EVENT, handleSubtitlesUpdated);
      window.removeEventListener(TRACK_UPDATED_EVENT, handleTrackUpdated);
      window.removeEventListener(TRACK_VIEWS_UPDATED_EVENT, handleViewsUpdated);
      window.removeEventListener(TRACK_DELETED_EVENT, handleTrackDeleted);
      window.removeEventListener(ALBUMS_UPDATED_EVENT, handleAlbumsUpdated);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [refreshCloudTracksInBackground]);

  const handleToggleLikeSong = (id: string) => {
    if (!authUser?.uid) {
      loginWithGoogle().catch(() => {});
      return;
    }
    const res = toggleUserFavorite(authUser.uid, id);
    if (res.allowed) {
      setLikedSongIds(res.likedIds);
    }
  };

  const activeAccessibilityCount = countActiveAccessibilityFeatures(a11ySettings, pointerCaps);

  return (
    <SecurityGuard>
      <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#000000] text-white flex flex-col font-sans selection:bg-white selection:text-black relative">
        {/* LUXURY SPLASH SCREEN */}
        <AnimatePresence>
          {isInitializing && <SplashScreen key="splash" isLoading={isInitializing} />}
        </AnimatePresence>

        <main className="flex-1 p-0 m-0">
          {/* Main SongsView receives preloaded tracks/artists/albums so UI renders immediately behind SplashScreen */}
          <SongsView
            lang={lang}
            initialTracks={allTracks}
            initialArtists={allArtists}
            initialAlbums={allAlbums}
            onTracksSync={setAllTracks}
            onArtistsSync={setAllArtists}
            onAlbumsSync={setAllAlbums}
            onNavigateHome={handleExitTrack}
            onPlayTrack={handleEnterTrack}
            onOpenAccessibility={() => setIsAccessibilityOpen(true)}
            activeAccessibilityCount={activeAccessibilityCount}
          />

          {/* Full-Page Luxury Player Overlay with Smooth Silk Transition */}
          <AnimatePresence>
            {activePlayerTrack && (
              <SongPlayerPage
                key={activePlayerTrack.id}
                track={activePlayerTrack}
                activeAlbumContext={activeAlbumContext}
                onBack={handleExitTrack}
                onFilterByArtist={handleExitTrack}
                isLiked={likedSongIds.includes(activePlayerTrack.id)}
                onToggleLike={handleToggleLikeSong}
                onRequireAuth={() => {
                  loginWithGoogle().catch(() => {});
                }}
                lang={lang}
                allTracks={allTracks.length > 0 ? allTracks : getInstantSongPool()}
                allArtists={allArtists.length > 0 ? allArtists : getCachedArtistProfiles()}
                allAlbums={allAlbums}
                onPlayTrack={handleEnterTrack}
                onRemoveTrack={(trackId) => {
                  removeTrackFromMemory(trackId);
                  setAllTracks((prev) => prev.filter((t) => t.id !== trackId));
                  if (activePlayerTrack?.id === trackId) {
                    syncSongQueryParam(null);
                    setActivePlayerTrack(null);
                    setActiveAlbumContext(null);
                  }
                }}
              />
            )}
          </AnimatePresence>
        </main>

        {/* FULL-SCREEN BLACK ACCESSIBILITY SETTINGS & STATEMENT PAGE */}
        <AnimatePresence>
          {isAccessibilityOpen && (
            <AccessibilityPage
              isOpen={isAccessibilityOpen}
              onClose={() => setIsAccessibilityOpen(false)}
              settings={a11ySettings}
              onUpdateSettings={handleUpdateAccessibility}
              lang={lang}
            />
          )}
        </AnimatePresence>

        {/* GLOBAL GRAYSCALE OVERLAY (Preserves fixed positioning across all modals/bars) */}
        {a11ySettings.grayscale && (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-[99990] pointer-events-none backdrop-grayscale"
          />
        )}

        {/* GLOBAL READING GUIDE OVERLAY (Active only when fine mouse pointer is available) */}
        {a11ySettings.readingGuide && pointerCaps.hasFinePointer && (
          <div
            aria-hidden="true"
            style={{ top: `${guideY}px` }}
            className="fixed left-0 right-0 h-1 -translate-y-1/2 z-[99991] pointer-events-none bg-white/80 shadow-[0_0_16px_rgba(255,255,255,0.85)]"
          />
        )}

        {/* REMOVED SONG NOTICE (For stale direct ?song= links) */}
        {removedSongNotice && (
          <div
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            className="fixed inset-0 z-[99992] bg-black/85 backdrop-blur-xl flex items-center justify-center p-6 text-center"
          >
            <div className="w-full max-w-sm rounded-3xl bg-[#0a0a0c] border border-white/20 p-6 space-y-4 shadow-2xl">
              <div className="w-14 h-14 mx-auto rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                <AlertCircle className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-black text-white">
                {lang === 'he' ? 'השיר הוסר' : 'Song Removed'}
              </h2>
              <p className="text-sm text-white/80 leading-relaxed">
                {lang === 'he'
                  ? 'השיר שניסית לפתוח הוסר מהפלטפורמה ואינו זמין יותר להשמעה.'
                  : 'The song you tried to play has been removed and is no longer available.'}
              </p>
              <button
                type="button"
                onClick={() => setRemovedSongNotice(false)}
                className="w-full py-3 rounded-full bg-white text-black font-bold text-sm hover:bg-neutral-200 transition-all cursor-pointer active:scale-95"
              >
                {lang === 'he' ? 'חזור לאתר' : 'Back to Site'}
              </button>
            </div>
          </div>
        )}

        {/* FULL-SCREEN OFFLINE OVERLAY */}
        {!isOnline && (
          <div
            role="alert"
            aria-live="assertive"
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            className="fixed inset-0 z-[99995] bg-black flex flex-col items-center justify-center p-6 text-center select-none"
          >
            <div className="w-24 h-24 rounded-full bg-white text-black flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(255,255,255,0.22)]">
              <WifiOff className="w-11 h-11 text-black" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3 tracking-tight">
              {lang === 'he' ? 'אין אינטרנט' : 'No Internet Connection'}
            </h1>
            <p className="text-sm sm:text-base text-white/85 max-w-sm leading-relaxed mb-7">
              {lang === 'he'
                ? 'אין חיבור פעיל לאינטרנט כרגע. בדוק את חיבור ה-Wi-Fi או הנתונים הסלולריים במכשירך כדי להמשיך להאזין לשירים.'
                : 'No active internet connection right now. Check your Wi-Fi or mobile data connection to continue streaming music.'}
            </p>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.onLine) {
                  setIsOnline(true);
                } else {
                  fetch(`/api/storage/status?_t=${Date.now()}`, { cache: 'no-store' })
                    .then((res) => {
                      if (res.ok) setIsOnline(true);
                    })
                    .catch(() => {});
                }
              }}
              className="px-7 py-3 rounded-full bg-white text-black font-bold text-sm hover:bg-neutral-200 active:scale-95 transition-all flex items-center gap-2 cursor-pointer shadow-xl"
            >
              <RefreshCw className="w-4 h-4 text-black" />
              <span>{lang === 'he' ? 'נסה שוב' : 'Try Again'}</span>
            </button>
          </div>
        )}
      </div>
    </SecurityGuard>
  );
}
