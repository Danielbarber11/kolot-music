import React, { useState } from 'react';
import { Gamepad2, ArrowRight, ArrowLeft, RefreshCw, ExternalLink, Monitor, Info } from 'lucide-react';
import { ArchiveItem, Language } from '../types';

interface GameEmulatorPageProps {
  game: ArchiveItem;
  onBack: () => void;
  lang: Language;
}

export const GameEmulatorPage: React.FC<GameEmulatorPageProps> = ({ game, onBack, lang }) => {
  const isHe = lang === 'he';
  const [iframeKey, setIframeKey] = useState(0);

  const BackIcon = isHe ? ArrowRight : ArrowLeft;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Page Header Controls - Sitting Cleanly on Page Background */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-extrabold text-xs rounded-2xl flex items-center gap-2 shadow-sm transition-all"
        >
          <BackIcon className="w-4 h-4" />
          <span>{isHe ? 'חזרה למסך המשחקים' : 'Back to Games'}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="p-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-2xl shadow-sm"
            title={isHe ? 'רענן אמולטור' : 'Reload Emulator'}
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <a
            href={game.itemUrl}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-2xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
          >
            <span>Archive.org</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Game Emulator Frame - Embedded Directly on Page Background */}
      <div className="bg-slate-950 border border-slate-300 rounded-3xl overflow-hidden shadow-2xl relative min-h-[520px] flex items-center justify-center">
        {game.embedUrl ? (
          <iframe
            key={iframeKey}
            src={game.embedUrl}
            title={game.title}
            className="w-full h-[560px] border-0"
            allowFullScreen
          />
        ) : (
          <p className="text-white text-xs">{isHe ? 'אמולטור אינו נתמך עבור משחק זה' : 'Emulator not supported'}</p>
        )}
      </div>

      {/* Game Details sitting directly on page */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-3">
        <span className="px-3 py-1 bg-purple-100 text-purple-800 font-mono font-bold text-xs rounded-full border border-purple-200">
          MS-DOS EMULATION ACTIVE
        </span>

        <h1 className="text-2xl font-black text-slate-900">{game.title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{game.description}</p>

        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-500">
          <span>📅 שנת יציאה: {game.year || '1990'}</span>
          <span>🎮 פיתוח: {game.creator || 'MS-DOS Classic'}</span>
          <span>🖥️ טכנולוגיה: DOSBox In-Browser WASM</span>
        </div>
      </div>
    </div>
  );
};
