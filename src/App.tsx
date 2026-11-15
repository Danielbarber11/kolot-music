import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { SongsView } from './components/SongsView';
import { SongPlayerPage } from './components/SongPlayerPage';
import { SplashScreen } from './components/SplashScreen';
import { Language, JamendoTrack, ArtistProfile } from './types';
import {
  getInstantSongPool,
  fetchAllRealSongs,
  getCachedArtistProfiles,
  fetchAllArtistProfiles,
} from './services/multiMusicService';
import { SecurityGuard } from './components/SecurityGuard';

export default function App() {
  const [lang] = useState<Language>('he');
  const [activePlayerTrack, setActivePlayerTrack] = useState<JamendoTrack | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [allTracks, setAllTracks] = useState<JamendoTrack[]>(() => getInstantSongPool());
  const [allArtists, setAllArtists] = useState<ArtistProfile[]>(() => getCachedArtistProfiles());

  const [likedSongIds, setLikedSongIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_liked_songs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Start non-blocking progressive fetch immediately on load
  useEffect(() => {
    fetchAllRealSongs(undefined, (batch) => {
      if (batch.length > 0) setAllTracks(batch);
    })
      .then((tracks) => {
        if (tracks.length > 0) setAllTracks(tracks);
      })
      .catch(() => {});

    fetchAllArtistProfiles()
      .then((profiles) => {
        if (profiles.length > 0) setAllArtists(profiles);
      })
      .catch(() => {});

    // Hide splash screen within 200ms max for instant loading
    const timer = setTimeout(() => {
      setIsInitializing(false);
    }, 200);

    return () => clearTimeout(timer);
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
          {/* Main SongsView stays mounted to preserve scroll, state, and avoid image/button pop-in */}
          <SongsView
            lang={lang}
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
