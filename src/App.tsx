import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { SongsView } from './components/SongsView';
import { SongPlayerPage } from './components/SongPlayerPage';
import { SplashScreen } from './components/SplashScreen';
import { Language, JamendoTrack, ArtistProfile, Album } from './types';
import {
  getInstantSongPool,
  fetchAllRealSongs,
  getCachedArtistProfiles,
  fetchAllArtistProfiles,
  getCachedAlbums,
  fetchRealAlbums,
  initializeMultiMusicService,
} from './services/multiMusicService';
import { getStreamingMediaUrl } from './services/cloudStorageService';
import { SecurityGuard } from './components/SecurityGuard';

function preloadAndDecodeImages(urls: Array<string | undefined>): Promise<void> {
  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((u) => (u ? getStreamingMediaUrl(u) : ''))
        .filter((u) => !!u && (u.startsWith('http') || u.startsWith('/') || u.startsWith('data:')))
    )
  ).slice(0, 8);

  if (uniqueUrls.length === 0) return Promise.resolve();

  return Promise.allSettled(
    uniqueUrls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
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

  const [likedSongIds, setLikedSongIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_liked_songs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Coordinate initial feed + top cover image decode capped at 800ms so entry feels instant and complete (< 1s)
  useEffect(() => {
    let active = true;

    const preloadDataAndTopCovers = async () => {
      try {
        await initializeMultiMusicService();
        const freshTracks = await fetchAllRealSongs().catch(() => getInstantSongPool());
        const freshArtists = await fetchAllArtistProfiles().catch(() => getCachedArtistProfiles());
        const freshAlbums = await fetchRealAlbums().catch(() => getCachedAlbums());

        if (!active) return;
        if (freshTracks.length > 0) setAllTracks(freshTracks);
        if (freshArtists.length > 0) setAllArtists(freshArtists);
        if (freshAlbums.length > 0) setAllAlbums(freshAlbums);

        const topImageUrls = [
          ...freshTracks.slice(0, 6).map((t) => t.coverUrl),
          ...freshArtists.slice(0, 3).map((a) => a.avatarUrl),
        ];
        await preloadAndDecodeImages(topImageUrls);
      } catch {
        // Non-fatal
      }
    };

    const maxWait = new Promise<void>((resolve) => setTimeout(resolve, 800));

    Promise.race([preloadDataAndTopCovers(), maxWait]).finally(() => {
      if (active) setIsInitializing(false);
    });

    // Continue refreshing full data in background even after splash lifts
    fetchAllRealSongs(undefined, (batch) => {
      if (active && batch.length > 0) setAllTracks(batch);
    }).catch(() => {});

    fetchAllArtistProfiles()
      .then((profiles) => {
        if (active && profiles.length > 0) setAllArtists(profiles);
      })
      .catch(() => {});

    fetchRealAlbums()
      .then((albums) => {
        if (active && albums.length > 0) setAllAlbums(albums);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleToggleLikeSong = (id: string) => {
    setLikedSongIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

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
      </div>
    </SecurityGuard>
  );
}
