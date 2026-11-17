import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { SongsView } from './components/SongsView';
import { SongPlayerPage } from './components/SongPlayerPage';
import { SplashScreen } from './components/SplashScreen';
import { Language, JamendoTrack, ArtistProfile, Album } from './types';
import {
  getInstantSongPool,
  fetchBootstrapData,
  getCachedArtistProfiles,
  getCachedAlbums,
} from './services/multiMusicService';
import { getStreamingMediaUrl } from './services/cloudStorageService';
import { SecurityGuard } from './components/SecurityGuard';
import { AccessibilityPage } from './components/AccessibilityPage';
import {
  AccessibilitySettings,
  loadAccessibilitySettings,
  saveAccessibilitySettings,
  applyAccessibilitySettingsToDom,
  countActiveAccessibilityFeatures,
} from './services/accessibilityService';

function preloadAndDecodeImages(urls: Array<string | undefined>): Promise<void> {
  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((u) => (u ? getStreamingMediaUrl(u) : ''))
        .filter((u) => !!u && (u.startsWith('http') || u.startsWith('/') || u.startsWith('data:')))
    )
  ).slice(0, 20);

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
  const [isInitializing, setIsInitializing] = useState(true);
  const [allTracks, setAllTracks] = useState<JamendoTrack[]>(() => getInstantSongPool());
  const [allArtists, setAllArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());
  const [allAlbums, setAllAlbums] = useState<Album[]>(() => getCachedAlbums());

  const [a11ySettings, setA11ySettings] = useState<AccessibilitySettings>(() => {
    const loaded = loadAccessibilitySettings();
    applyAccessibilitySettingsToDom(loaded);
    return loaded;
  });
  const [isAccessibilityOpen, setIsAccessibilityOpen] = useState(false);
  const [guideY, setGuideY] = useState<number>(220);

  const handleUpdateAccessibility = (next: AccessibilitySettings) => {
    setA11ySettings(next);
    saveAccessibilitySettings(next);
    applyAccessibilitySettingsToDom(next);
  };

  useEffect(() => {
    applyAccessibilitySettingsToDom(a11ySettings);
  }, [a11ySettings]);

  useEffect(() => {
    if (!a11ySettings.readingGuide) return;
    const handleMove = (e: MouseEvent) => {
      setGuideY(e.clientY);
    };
    window.addEventListener('mousemove', handleMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [a11ySettings.readingGuide]);

  const [likedSongIds, setLikedSongIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_liked_songs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Coordinate single-roundtrip /api/bootstrap + top cover & avatar image decode BEFORE dismissing SplashScreen
  // so initial tracks, cards, and covers appear together immediately without an empty flash.
  useEffect(() => {
    let active = true;

    const preloadDataAndTopCovers = async () => {
      try {
        const boot = await fetchBootstrapData();
        if (!active) return;
        setAllTracks(boot.tracks);
        setAllArtists(boot.profiles);
        setAllAlbums(boot.albums);

        const topImageUrls = [
          ...boot.tracks.slice(0, 12).map((t) => t.coverUrl),
          ...boot.profiles.slice(0, 8).map((a) => a.avatarUrl),
          ...boot.albums.slice(0, 6).map((al) => al.coverUrl),
        ];
        await preloadAndDecodeImages(topImageUrls);
      } catch {
        // Non-fatal
      }
    };

    const maxWait = new Promise<void>((resolve) => setTimeout(resolve, 2400));

    Promise.race([preloadDataAndTopCovers(), maxWait]).finally(() => {
      if (active) setIsInitializing(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const handleToggleLikeSong = (id: string) => {
    setLikedSongIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const activeAccessibilityCount = countActiveAccessibilityFeatures(a11ySettings);

  return (
    <SecurityGuard>
      <div className="min-h-screen bg-[#000000] text-white flex flex-col font-sans selection:bg-white selection:text-black relative">
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
            onNavigateHome={() => setActivePlayerTrack(null)}
            onPlayTrack={(track) => setActivePlayerTrack(track)}
            onOpenAccessibility={() => setIsAccessibilityOpen(true)}
            activeAccessibilityCount={activeAccessibilityCount}
          />

          {/* Full-Page Luxury Player Overlay with Smooth Silk Transition */}
          <AnimatePresence>
            {activePlayerTrack && (
              <SongPlayerPage
                key={activePlayerTrack.id}
                track={activePlayerTrack}
                onBack={() => setActivePlayerTrack(null)}
                onFilterByArtist={() => setActivePlayerTrack(null)}
                isLiked={likedSongIds.includes(activePlayerTrack.id)}
                onToggleLike={handleToggleLikeSong}
                lang={lang}
                allTracks={allTracks.length > 0 ? allTracks : getInstantSongPool()}
                allArtists={allArtists.length > 0 ? allArtists : getCachedArtistProfiles()}
                onPlayTrack={(t) => setActivePlayerTrack(t)}
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

        {/* GLOBAL READING GUIDE OVERLAY */}
        {a11ySettings.readingGuide && (
          <div
            aria-hidden="true"
            style={{ top: `${guideY}px` }}
            className="fixed left-0 right-0 h-1 -translate-y-1/2 z-[99991] pointer-events-none bg-white/80 shadow-[0_0_16px_rgba(255,255,255,0.85)]"
          />
        )}
      </div>
    </SecurityGuard>
  );
}
