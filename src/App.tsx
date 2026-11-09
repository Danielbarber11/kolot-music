import React, { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { SongsView } from './components/SongsView';
import { SongPlayerPage } from './components/SongPlayerPage';
import { Language, JamendoTrack } from './types';
import { getInstantSongPool } from './services/multiMusicService';
import { SecurityGuard } from './components/SecurityGuard';

export default function App() {
  const [lang] = useState<Language>('he');
  const [activePlayerTrack, setActivePlayerTrack] = useState<JamendoTrack | null>(null);

  const [likedSongIds, setLikedSongIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_liked_songs');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const handleToggleLikeSong = (id: string) => {
    setLikedSongIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <SecurityGuard>
      <div className="min-h-screen bg-[#000000] text-white flex flex-col font-sans selection:bg-white selection:text-black relative">
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
                allTracks={getInstantSongPool()}
                onPlayTrack={(t) => setActivePlayerTrack(t)}
              />
            )}
          </AnimatePresence>
        </main>
      </div>
    </SecurityGuard>
  );
}

