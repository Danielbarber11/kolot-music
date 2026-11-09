import React, { useState } from 'react';
import { Gamepad2, Play, Search, Monitor, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { ArchiveItem, Language } from '../types';

interface GamesViewProps {
  lang: Language;
  onSelectGame: (game: ArchiveItem) => void;
}

export const RETRO_DOS_GAMES: ArchiveItem[] = [
  {
    identifier: 'msdos_Pac-Man_1983',
    title: 'Pac-Man Arcade MS-DOS',
    description: 'The legendary 1983 arcade maze game preserved in Internet Archive MS-DOS Software Library.',
    mediaType: 'software',
    year: '1983',
    creator: 'Namco / Atarisoft',
    thumbnail: 'https://archive.org/services/img/msdos_Pac-Man_1983',
    embedUrl: 'https://archive.org/embed/msdos_Pac-Man_1983',
    itemUrl: 'https://archive.org/details/msdos_Pac-Man_1983',
  },
  {
    identifier: 'msdos_Prince_of_Persia_1990',
    title: 'Prince of Persia (1990)',
    description: 'Jordan Mechner original masterpiece platformer running live via MS-DOS emulator.',
    mediaType: 'software',
    year: '1990',
    creator: 'Brøderbund',
    thumbnail: 'https://archive.org/services/img/msdos_Prince_of_Persia_1990',
    embedUrl: 'https://archive.org/embed/msdos_Prince_of_Persia_1990',
    itemUrl: 'https://archive.org/details/msdos_Prince_of_Persia_1990',
  },
  {
    identifier: 'msdos_SimCity_1989',
    title: 'SimCity Classic (1989)',
    description: 'Will Wright original city building simulation game for MS-DOS.',
    mediaType: 'software',
    year: '1989',
    creator: 'Maxis',
    thumbnail: 'https://archive.org/services/img/msdos_SimCity_1989',
    embedUrl: 'https://archive.org/embed/msdos_SimCity_1989',
    itemUrl: 'https://archive.org/details/msdos_SimCity_1989',
  },
  {
    identifier: 'msdos_Doom_1993',
    title: 'Doom Shareware (1993)',
    description: 'id Software revolutionary first-person shooter running directly in browser.',
    mediaType: 'software',
    year: '1993',
    creator: 'id Software',
    thumbnail: 'https://archive.org/services/img/msdos_Doom_1993',
    embedUrl: 'https://archive.org/embed/msdos_Doom_1993',
    itemUrl: 'https://archive.org/details/msdos_Doom_1993',
  },
  {
    identifier: 'msdos_Oregon_Trail_The_1990',
    title: 'The Oregon Trail (1990)',
    description: 'Classic educational strategy game preserved in Internet Archive.',
    mediaType: 'software',
    year: '1990',
    creator: 'MECC',
    thumbnail: 'https://archive.org/services/img/msdos_Oregon_Trail_The_1990',
    embedUrl: 'https://archive.org/embed/msdos_Oregon_Trail_The_1990',
    itemUrl: 'https://archive.org/details/msdos_Oregon_Trail_The_1990',
  },
  {
    identifier: 'msdos_Street_Fighter_II_1992',
    title: 'Street Fighter II MS-DOS',
    description: 'Capcom famous fighting arcade port running in browser emulator.',
    mediaType: 'software',
    year: '1992',
    creator: 'Capcom',
    thumbnail: 'https://archive.org/services/img/msdos_Street_Fighter_II_1992',
    embedUrl: 'https://archive.org/embed/msdos_Street_Fighter_II_1992',
    itemUrl: 'https://archive.org/details/msdos_Street_Fighter_II_1992',
  },
];

export const GamesView: React.FC<GamesViewProps> = ({ lang, onSelectGame }) => {
  const isHe = lang === 'he';

  const [filter, setFilter] = useState('');

  const games = RETRO_DOS_GAMES.filter((g) =>
    filter ? g.title.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Banner */}
      <div className="bg-gradient-to-r from-purple-50 via-indigo-50 to-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-purple-100 text-purple-800 font-extrabold text-xs mb-3 border border-purple-200">
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>INTERNET ARCHIVE MS-DOS EMULATOR ENGINE</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            {isHe ? 'משחקי MS-DOS ואמולטור מובנה' : 'MS-DOS Retro Games & Emulator'}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm mt-2 max-w-xl leading-relaxed">
            {isHe
              ? 'משחקי נוסטלגיה ישנים מארכיון האינטרנט. לחץ על משחק להרצה ישירה בדפדפן באמצעות אמולטור מובנה!'
              : 'Classic MS-DOS arcade games running directly in your browser with built-in DOSBox emulator.'}
          </p>
        </div>

        {/* Filter Input */}
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={isHe ? 'סינון משחקים...' : 'Filter games...'}
            className="w-full pr-10 pl-10 py-3 bg-white border border-slate-300 focus:border-purple-600 rounded-2xl text-slate-900 text-xs font-medium focus:outline-none shadow-sm"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </div>
      </div>

      {/* Grid of Games */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {games.map((game) => (
          <motion.div
            whileHover={{ y: -6 }}
            key={game.identifier}
            onClick={() => onSelectGame(game)}
            className="group bg-white border border-slate-200 hover:border-purple-500 rounded-3xl p-4 shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
          >
            <div>
              <div className="relative h-40 bg-slate-950 rounded-2xl overflow-hidden mb-3 border border-slate-200">
                <img src={game.thumbnail} alt={game.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                <div className="absolute inset-0 bg-slate-950/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                  <div className="w-12 h-12 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg">
                    <Play className="w-6 h-6 fill-current translate-x-0.5" />
                  </div>
                </div>
              </div>

              <h3 className="font-extrabold text-sm text-slate-900 line-clamp-1 group-hover:text-purple-600 transition-colors">
                {game.title}
              </h3>
              <p className="text-xs text-slate-500 line-clamp-2 mt-1">{game.description}</p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-purple-700">
              <span className="flex items-center gap-1">
                <Monitor className="w-3.5 h-3.5" />
                <span>{isHe ? 'הפעל באמולטור בדפדפן' : 'Play in Browser'}</span>
              </span>
              <Play className="w-3.5 h-3.5 fill-current" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
